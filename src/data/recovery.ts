import { Exercise, LogRow, Muscle, RecoveryTuning, WorkoutConfig } from './types';
import { DEFAULT_DOSE_WEIGHTS, DoseWeights, roleWeight } from './muscleStats';
import { FITNESS_GROUPS, SVG_MUSCLE_CATALOG } from './svgMuscleCatalog';

/*
 * recovery.ts —— 渐进恢复曲线的计算内核（纯函数，零 IO、零 DOM）。
 *
 * 一句话模型：**双指数冲激-响应**（Banister 模型的简化版）。
 * 每次训练给某块肌肉留下两笔账，各自按指数衰减：
 *   ① 疲劳 F = kf·组数·e^(−Δt/τf)   —— 幅度大、退得快（τf 约 2~3 天）
 *   ② 适应 A = ka·组数·e^(−Δt/τa)   —— 幅度小、退得慢（τa 约 2~3 周）
 * 肌肉状态 S(t) = 100 + ΣA − ΣF。
 *
 * 为什么这条公式能画出「掉→回升→超过基线→慢慢回落」：
 *   练完当下 F 远大于 A，所以 S 掉到 100 以下；随天数推移 F 先退光、A 还在，
 *   S 穿过 100 冲到峰值（超量恢复），之后 A 也慢慢退，S 回落到 100 附近；
 *   如果下次训练在 A 没退完时插进来，A 会叠加，基线就被顶上去——这正是渐进超负荷。
 *
 * 多天训练直接线性叠加（每笔账独立衰减），所以「练得太密 → 一直在欠债」是模型自然结果，
 * 不需要额外规则。这也意味着：**曲线不做预测性调整，只把已发生的剂量如实折算成状态。**
 */

/** 曲线参数：前两个管「掉多少/掉多久」，后两个管「抬多少/抬多久」。 */
export interface RecoveryParams {
  /** 每组带来的疲劳幅度（点）。默认 2.8 → 8 组约掉 14 点。 */
  fatiguePerSet: number;
  /** 疲劳消退时间常数（天）。默认 2.5 → 约 3 天回到基线。 */
  fatigueTau: number;
  /** 每组带来的适应幅度（点）。默认 1.0 → 8 组约 8 点。 */
  fitnessPerSet: number;
  /** 适应消退时间常数（天）。默认 18 → 抬升的基线约 3 周退平。 */
  fitnessTau: number;
  /** 完全恢复时的状态值（纵轴基准线）。 */
  baseline: number;
}

export const DEFAULT_RECOVERY_PARAMS: RecoveryParams = {
  baseline: 100,
  fatiguePerSet: 2.8,
  fatigueTau: 2.5,
  fitnessPerSet: 1.0,
  fitnessTau: 18,
};

/** 一天里练到某主体的剂量。 */
export interface DoseEntry {
  /** YYYY-MM-DD */
  day: string;
  /** 有效组数：主练记 1、辅练记 0.5 */
  dose: number;
}

/** 折线上的一个采样点。 */
export interface CurvePoint {
  /** YYYY-MM-DD（含小数的时刻会保留到 day 精度，展示时按天取整） */
  day: string;
  /** 该时刻的肌肉状态（点） */
  state: number;
}

/** 表格/悬浮提示要的一行摘要。 */
export interface RecoverySummary {
  /** 当前状态（点），100 = 完全恢复 */
  state: number;
  /** 距回基线还需几天；已回到基线以上（超量恢复窗口）或没有训练数据时返回 null */
  etaDays: number | null;
  /** 未来一段时间内的峰值状态与到达日期（无数据时为 null） */
  peak: { day: string; state: number } | null;
  /** 窗口内是否有过训练记录 */
  hasData: boolean;
}

const DAY_MS = 86400000;

/** 把 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:mm' 转成「1970 起的天数」（带小数，UTC 计算，避开夏令时）。 */
export function toDayNum(dateStr: string): number {
  const [datePart, timePart] = dateStr.trim().split(/[ T]/);
  const [y, m, d] = datePart.split('-').map(Number);
  let frac = 0;
  if (timePart) {
    const [hh, mm] = timePart.split(':').map(Number);
    frac = ((hh || 0) * 60 + (mm || 0)) / 1440;
  }
  return Date.UTC(y, m - 1, d) / DAY_MS + frac;
}

/** 天数（可带小数）→ 'YYYY-MM-DD'。 */
export function fromDayNum(num: number): string {
  const ms = Math.round(Math.floor(num) * DAY_MS);
  const dt = new Date(ms);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * 某主体每天的剂量（有效组数）。
 * 一条 LogRow = 一组，所以「当天该主体有几条记录」就是组数；
 * 主练/辅练的折算系数取 `DoseWeights`（默认 1 / 0.5）——
 * **这一份权重与热力图共用同一实现**（`muscleStats.roleWeight`），
 * 两处若各写一套，热力图和曲线会给出两个不同的「这周练了多少组」。
 */
export function collectDoses(
  logs: LogRow[],
  exercises: Exercise[],
  subjectMuscleIds: string[],
  fromDay?: number,
  weights: DoseWeights = DEFAULT_DOSE_WEIGHTS
): DoseEntry[] {
  const wanted = new Set(subjectMuscleIds);
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const perDay = new Map<string, number>();
  for (const log of logs) {
    const ex = log.exerciseId ? exById.get(log.exerciseId) : undefined;
    if (!ex?.muscles?.length) continue;
    let weight = 0;
    for (const link of ex.muscles) {
      if (!wanted.has(link.muscleId)) continue;
      // 同一动作对同一肌群重复登记时取最大权重（主练优先），不累加
      weight = Math.max(weight, roleWeight(link.role, weights));
    }
    if (weight === 0) continue;
    const day = log.timestamp.slice(0, 10);
    if (fromDay !== undefined && toDayNum(day) < Math.floor(fromDay)) continue;
    perDay.set(day, (perDay.get(day) ?? 0) + weight);
  }
  return [...perDay.entries()]
    .map(([day, dose]) => ({ day, dose }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/**
 * 任意时刻的肌肉状态。
 * 只累加「该时刻之前」的剂量——未来还没练，账还没发生。
 */
export function stateAt(params: RecoveryParams, doses: DoseEntry[], atDay: number): number {
  let state = params.baseline;
  for (const d of doses) {
    const start = toDayNum(d.day);
    if (start > atDay) break; // doses 已按日期升序，后面的更晚
    const dt = atDay - start;
    state +=
      params.fitnessPerSet * d.dose * Math.exp(-dt / params.fitnessTau) -
      params.fatiguePerSet * d.dose * Math.exp(-dt / params.fatigueTau);
  }
  return state;
}

/**
 * 采样成折线点。stepDays 默认 0.25 天（6 小时）——足够平滑，点数也可控
 * （28 天 ≈ 112 点，一张 SVG 毫无压力）。
 */
export function sampleCurve(
  params: RecoveryParams,
  doses: DoseEntry[],
  fromDay: number,
  toDay: number,
  stepDays = 0.25
): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (let t = fromDay; t <= toDay + 1e-9; t += stepDays) {
    points.push({ day: fromDayNum(t), state: stateAt(params, doses, t) });
  }
  return points;
}

/**
 * 当前状态 / 距回基线天数 / 峰值。
 * 「恢复完成」的口径＝状态重新站回基线（100）：那一刻之后进入超量恢复窗口。
 * 已经在基线以上（或从没练过）时 etaDays = null——悬浮提示据此不显示「恢复：N 天」。
 */
export function recoverySummary(
  params: RecoveryParams,
  doses: DoseEntry[],
  todayDay: number,
  lookAheadDays = 30
): RecoverySummary {
  const state = stateAt(params, doses, todayDay);
  const hasData = doses.length > 0;

  // 往前后各找峰值：只关心「从现在起」的窗口，历史峰值没决策意义
  let peak: { day: string; state: number } | null = null;
  let etaDays: number | null = null;

  if (hasData) {
    let maxState = -Infinity;
    let maxAt = todayDay;
    const step = 0.05;
    for (let t = todayDay; t <= todayDay + lookAheadDays + 1e-9; t += step) {
      const s = stateAt(params, doses, t);
      if (s > maxState) {
        maxState = s;
        maxAt = t;
      }
      if (etaDays === null && state < params.baseline && s >= params.baseline) {
        etaDays = t - todayDay;
      }
    }
    // 已在基线以上 → 正在超量恢复窗口，不需要「还差几天」
    if (state >= params.baseline) etaDays = null;
    if (maxState > params.baseline) peak = { day: fromDayNum(maxAt), state: maxState };
  }

  return { state, etaDays, peak, hasData };
}

/**
 * 逐肌微调合并：肌肉级字段优先，缺省项回落到全局默认。
 * 形态与热力图的三级回退（肌肉 → 全局 → 内置）一致，只是这里没有代码块中间层。
 */
export function mergeRecoveryParams(base: RecoveryParams, tuning?: RecoveryTuning): RecoveryParams {
  if (!tuning) return base;
  const pick = (v: number | undefined, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
  return {
    baseline: base.baseline,
    fatiguePerSet: pick(tuning.fatiguePerSet, base.fatiguePerSet),
    fatigueTau: pick(tuning.fatigueTau, base.fatigueTau),
    fitnessPerSet: pick(tuning.fitnessPerSet, base.fitnessPerSet),
    fitnessTau: pick(tuning.fitnessTau, base.fitnessTau),
  };
}

/**
 * 求某个曲线主体（一块肌肉 / 一个肌群）实际生效的参数。
 * - 单块肌肉：用它自己 `recovery` 里的覆盖值，缺项回落全局；
 * - 肌群（多块肌肉）：**一律用全局参数**——多块肌肉各有各的 tau 时，合并成一条曲线只能取其一，
 *   取谁的都说不清，不如统一用全局，并在 UI 说明「肌群曲线不读逐肌微调」。
 */
export function paramsForSubject(
  config: WorkoutConfig,
  muscleIds: string[],
  base: RecoveryParams = DEFAULT_RECOVERY_PARAMS
): RecoveryParams {
  if (muscleIds.length !== 1) return base;
  const muscle = config.muscles.find((m) => m.id === muscleIds[0]);
  return mergeRecoveryParams(base, muscle?.recovery);
}

/**
 * 把代码块参数里的主体（肌肉名 / id / 肌群名 / 肌群 key）解析成肌肉 id 列表。
 * 肌群走既有静态 14 群：肌肉的 svgRegionIds → 目录里的 fitnessGroup。
 * 解析不到返回空数组（调用方显示「找不到该肌肉」）。
 */
export function resolveSubject(config: WorkoutConfig, key: string): { label: string; muscleIds: string[] } {
  const raw = (key || '').trim();
  if (!raw) return { label: '', muscleIds: [] };
  const lower = raw.toLowerCase();

  // ① 直接命中单块肌肉（id / name）
  const muscle = config.muscles.find(
    (m) => m.id.toLowerCase() === lower || (m.name || '').toLowerCase() === lower
  );
  if (muscle) return { label: displayName(muscle), muscleIds: [muscle.id] };

  // ② 命中肌群（key / 中英文名）
  const group = FITNESS_GROUP_LOOKUP().find(
    (g) => g.key === lower || g.zh === raw || g.en.toLowerCase() === lower
  );
  if (group) {
    const ids = config.muscles.filter((m) => muscleGroupOf(m) === group.key).map((m) => m.id);
    return { label: group.zh, muscleIds: ids };
  }

  // ③ 模糊：肌肉名包含关键字
  const fuzzy = config.muscles.filter((m) => displayName(m).includes(raw) || m.id.includes(lower));
  if (fuzzy.length === 1) return { label: displayName(fuzzy[0]), muscleIds: [fuzzy[0].id] };
  return { label: raw, muscleIds: [] };
}

function displayName(m: Muscle): string {
  return m.name || m.id;
}

/** 单块肌肉归属的肌群（取第一条 svgRegionId 的 fitnessGroup；纯肌肉无映射时返回空串）。 */
export function muscleGroupOf(m: Muscle): string {
  for (const regionId of m.svgRegionIds ?? []) {
    const entry = SVG_MUSCLE_CATALOG.find((e) => e.id === regionId);
    if (entry) return entry.fitnessGroup;
  }
  return '';
}

function FITNESS_GROUP_LOOKUP() {
  return FITNESS_GROUPS;
}
