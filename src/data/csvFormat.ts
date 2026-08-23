import Papa from 'papaparse';
import { LogRow } from './types';
import { generateId } from '../util/id';

/*
 * csvFormat.ts —— workout_logs.csv 的「纯序列化/解析层」（零 Obsidian 依赖）。
 *
 * 本模块集中了 CSV 数据格式的全部硬约定：
 *  - 规范表头与强制列序（防内存键序泄漏导致列序漂移）；
 *  - Papa.unparse 统一转义（fields 是嵌套 JSON，手写 join(',') 会双重转义写坏）；
 *  - 逐行降级的容错解析（一行坏只坏一行，绝不整表清空）；
 *  - 软删除墓碑行的生成与过滤。
 *
 * 插件的 CSVStore 与 workout-block CLI（src/cli/）共用本模块，
 * 保证两侧写出来的 CSV 逐字节同构——任何一方升级格式，另一方自动跟随。
 */

// 第 8 列 deleted：空 = 正常行；'true' = 软删除墓碑行（仅标记 id 被删除，不作为记录）。
export const CSV_HEADER = 'id,timestamp,exerciseId,category,fields,note,plan,deleted';

export const CSV_COLUMNS: string[] = CSV_HEADER.split(',');

// 解析 CSV 文本为 LogRow[]，失败返回空结果（不抛异常，避免影响启动）。
// 返回值带 dropped：本次被丢弃的脏行计数（如超长 fields 的幽灵行），供判断是否需要落盘自愈。
// 返回值带 deletedIds：被软删除（墓碑行）标记过的 id 集合，供缓存过滤与 id 分配去重。
export function parseCsvContent(content: string): { rows: LogRow[]; dropped: number; deletedIds: string[] } {
  try {
    // 行尾归一化：历史文件可能以 CRLF 写出（旧版 Papa 默认 \r\n），而本模块统一写 LF。
    // Papa 的 newline 自动探测以文件开头为准：CRLF 开头的文件里混入 LF 追加行会被吞进
    // 上一行——静默丢行、不计入 dropped、doctor 自愈不触发（最隐蔽的损坏）。解析前统一为 \n。
    const normalized = content.replace(/\r\n/g, '\n');
    const result = Papa.parse<Record<string, string>>(normalized, {
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
          // ② 被再次写回、撑大文件。丢弃才能从根上消除脏数据。
          if (raw.length > 10000) {
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
      // 保证读取看到的都是存活记录。
      .filter((r) => !deletedIds.has(r.id));
    return { rows, dropped, deletedIds: Array.from(deletedIds) };
  } catch {
    return { rows: [], dropped: 0, deletedIds: [] };
  }
}

// 把一行记录转成 CSV 文本（不含换行符）。使用 Papa.unparse({ header: false })
// 确保嵌套 JSON 的引号转义正确。deleted 列为空（正常行）；墓碑行由 tombstoneLine 单独构造。
// 本模块所有 unparse 统一 newline='\n'：Papa 默认 '\r\n' 会让 writeAll 产出的表头行带 \r，
// isStaleHeader 按 '\n' 切分比对时会误判「表头过时」，触发每次加载的无谓整文件重写。
export function logRowToCsvLine(row: LogRow): string {
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
    { columns: CSV_COLUMNS, header: false, newline: '\n' }
  );
}

// 生成一条「软删除墓碑」CSV 行（仅标记 id 已删除，deleted 列 = true）。
export function tombstoneLine(id: string): string {
  return Papa.unparse(
    [{ id, timestamp: '', exerciseId: '', category: '', fields: '', note: '', plan: '', deleted: 'true' }],
    { columns: CSV_COLUMNS, header: false, newline: '\n' }
  );
}

// 批量生成墓碑行（换行分隔，不含末尾换行）。空数组返回空字符串。
export function tombstoneLines(ids: string[]): string {
  if (ids.length === 0) return '';
  return ids.map((id) => tombstoneLine(id)).join('\n');
}

// 把记录列表整体序列化为完整 CSV 文本（含表头，不含末尾换行）。
// 强制使用规范列序（CSV_HEADER），避免「内存对象键序」泄漏到磁盘导致列顺序漂移。
// 持久化前过滤无效行（timestamp/category 为空）。空数据时只输出表头，
// 避免 Papa.unparse([]) 返回空字符串导致表头丢失。
export function logsToCsv(rows: LogRow[]): string {
  const validRows = rows.filter((row) => !!row.timestamp && !!row.category);
  if (validRows.length === 0) {
    return CSV_HEADER;
  }
  return Papa.unparse(
    validRows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      exerciseId: row.exerciseId || '',       // 缺失则填空，保证 CSV 列对齐
      category: row.category,
      fields: JSON.stringify(normalizeFields(row.fields)), // 规范化为干净对象再序列化，避免脏字段被放大
      note: row.note || '',
      plan: row.plan || '',
      deleted: '',                            // 正常行：空（整体序列化用于压缩/编辑，不含墓碑）
    })),
    { columns: CSV_COLUMNS, newline: '\n' }
  );
}

// 判断 CSV 文本的表头是否为「旧版结构」（与当前规范表头不一致）。
// 仅用于迁移自愈检测：旧文件是 9 列、无 id 列，直接追加新行会导致列错位、数据损坏。
// 比对前剥掉表头行尾可能残留的 '\r'（旧版默认 \r\n 写出的历史文件不判为过时）。
export function isStaleHeader(content: string): boolean {
  if (!content) return false;
  const firstLine = content.split('\n', 1)[0].replace(/\r$/, '');
  return firstLine !== CSV_HEADER;
}

// 把 fields 规范化为干净的普通对象：已是对象直接返回；是 JSON 字符串则尝试解析；
// 其它情况（undefined / 脏字符串 / 非对象）一律回退为 {}，避免序列化出巨型或非法单元格。
export function normalizeFields(f: unknown): Record<string, unknown> {
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
