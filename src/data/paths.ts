/*
 * paths.ts —— vault 内数据文件路径的归一规则（唯一实现）。
 *
 * 为什么要有这个文件：用户可能在设置里粘进 Windows 路径（`.block\workout`），
 * 若直接拼进 vault 路径会得到 `.block\workout/workout_logs.csv` 这种混用分隔符的路径，
 * 而 Obsidian 的 getAbstractFileByPath / vault.append 都解析不到（返回 null）——
 * 表现为「记录能显示（进了内存缓存）却写不进 CSV」这类静默失败。
 *
 * 归一后保证三处指向同一路径：**读取、写入、vault modify 事件匹配**。
 * 放在独立模块而不是挂在 DataManager 上，是为了让 CSVStore / ConfigStore 不必依赖
 * DataManager 的运行时代码（它们只吃 getSettings 与 app）。
 */

/** 目录路径归一：反斜杠→正斜杠、去掉尾部斜杠。空值返回空串（= vault 根）。 */
export function normalizeDirPath(dir: string): string {
  return dir.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** 把目录与文件名拼成 vault 相对路径；目录为空则直接返回文件名（vault 根）。 */
export function joinVaultPath(dir: string, filename: string): string {
  const d = normalizeDirPath(dir || '');
  return d ? `${d}/${filename}` : filename;
}
