import { App, TFile } from 'obsidian';
import { LogRow, CSV_FILENAME } from './types';
import { DataManager } from './DataManager';
import {
  CSV_HEADER,
  parseCsvContent,
  logRowToCsvLine,
  tombstoneLine,
  tombstoneLines,
  logsToCsv,
  isStaleHeader,
} from './csvFormat';

/*
 * CSVStore.ts —— 训练记录的数据层（vault 内 workout_logs.csv）。
 *
 * 设计要点：
 *  - 数据以标准 CSV 存在 vault 中，支持 Dataview 等外部工具查询（满足"两个文件可查询"）。
 *  - 关键性能优化（根治"添加记录卡顿"）：
 *      新增记录用 Vault.append(file, line) 做 O(1) 追加，不再每次把整个 CSV 重写一遍；
 *      Vault.append 走 Obsidian 缓存层（区别于 adapter.append 绕过缓存导致崩溃）。
 *  - 删除采用「软删除」：删除时不再整文件重写，而是 O(1) 追加一行墓碑
 *    （deleted 列标记为 true），读取时过滤掉被删 id 的行。彻底消灭删除卡顿。
 *    「整文件压缩清理」（真正移除被删行）由设置页按钮在用户主动触发时执行。
 *  - 编辑因需改中间行，仍整体重写（writeAll，使用 vault.modify），但属低频操作，
 *    且记录少时极快；外部手动改文件也不会丢数据。
 *  - CSV 的序列化/解析硬约定（表头列序、转义、墓碑、容错）全部收敛在纯模块
 *    `csvFormat.ts`，与 workout-block CLI 共用，保证两侧写盘逐字节同构。
 */

export class CSVStore {
  private dm: DataManager;   // 数据中枢，用于取设置（CSV 所在目录）与 App 实例
  private app: App;

  constructor(dm: DataManager) {
    this.dm = dm;
    this.app = dm.app;
  }

  // CSV 文件路径（基于设置里的 csvDirectory，空 = vault 根目录）
  private get path(): string {
    const dir = this.dm.getSettings().csvDirectory || '';
    return dir ? `${dir}/${CSV_FILENAME}` : CSV_FILENAME;
  }

  // 解析 CSV 文本为 LogRow[]（含脏行计数与墓碑 id 集合）。实现收敛在纯模块 csvFormat，
  // 与 workout-block CLI 共用同一套容错规则（逐行降级、超长 fields 丢弃、墓碑过滤）。
  parseContent(content: string): { rows: LogRow[]; dropped: number; deletedIds: string[] } {
    return parseCsvContent(content);
  }

  // 读取 CSV 文本：优先走 vault 缓存层（getAbstractFileByPath + vault.read，写盘安全）；
  // 兜底走 adapter 直接读磁盘。
  // 关键修复点：Obsidian 在「首次打开仓库」时会在 vault 文件缓存（fileMap）尚未就绪前
  // 就调用插件 onload()，此时 getAbstractFileByPath 漏返回已存在的 CSV → init() 误判
  // 为「无文件」→ logsCache 永远为空 → 首次打开看不到历史记录、添加也只显示当次。
  // 手动重载插件时 vault 已就绪，故能正常显示。改用 adapter.read（不依赖 fileMap）兜底后，
  // 即使 fileMap 未就绪也能从磁盘读到历史记录。文件确实不存在时返回 null。
  private async readFileContent(): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (file instanceof TFile) {
      return await this.app.vault.read(file);
    }
    try {
      return await this.app.vault.adapter.read(this.path);
    } catch {
      return null;
    }
  }

  // 从 vault 读取全部记录，并返回丢弃的脏行数（供 init 落盘自愈使用）。
  async readAllWithStats(): Promise<{ rows: LogRow[]; dropped: number; deletedIds: string[] }> {
    const content = await this.readFileContent();
    if (content === null) return { rows: [], dropped: 0, deletedIds: [] };
    return this.parseContent(content);
  }

  // 追加一行：优先 Vault.append（缓存安全的 O(1) 追加）。
  // 旧版 Obsidian 无 append 时回退为 read + modify 整文件重写（兜底兼容）。
  // 关键：用 Papa.unparse 生成数据行（header: false），避免手动 escapeCell 对 JSON 内部引号错误双重转义。
  // 例如 JSON {"note":"say \"hello\""} 经 escapeCell 处理会变成 ""say ""hello""""，破坏结构；
  // 而 Papa.unparse 能正确处理嵌套引号，输出 "{""note"":""say \""hello\""""}"。
  async appendRow(row: LogRow): Promise<void> {
    const line = this.toCsvLine(row);
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (file instanceof TFile) {
      if (typeof this.app.vault.append === 'function') {
        await this.app.vault.append(file, line + '\n');
      } else {
        const content = await this.app.vault.read(file);
        const newContent = content.replace(/\s+$/, '') + '\n' + line + '\n';
        await this.app.vault.modify(file, newContent);
      }
    } else {
      try {
        await this.app.vault.create(this.path, CSV_HEADER + '\n' + line + '\n');
      } catch (e: unknown) {
        if (String((e as Error)?.message ?? '').includes('File already exists')) {
          const f = this.app.vault.getAbstractFileByPath(this.path);
          if (f instanceof TFile) {
            if (typeof this.app.vault.append === 'function') {
              await this.app.vault.append(f, line + '\n');
            } else {
              const c = await this.app.vault.read(f);
              await this.app.vault.modify(f, c.replace(/\s+$/, '') + '\n' + line + '\n');
            }
          }
        } else {
          throw e;
        }
      }
    }
  }

  // 把一行记录转成 CSV 文本。实现收敛在纯模块 csvFormat（Papa.unparse + 规范列序），
  // 确保嵌套 JSON 引号转义正确、与 writeAll/CLI 完全一致。
  private toCsvLine(row: LogRow): string {
    return logRowToCsvLine(row);
  }

  // 追加一行「软删除墓碑」：仅标记 id 为已删除（deleted 列 = true），O(1) 追加，不重写整文件。
  // 读取时 parseContent 据此过滤掉该 id 的残留数据行。用于 deleteLog，根治删除卡顿。
  async appendTombstone(id: string): Promise<void> {
    const line = tombstoneLine(id);
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (file instanceof TFile) {
      if (typeof this.app.vault.append === 'function') {
        await this.app.vault.append(file, line + '\n');
      } else {
        const content = await this.app.vault.read(file);
        await this.app.vault.modify(file, content.replace(/\s+$/, '') + '\n' + line + '\n');
      }
    }
    // 文件不存在（极端：记录所在的 CSV 被外部删除）时静默忽略：
    // 删除已反映到内存缓存，后续任何写盘都会以存活记录为准干净重建。
  }

  // 批量追加「软删除墓碑」：把多个 id 的墓碑合并成「一次」O(1) 追加，
  // 避免逐条删除时多次 appendTombstone 触发多次写入。用于「删除训练项时级联删除其全部
  // 训练记录」场景，保证与大 CSV 同样无卡顿。文件不存在时静默忽略（删除已反映到内存缓存）。
  async appendTombstones(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const content = tombstoneLines(ids);
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (file instanceof TFile) {
      if (typeof this.app.vault.append === 'function') {
        await this.app.vault.append(file, content + '\n');
      } else {
        const existing = await this.app.vault.read(file);
        await this.app.vault.modify(file, existing.replace(/\s+$/, '') + '\n' + content + '\n');
      }
    }
  }

  // 整体写入（编辑/删除/批量导入）。存在则改、否则建。
  // 序列化规则（强制规范列序、过滤无效行、空数据只写表头）收敛在纯模块 csvFormat.logsToCsv，
  // 避免「内存对象键序」泄漏到磁盘导致列顺序漂移，并与 CLI 的整文件写保持同构。
  async writeAll(rows: LogRow[]): Promise<void> {
    const csv = logsToCsv(rows);
    await this.createOrModify(csv + '\n');
  }

  // 存在则改、不存在则建；若并发初始化导致「文件已存在」(File already exists)，
  // 回退为 modify，避免插件加载时抛错中断 onload。
  private async createOrModify(content: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
      return;
    }
    try {
      await this.app.vault.create(this.path, content);
    } catch (e: unknown) {
      if (String((e as Error)?.message ?? '').includes('File already exists')) {
        const existing = this.app.vault.getAbstractFileByPath(this.path);
        if (existing instanceof TFile) await this.app.vault.modify(existing, content);
      } else {
        throw e;
      }
    }
  }

  // 判断磁盘上的 CSV 表头是否为「旧版结构」（与当前规范表头不一致）。
  // 仅用于迁移自愈：旧文件是 9 列、无 id 列，直接追加新行会导致列错位、数据损坏。
  async isHeaderStale(): Promise<boolean> {
    const content = await this.readFileContent();
    return isStaleHeader(content ?? '');
  }
}