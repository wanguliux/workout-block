import { Exercise, LogRow, Muscle, RecoveryTuning, WorkoutConfig } from './types';
import { DEFAULT_DOSE_WEIGHTS, DoseWeights, effectiveWeight } from './muscleStats';
import { getMuscleName } from './display';
import { FITNESS_GROUPS, SVG_MUSCLE_CATALOG } from './svgMuscleCatalog';

/*
 * recovery.ts —— 渐进恢复曲线的计算内核（纯函数，零 IO、零 DOM）。
 *
 * 三条时间尺度的账，状态是它们的代数和：
 *   ① 疲劳 F = kf·组数·e^(−Δt/τf)   —— 掉得猛、退得快（τf≈2.5 天）
 *   ② 急性适应 A = ka·组数·e^(−Δt/τa) —— 冲得高、窗口短（τa≈10 天）→ 超量恢复
 *   ③ 长期底子：练着时基准＝100；停训后基准按「近期负荷 R / 维持量」线性下移，最多掉消退深度
 *      R = Σ 组数·e^(−Δt/τc) 是「近期负荷」，τc≈60 天
 *
 * 状态 S(t) = (100 − 消退深度·(1 − 保有能力)) + ΣA − ΣF
 *   练着的时候「保有能力」≈1 → 基准回到 100；
 *   长期不练「保有能力」→0 → 基准滑到 100 − 消退深度（运动前水平）。
 *
 * 为什么这样能画出用户要的那张图：
 *   练完当下 F ≫ A → 掉到 100 以下；F 先退光 A 还在 → 穿过基线冲到峰（超量恢复，这是短窗口，
 *   因为 τa 只有 10 天量级）；之后 A 退 → 回落到 100 附近（维持）；再往后 R 衰减、基准下移 →
 *   曲线缓慢下坡直到运动前水平（消退）。中途再练一次，R 立刻补回、基准抬回 100。
 *
 * 科学口径（见设计方案 §2/§5.2 证据栏）：
 *   · 力量在停训 ≤4 周内基本保持，之后才显著下降（Bosquet 2013 meta，PMID 23347054）；
 *   · 肌横截面积消退更慢，数月量级（20 周停训回到训练前水平，PMID 30991013）；
 *   · 停训不会掉到比训练前更低——所以有下限「运动前水平」而不是无限下降（Mujika & Padilla 2000）；
 *   · 「超量恢复窗口」没有 36–72h 的证据，只是疲劳退光而适应未退的一小段（Kiely 2018）。
 *
 * 多天训练直接线性叠加（每笔账独立衰减），所以「练得太密 → 一直在欠债」是模型自然结果，
 * 不需要额外规则。这也意味着：**曲线不做预测性调整，只把已发生的剂量如实折算成状态。**
 */

/** 曲线参数：疲劳两项、急性适应两项、消退三项。 */
export interface RecoveryParams {
  /** 每组带来的疲劳幅度（点）。默认 2.8 → 8 组约掉 14 点。 */
  fatiguePerSet: number;
  /** 疲劳消退时间常数（天）。默认 2.5 → 约 3 天回到基线。 */
  fatigueTau: number;
  /** 每组带来的急性适应幅度（点）。默认 1.0 → 8 组约 8 点。 */
  fitnessPerSet: number;
  /** 急性适应消退时间常数（天）。默认 10 → 超量恢复窗口约 1 周量级。 */
  fitnessTau: number;
  /** 完全恢复时的状态值（纵轴基准线，也是「练到位」的水平）。 */
  baseline: number;
  /** 停训到底会比「练着时」低多少点。默认 8 → 运动前水平 = baseline − 8。 */
  detrainDepth: number;
  /** 近期负荷的记忆长度（天）。默认 60 → 停训 4 周内几乎不掉，之后才明显下滑。 */
  detrainTau: number;
  /** 维持水平所需的近期负荷量（组）。默认 8 → 近期累计 8 组（按 τd 折现）就算保住。 */
  detrainRef: number;
}

export const DEFAULT_RECOVERY_PARAMS: RecoveryParams = {
  baseline: 100,
  fatiguePerSet: 2.8,
  fatigueTau: 2.5,
  fitnessPerSet: 1.0,
  fitnessTau: 10,
  detrainDepth: 8,
  detrainTau: 60,
  detrainRef: 8,
};

/** 超量恢复窗口（天）：距上次训练超过这个天数，就不再算「超量恢复」，转入维持/消退。 */
export const SUPERCOMP_WINDOW_DAYS = 10;

/** 状态分档（表格与热力图共用一套口径）。 */
export type RecoveryStatus =
  | 'noData' // 没有训练记录
  | 'fatigue' // 刚练完，还在坑里
  | 'recovering' // 正在往回爬
  | 'supercomp' // 超量恢复（短窗口）
  | 'maintain' // 维持：过了窗口但水平还在
  | 'declining'; // 消退：太久没练，水平在下滑

/** 一天里练到某主体的剂量。 */
export interface DoseEntry {
  /** YYYY-MM-DD */
  day: string;
  /** 有效组数：主练记 1、辅练记 0.5 */
  dose: number;
}

/** 折线上的一个采样点。 */
export interface CurvePoint {
  /** 该采样点的时刻（1970 起的天数，带小数）——画图横坐标必须用它，别用 day 反算 */
  t: number;
  /** YYYY-MM-DD（只用于标签展示，丢了日内精度） */
  day: string;
  /** 该时刻的肌肉状态（点） */
  state: number;
}

/** 表格/悬浮提示要的一行摘要。 */
export interface RecoverySummary {
  /** 当前状态（点），100 = 练到位时完全恢复的水平 */
  state: number;
  /** 当前基准（练着时＝baseline，长期不练会向下滑向 floor） */
  baselineNow: number;
  /** 运动前水平（状态下滑的下限） */
  floor: number;
  /** 距上次训练多少天；从没练过时为 null */
  gapDays: number | null;
  /** 状态分档：疲劳 / 恢复中 / 超量恢复 / 维持 / 消退 / 数据不足 */
  status: RecoveryStatus;
  /** 距回基准还需几天；已在基准以上或正在消退（不练不会自己回升）时返回 null */
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
      weight = Math.max(weight, effectiveWeight(link, weights));
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

/** 某时刻的完整求值结果（状态 + 基准 + 距上次训练），供 statusAt / recoverySummary 复用。 */
export interface StateEval {
  /** 状态（点） */
  state: number;
  /** 当前基准：练着时≈baseline，长期不练向下滑向 baseline−detrainDepth */
  base: number;
  /** 距上次训练的天数；从没练过为 null */
  gapDays: number | null;
}

/**
 * 任意时刻求值。只累加「该时刻之前」的剂量——未来还没练，账还没发生。
 *
 * 近期负荷 R 用同一个递减窗口累加，再经 1−e^(−R/维持量) 饱和成「保有能力」0..1：
 * 练得够 → 1（基准＝100）；停了 → 0（基准＝100−消退深度）。饱和函数而不是线性，
 * 是因为停训前期的损失本来就很小（4 周内基本保持），越往后掉得越快，最后触底不再掉。
 */
export function evalAt(params: RecoveryParams, doses: DoseEntry[], atDay: number): StateEval {
  let fitness = 0;
  let fatigue = 0;
  let recentDose = 0;
  let lastDay: number | null = null;
  for (const d of doses) {
    const start = toDayNum(d.day);
    if (start > atDay) break; // doses 已按日期升序，后面的更晚
    const dt = atDay - start;
    fitness += params.fitnessPerSet * d.dose * Math.exp(-dt / params.fitnessTau);
    fatigue += params.fatiguePerSet * d.dose * Math.exp(-dt / params.fatigueTau);
    recentDose += d.dose * Math.exp(-dt / params.detrainTau);
    lastDay = start;
  }
  // 「保有能力」＝min(1, 近期负荷 / 维持量)：达到维持量就算保住，超出不额外加成。
  // 用线性封顶而不是饱和曲线，是为了不让「偶尔练一次」被算成半吊子水平——
  // 只要近期负荷够了就视为练着，消退只在真的停下来之后才发生。
  const keep = params.detrainRef > 0 ? Math.min(1, recentDose / params.detrainRef) : 1;
  // 从没练过 → 就是「运动前水平」：100 是练到位的水平，没练过的底子本来就低一档。
  // 这样曲线左端才不会出现「100 突然掉到 90」的假跳变（历史第一笔剂量之前就是未训练态）。
  if (lastDay === null) {
    const untrained = params.baseline - params.detrainDepth;
    return { state: untrained, base: untrained, gapDays: null };
  }
  const base = params.baseline - params.detrainDepth * (1 - keep);
  return { state: base + fitness - fatigue, base, gapDays: atDay - lastDay };
}

/** 任意时刻的肌肉状态（只要数值时用这个）。 */
export function stateAt(params: RecoveryParams, doses: DoseEntry[], atDay: number): number {
  return evalAt(params, doses, atDay).state;
}

/**
 * 状态分档。判据是「距上次训练多久」＋「状态相对 100 的位置」，不是单纯看数值高低：
 *   · ≤2 天还在坑里 → 疲劳；≤5 天还没超过基线 → 恢复中；
 *   · 3~10 天且高于基线 → 超量恢复（**短窗口**，过了就不再叫超量恢复）；
 *   · 超过 10 天且水平还在 → 维持；
 *   · 超过 10 天且掉到基线以下 → 消退（太久没练）。
 * 用固定 100 而不是漂移基准做比较：漂移基准和状态是同一根轴上的两条线，停久了两者一起下移，
 * 就会永远判成「维持」，看不出消退。
 */
export function statusAt(params: RecoveryParams, doses: DoseEntry[], atDay: number): RecoveryStatus {
  const { state, gapDays } = evalAt(params, doses, atDay);
  if (gapDays === null) return 'noData';
  const b = params.baseline;
  if (gapDays <= 2) return state < b - 3 ? 'fatigue' : 'recovering';
  if (gapDays <= SUPERCOMP_WINDOW_DAYS) {
    return state >= b + 0.5 ? 'supercomp' : gapDays <= 5 ? 'recovering' : 'maintain';
  }
  return state >= b - 1 ? 'maintain' : 'declining';
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
    // t 必须原样带走：只留 day 会把同一天的 4 个采样点压成同一个横坐标，
    // 画出来是每天一根竖线的「锯齿」，而不是曲线。
    points.push({ t, day: fromDayNum(t), state: stateAt(params, doses, t) });
  }
  return points;
}

/**
 * 当前状态 / 距离基准的天数 / 峰值。
 * 「恢复完成」的口径＝状态重新站回**当时的基准**（练着时是 100，长期不练时基准本身在下移）。
 * 已经在基准以上（超量恢复窗口）或正在消退时 etaDays = null——悬浮提示据此不显示「恢复：N 天」
 * （消退不练是回不来的，报一个「还差 200 天」只会误导）。
 */
export function recoverySummary(
  params: RecoveryParams,
  doses: DoseEntry[],
  todayDay: number,
  lookAheadDays = 30
): RecoverySummary {
  const now = evalAt(params, doses, todayDay);
  const hasData = doses.length > 0;
  const status = statusAt(params, doses, todayDay);
  const floor = params.baseline - params.detrainDepth;

  // 往后扫峰值：只关心「从现在起」的窗口，历史峰值没决策意义
  let peak: { day: string; state: number } | null = null;
  let etaDays: number | null = null;

  if (hasData) {
    let maxState = -Infinity;
    let maxAt = todayDay;
    const step = 0.05;
    let wasBelow = false;
    for (let t = todayDay; t <= todayDay + lookAheadDays + 1e-9; t += step) {
      const e = evalAt(params, doses, t);
      if (e.state > maxState) {
        maxState = e.state;
        maxAt = t;
      }
      // 交点：从基准下方穿到基准上方的那一刻
      if (etaDays === null) {
        if (e.state < e.base) wasBelow = true;
        else if (wasBelow) etaDays = t - todayDay;
      }
    }
    if (now.state >= now.base || status === 'declining') etaDays = null;
    if (maxState > now.base) peak = { day: fromDayNum(maxAt), state: maxState };
  }

  return {
    state: now.state,
    baselineNow: now.base,
    floor,
    gapDays: now.gapDays,
    status,
    etaDays,
    peak,
    hasData,
  };
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
    // 消退深度允许 0（=关掉消退），其余两项必须为正，否则除零
    detrainDepth:
      typeof tuning.detrainDepth === 'number' && Number.isFinite(tuning.detrainDepth) && tuning.detrainDepth >= 0
        ? tuning.detrainDepth
        : base.detrainDepth,
    detrainTau: pick(tuning.detrainTau, base.detrainTau),
    detrainRef: pick(tuning.detrainRef, base.detrainRef),
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

  // ① 直接命中单块肌肉（id / 显示名）
  const muscle = config.muscles.find(
    (m) => m.id.toLowerCase() === lower || getMuscleName(m).toLowerCase() === lower
  );
  if (muscle) return { label: getMuscleName(muscle), muscleIds: [muscle.id] };

  // ② 命中肌群（key / 中英文名）
  const group = FITNESS_GROUP_LOOKUP().find(
    (g) => g.key === lower || g.zh === raw || g.en.toLowerCase() === lower
  );
  if (group) {
    const matched = config.muscles.filter((m) => muscleGroupOf(m) === group.key);
    const ids = matched.map((m) => m.id);
    // 肌群只对应一块肌肉时，用这块肌肉自己的名字——否则同一块肌肉会在「单块视图」里叫
    // 肌群名（股四头肌）、在「全部肌肉表格」里叫肌肉名（股四头），两处不一致
    const label = ids.length === 1 && matched[0] ? getMuscleName(matched[0]) : group.zh;
    return { label, muscleIds: ids };
  }

  // ③ 模糊：显示名 / id 包含关键字，或它的 SVG 区域中英文名能对上
  //（未命名肌肉（只有 id 如 quads）可因此用「股四头肌」这类解剖名引用）
  const fuzzy = config.muscles.filter((m) => {
    if (getMuscleName(m).includes(raw) || m.id.includes(lower)) return true;
    return (m.svgRegionIds ?? []).some((regionId) => {
      const entry = SVG_MUSCLE_CATALOG.find((e) => e.id === regionId);
      if (!entry) return false;
      return entry.zh === raw || entry.zh.includes(raw) || entry.en.toLowerCase() === lower;
    });
  });
  if (fuzzy.length === 1) return { label: getMuscleName(fuzzy[0]), muscleIds: [fuzzy[0].id] };
  return { label: raw, muscleIds: [] };
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
