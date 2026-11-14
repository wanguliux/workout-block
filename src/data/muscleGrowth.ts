import { ExerciseMuscle, LogRow } from './types';
import { DEFAULT_DOSE_WEIGHTS, DoseWeights, effectiveWeight } from './muscleStats';

/*
 * muscleGrowth.ts —— 「发展视图」的纯计算（零 IO / 零 DOM）。
 *
 * 发展视图回答的不是「这块肌肉练了多少」（那是恢复视图），而是「**跟自己比，练得够不够**」。
 * 所以它不能用练度总量上色——总量只反映你练了多久，老肌肉永远最红、新肌肉永远最灰。
 * 这里用「近期时间窗内的周均练度 ÷ 中位数时间窗内各周的周练度中位数」：
 *   100% ＝ 与你既往常态持平，<50% 严重不足，>160% 明显加量。
 * 中位数只统计「有练的周」——否则停训的周会把基准拉到 0，比值失去意义。
 *
 * 两个时间窗都可调（肌肉粒度的设置项，单位天，默认 28 / 84）：
 *   近期窗口太短 → 一次大练就把配比顶到 200%；太长 → 变迟钝。默认 4 周是「练了几天能被看见」的折中。
 *   中位数窗口太短 → 基线跟着近期一起动，比值恒为 100%；太长 → 半年前的加量还压着基准。默认 12 周。
 */

/** 发展视图的两个时间窗（单位：天）。 */
export interface GrowthWindow {
  /** 近期窗口：算「最近练得怎么样」，默认 28 天（4 周） */
  recentDays: number;
  /** 中位数窗口：算「你的常态是多少」，默认 84 天（12 周） */
  baselineDays: number;
}

export const DEFAULT_GROWTH_WINDOW: GrowthWindow = { recentDays: 28, baselineDays: 84 };

/** 时间窗取值范围（天）：太短没有统计意义，太长会把陈年训练算进来。 */
const MIN_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 730;

/** 把外部传进来的窗口收敛成合法值（缺项走默认、越界夹紧、中位数窗不短于近期窗）。 */
export function normalizeGrowthWindow(window?: Partial<GrowthWindow>): GrowthWindow {
  const pick = (v: unknown, fallback: number): number => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, Math.round(n)));
  };
  const recentDays = pick(window?.recentDays, DEFAULT_GROWTH_WINDOW.recentDays);
  const baselineDays = Math.max(recentDays, pick(window?.baselineDays, DEFAULT_GROWTH_WINDOW.baselineDays));
  return { recentDays, baselineDays };
}

export interface GrowthRatio {
  /** 近期窗口内的周均练度 */
  recentWeekly: number;
  /** 中位数窗口内「有练的周」的周练度中位数；没练过任何一周时为 null */
  baselineWeekly: number | null;
  /** recentWeekly / baselineWeekly；无基线时为 null（不编数字） */
  ratio: number | null;
  /** 中位数窗口里实际有多少周练过（用于判断基线是否可信） */
  trainedWeeks: number;
  /** 实际生效的时间窗（已收敛，UI 提示用） */
  window: GrowthWindow;
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
  window?: Partial<GrowthWindow>
): GrowthRatio {
  const win = normalizeGrowthWindow(window);
  // 中位数按「周」分桶取，周数由时间窗折算；近期窗口用天数算总量再折成周均，
  // 这样近期窗口可以填 21 天这种非整周的数，而不会被硬生生凑成 3 周。
  const recentWeeks = win.recentDays / 7;

  const perWeek = new Map<number, number>();
  let recentDose = 0;
  for (const log of logs) {
    if (!log.timestamp || !log.exerciseId) continue;
    const em = exerciseMuscleMap.get(log.exerciseId);
    if (!em) continue;
    const hit = em.find((m) => m.muscleId === muscleId);
    if (!hit) continue;
    const daysAgo = daysAgoOf(log.timestamp.slice(0, 10), todayDay);
    if (daysAgo < 0) continue; // 未来日期的记录不计（可能是补录误差）
    if (daysAgo >= win.baselineDays) continue; // 中位数窗口之外的不进基线
    const dose = effectiveWeight(hit, weights);
    if (daysAgo < win.recentDays) recentDose += dose;
    const w = weekIndexOf(daysAgo);
    perWeek.set(w, (perWeek.get(w) ?? 0) + dose);
  }

  const recentWeekly = recentDose / recentWeeks;
  const nonzero = [...perWeek.values()].filter((d) => d > 0);
  const baselineWeekly = median(nonzero);
  const ratio = baselineWeekly && baselineWeekly > 0 ? recentWeekly / baselineWeekly : null;

  return {
    recentWeekly,
    baselineWeekly,
    ratio: ratio === null ? null : Math.round(ratio * 100) / 100,
    trainedWeeks: nonzero.length,
    window: win,
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
