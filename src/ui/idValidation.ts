// 训练项 ID / 类别 ID 的轻量实时校验工具。
//
// 一个合法的 ID 会被当成 CSV 单元格写入记录表，同时作为 exerciseId / category /
// associatedTypes 的稳定键被多处引用。因此它不能包含 CSV 分隔敏感字符：
//   - 逗号 ","    → 会和 CSV 列分隔符冲突，解析时整行错位
//   - 双引号 "\""  → CSV 转义字符，会破坏单元格边界
//   - 换行 "\n\r" → 会让一条记录断成多行
// 空格允许（保存时会归一为下划线，见 ExerciseModal/TypeModal 的 save()）。

// 匹配所有「非法 ID 字符」的正则（逗号 / 双引号 / 换行 / 回车）。
export const INVALID_ID_RE = /[,"\n\r]/;

// 判断一个字符串是否含有非法 ID 字符。返回 true 表示不合法。
export function isInvalidId(value: string): boolean {
  return INVALID_ID_RE.test(value);
}
