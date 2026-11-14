import { ExerciseMuscle, LogRow } from './types';
import { DEFAULT_DOSE_WEIGHTS, DoseWeights, effectiveWeight } from './muscleStats';

/*
 * muscleGrowth.ts —— 「发展视图」的纯计算（零 IO / 零 DOM）。
 *
 * 发展视图回答的不是「这块肌肉练了多少」（那是恢复视图），而是「**跟自己比，练得够不够**」。
 * 所以它不能用练度总量上色——总量只反映你练了多久，老肌肉永远最红、新肌肉永远最灰。
 * 这里用「近 4 周周均练度 ÷ 近 12 周周练度中位数」：
 *   100% ＝ 与你近三个月的常态持平，<70% 偏少，>150% 偏多。
 * 中位数只统计「有练的周」——否则停训的周会把基准拉到 0，比值失去意义。
 */

/** 近 N 周练度：下标 0 ＝ 最近 7 天。 */
export interface WeeklyDose {
  weekIndex: number;
  dose: number;
}

export interface GrowthRatio {
  /** 近 4 周的周均练度 */
  recentWeekly: number;
  /** 近 12 周「有练的周」的周练度中位数；没练过任何一周时为 null */
  baselineWeekly: number | null;
  /** recentWeekly / baselineWeekly；无基线时为 null（不编数字） */
  ratio: number | null;
  /** 近 12 周里实际有多少周练过（用于判断基线是否可信） */
  trainedWeeks: number;
}

/** 把「多少天前」折成周下标（0 = 最近 7 天）。 */
function weekIndexOf(daysAgo: number): number {
  return Math.floor(daysAgo / 7);
}

/** 某天与今天相差多少天（今天 = 0）。 */
function daysAgoOf(day: string, todayDay: number): number {
  const [y, m, d] = day.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) / 86400000;
  return Math.round(todayDay - t);
}

/** 中位数（空数组返回 null）。 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 计算某块肌肉的「发展配比」。
 * 口径与热力图/恢复曲线共用 `effectiveWeight`（一份实现两处消费），不做第二套剂量算法。
 */
export function computeGrowthRatio(
  muscleId: string,
  logs: LogRow[],
  exerciseMuscleMap: Map<string, ExerciseMuscle[]>,
  todayDay: number,
  weights: DoseWeights = DEFAULT_DOSE_WEIGHTS,
  recentWeeks = 4,
  baselineWeeks = 12
): GrowthRatio {
  const perWeek = new Map<number, number>();
  for (const log of logs) {
    if (!log.timestamp || !log.exerciseId) continue;
    const em = exerciseMuscleMap.get(log.exerciseId);
    if (!em) continue;
    const hit = em.find((m) => m.muscleId === muscleId);
    if (!hit) continue;
    const daysAgo = daysAgoOf(log.timestamp.slice(0, 10), todayDay);
    if (daysAgo < 0) continue; // 未来日期的记录不计（可能是补录误差）
    const w = weekIndexOf(daysAgo);
    if (w >= baselineWeeks) continue;
    perWeek.set(w, (perWeek.get(w) ?? 0) + effectiveWeight(hit, weights));
  }

  const all = [...perWeek.entries()];
  const recentWeekly = all.filter(([w]) => w < recentWeeks).reduce((n, [, d]) => n + d, 0) / recentWeeks;
  const nonzero = all.filter(([, d]) => d > 0).map(([, d]) => d);
  const baselineWeekly = median(nonzero);
  const ratio = baselineWeekly && baselineWeekly > 0 ? recentWeekly / baselineWeekly : null;

  return {
    recentWeekly,
    baselineWeekly,
    ratio: ratio === null ? null : Math.round(ratio * 100) / 100,
    trainedWeeks: nonzero.length,
  };
}

/**
 * 发展视图的配色档（比值，1.0 = 与自己常态持平）。
 * 与负荷色标方向一致（越多越暖），但含义是「相对自己」而非绝对量。
 */
export const GROWTH_SCALE = [
  { color: '#3b82f6', max: 0.5 }, // 严重不足
  { color: '#06b6d4', max: 0.8 }, // 偏少
  { color: '#22c55e', max: 1.2 }, // 正常
  { color: '#f97316', max: 1.6 }, // 偏多
  { color: '#ef4444', max: Infinity }, // 明显加量
];
