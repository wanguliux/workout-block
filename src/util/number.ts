/*
 * number.ts —— 输入框数值解析的统一入口。
 *
 * 为什么单独抽出来：`parseFloat('')` 是 `NaN`，而 NaN 在三条路径上都会变坏——
 *  1) JSON.stringify({x: NaN}) → `{"x":null}`，CSV 里落成 null（看着像"填了但没值"）；
 *  2) 必填校验若只判 `undefined || null`，NaN 会被当成"已填"，拦截形同虚设；
 *  3) 计算字段公式见到 NaN 会静默产出 NaN，预览变成 "—"，用户不知道哪一步出的问题。
 * 所以「空/非法 → undefined」这条口径只在这里定义一次，各输入控件统一调用。
 */

/** 解析输入框里的数字：空串 / 非法内容一律返回 undefined（= 未填）。 */
export function parseNumberInput(value: string): number | undefined {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

/** 字段值是否算「没填」：undefined / null / NaN / 空串都算。 */
export function isBlankValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'number') return Number.isNaN(value);
  if (typeof value === 'string') return value.trim() === '';
  return false;
}
