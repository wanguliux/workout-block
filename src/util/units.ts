/*
 * units.ts —— 重量单位换算工具
 * 用户的体重/负重可能用 kg（公斤）或 lb（磅）显示。
 * 换算关系：1 kg ≈ 2.2 lb（这里用近似系数，足够日常训练记录使用）。
 * 设计原则：内部存储统一用 kg，只在「显示」和「解析用户输入」时按用户偏好换算。
 * 这样无论用户选 kg 还是 lb，底层数据始终是统一的 kg，互转不会丢失基准。
 */

// kg → lb：乘 2.2 后保留 1 位小数（先 *10 取整再 /10，相当于四舍五入保留 1 位）
export function kgToLb(kg: number): number {
  return Math.round(kg * 2.2 * 10) / 10;
}

// lb → kg：除以 2.2 后四舍五入到整数
export function lbToKg(lb: number): number {
  return Math.round(lb / 2.2);
}

// 把内部 kg 数值格式化成界面显示文字
// 若用户偏好 lb，则先换算成 lb 并保留 1 位小数；否则直接显示 kg 数值
export function formatMass(value: number, unit: 'kg' | 'lb'): string {
  if (unit === 'lb') {
    return kgToLb(value).toFixed(1);
  }
  return value.toString();
}

// 解析用户输入的字符串（如输入框里填的 "150"）成内部存储的 kg 数值
// 若用户偏好 lb，则先把输入当 lb 转成 kg 存储；否则直接当 kg
export function parseMass(value: string, unit: 'kg' | 'lb'): number {
  const numValue = parseFloat(value);
  if (unit === 'lb') {
    return lbToKg(numValue);
  }
  return numValue;
}