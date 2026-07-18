import Papa from 'papaparse';
import { App, TFile } from 'obsidian';
import { LogRow, CSV_FILENAME } from './types';
import { DataManager } from './DataManager';
import { generateId } from '../util/id';

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
 */
// 第 8 列 deleted：空 = 正常行；'true' = 软删除墓碑行（仅标记 id 被删除，不作为记录）。
const CSV_HEADER = 'id,timestamp,exerciseId,category,fields,note,plan,deleted';

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

  // 解析 CSV 文本为 LogRow[]，失败返回空结果（不抛异常，避免影响启动）。
  // 返回值带 dropped：本被丢弃的脏行计数（如超长 fields 的幽灵行），供 init 判断是否需要落盘自愈。
  // 返回值带 deletedIds：被软删除（墓碑行）标记过的 id 集合，供缓存过滤与 id 分配去重。
  parseContent(content: string): { rows: LogRow[]; dropped: number; deletedIds: string[] } {
    try {
    const result = Papa.parse<Record<string, string>>(content, {
      header: true,
      skipEmptyLines: true,
    });
    // 收集软删除墓碑标记过的 id（deleted 列 === 'true' 的行）。
    const deletedIds = new Set<string>();
    let dropped = 0;
    const rows = result.data
      .map((row): LogRow | null => {
        // 软删除墓碑行：deleted 列为 true，仅记录「该 id 已被删除」，
        // 不计入脏行（dropped），也不作为正常记录返回（避免与同名数据行重复）。
        if (row.deleted === 'true') {
          if (row.id) deletedIds.add(row.id);
          return null;
        }
        // 关键兜底：timestamp / category 是后续过滤/分组必须的字段；缺失则无法渲染，
        // 且往往是脏 CSV（如未闭合引号把整行吞乱）产生的幽灵行，直接丢弃。
        if (!row.timestamp || !row.category) {
          dropped++;
          return null;
        }
        let fields: Record<string, unknown> = {};
        const raw = row.fields;
        if (raw) {
          // 单条记录的 fields 异常大（脏 CSV 未闭合引号把多行吞进一个单元格），
          // 整行直接丢弃——而非置空后保留成幽灵行。否则会：① 与正常行形成重复 id；
          // ② 被 writeAll 再次写回、撑大文件。丢弃才能从根上消除脏数据。
          if (raw.length > 10000) {
            console.warn('[workout] 跳过超长 fields（疑似脏数据）:', raw.slice(0, 80));
            dropped++;
            return null;
          }
          // 逐行兜底：某行 fields 解析失败只影响该行，绝不让整文件解析失败导致全部记录丢失。
          try {
            fields = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            fields = {};
          }
        }
        return {
          id: row.id || generateId(),
          timestamp: row.timestamp,
          exerciseId: row.exerciseId || undefined,
          category: row.category,
          fields,
          note: row.note || undefined,
          plan: row.plan || undefined,
        };
      })
      .filter((r): r is LogRow => r !== null)
      // 过滤掉「数据行 id 已被墓碑标记删除」的残留行（软删除前的旧数据行），
      // 保证内存缓存与渲染看到的都是存活记录。
      .filter((r) => !deletedIds.has(r.id));
    return { rows, dropped, deletedIds: Array.from(deletedIds) };
    } catch {
      return { rows: [], dropped: 0, deletedIds: [] };
    }
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

  // 把一行记录转成 CSV 文本。使用 Papa.unparse({ header: false }) 确保转义与 writeAll 完全一致。
  // deleted 列为空（正常行）；墓碑行由 appendTombstone 单独构造。
  private toCsvLine(row: LogRow): string {
    const columns = CSV_HEADER.split(',');
    return Papa.unparse(
      [{
        id: row.id,
        timestamp: row.timestamp,
        exerciseId: row.exerciseId || '',
        category: row.category,
        fields: JSON.stringify(normalizeFields(row.fields)),
        note: row.note || '',
        plan: row.plan || '',
        deleted: '',
      }],
      { columns, header: false }
    );
  }

  // 追加一行「软删除墓碑」：仅标记 id 为已删除（deleted 列 = true），O(1) 追加，不重写整文件。
  // 读取时 parseContent 据此过滤掉该 id 的残留数据行。用于 deleteLog，根治删除卡顿。
  async appendTombstone(id: string): Promise<void> {
    const line = Papa.unparse(
      [{ id, timestamp: '', exerciseId: '', category: '', fields: '', note: '', plan: '', deleted: 'true' }],
      { columns: CSV_HEADER.split(','), header: false }
    );
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
    const columns = CSV_HEADER.split(',');
    const content = ids
      .map((id) =>
        Papa.unparse(
          [{ id, timestamp: '', exerciseId: '', category: '', fields: '', note: '', plan: '', deleted: 'true' }],
          { columns, header: false }
        )
      )
      .join('\n');
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
  // 强制使用规范列序（CSV_HEADER），避免「内存对象键序」泄漏到磁盘导致列顺序漂移：
  // 例如 addLog 用 {...row, id, timestamp} 构造，会把 id/timestamp 排到末尾，若直接按首行键序
  // 序列化，磁盘列序会变成 exerciseId,category,...,timestamp,id —— 数据不丢但顺序混乱。
  async writeAll(rows: LogRow[]): Promise<void> {
    const columns = CSV_HEADER.split(',');
    // 关键：持久化前过滤掉无效行。旧版 bug 可能让 logsCache 中混入 timestamp/category 为空的行；
    // 若直接写回磁盘，下次读取会再次产生幽灵行并触发 split(undefined) 报错。只保留有效行。
    const validRows = rows.filter((row) => !!row.timestamp && !!row.category);
    let csv: string;
    if (validRows.length === 0) {
      // 空数据时只写表头，避免 Papa.unparse([]) 返回空字符串导致表头丢失。
      // 删除最后一条记录后文件至少保留表头，下次 appendRow 可正确追加。
      csv = CSV_HEADER;
    } else {
      csv = Papa.unparse(
        validRows.map((row) => ({
          id: row.id,
          timestamp: row.timestamp,
          exerciseId: row.exerciseId || '',       // 缺失则填空，保证 CSV 列对齐
          category: row.category,
          fields: JSON.stringify(normalizeFields(row.fields)), // 规范化为干净对象再序列化，避免脏字段被放大
          note: row.note || '',
          plan: row.plan || '',
          deleted: '',                            // 正常行：空（writeAll 用于压缩/编辑，不含墓碑）
        })),
        { columns }
      );
    }
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
    if (!content) return false;
    const firstLine = content.split('\n', 1)[0];
    return firstLine !== CSV_HEADER;
  }
}

// 把 fields 规范化为干净的普通对象：已是对象直接返回；是 JSON 字符串则尝试解析；
// 其它情况（undefined / 脏字符串 / 非对象）一律回退为 {}，避免序列化出巨型或非法单元格。
function normalizeFields(f: unknown): Record<string, unknown> {
  if (f && typeof f === 'object') return f as Record<string, unknown>;
  if (typeof f === 'string') {
    try {
      const parsed: unknown = JSON.parse(f);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}