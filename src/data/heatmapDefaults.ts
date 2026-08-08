/*
 * heatmapDefaults.ts —— 热力图公共常量、范围解析与颜色工具（单一真相源）
 * 此前 DEFAULT_HEATMAP_SCALE 与命名色映射在 workoutHeatmap.ts / MuscleEditModal.ts / seed.ts
 * 三处各抄一份，容易漂移（改一处忘另一处）。统一收口到这里，三处 import 同一份。
 * dateWithinRange 原为 workoutHeatmap.ts 私有函数，但该模块依赖 SVG 资源不便单测，
 * 故一并下沉到本纯逻辑模块，既避免重复实现也可直接写单元测试。
 */

import { HeatmapLevel } from './types';

// 热力图默认 4 档分档（蓝/绿/橙/红）：色值 + 该档上限（含）。末档省略 max 表示 +∞。
export const DEFAULT_HEATMAP_SCALE: HeatmapLevel[] = [
  { color: '#3b82f6', max: 5 },
  { color: '#22c55e', max: 10 },
  { color: '#f97316', max: 20 },
  { color: '#ef4444', max: 40 },
];

// 命名色 → hex 映射（兼容旧数据/旧配置里 heatmapLevels 以命名色存储的情况）。
const NAMED_COLOR_MAP: Record<string, string> = {
  blue: '#3b82f6',
  green: '#22c55e',
  orange: '#f97316',
  red: '#ef4444',
};

// 把颜色规整为可写进 SVG fill / CSS background 的值：
// 十六进制原样返回；命名色映射为对应 hex；未知值原样返回（由上层兜底）。
export function colorToCss(color: string): string {
  if (color.startsWith('#')) return color;
  return NAMED_COLOR_MAP[color] ?? color;
}

// 本地当天日期（YYYY-MM-DD），供「最近 N 天」范围计算使用。
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 判断某条记录的日期（YYYY-MM-DD）是否落在 range 范围内。range 支持四种写法：
 *   - 空 / undefined           → 不过滤（全量）
 *   - 'all'                    → 不过滤（全量）
 *   - 纯数字（'30'）或带 d 后缀（'7d'/'30d'/'90d'）→ 最近 N 天（含今天）
 *   - 'YYYY-MM-DD..YYYY-MM-DD' → 闭区间
 * 其余未知写法按「不过滤」处理（写错不丢数据，比静默收窄更安全）。
 */
export function dateWithinRange(dateStr: string, range?: string): boolean {
  if (!range) return true;
  if (range === 'all') return true;
  // 纯数字（如 '30'）或带 d 后缀（'7d' / '30d' / '90d'）统一按「最近 N 天」解析。
  // 修复：旧实现只认 7d/30d/90d，代码块参数里写纯数字 '30' 会静默不过滤（写了等于没写）。
  const daysMatch = range.match(/^(\d+)(?:d)?$/i);
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    const today = new Date(`${todayStr()}T00:00:00`);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const d = new Date(`${dateStr}T00:00:00`);
    return d >= cutoff && d <= today;
  }
  if (range.includes('..')) {
    const [start, end] = range.split('..').map((s) => s.trim());
    return dateStr >= start && dateStr <= end;
  }
  return true;
}
