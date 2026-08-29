import type { QueryRequest, QueryResponse } from './types';
import type { LogRow, StatDef, TrainingPlanInstance, WorkoutConfig } from '../data/types';
import { computeStat } from '../data/statExpr';
import { buildExerciseMuscleMap, computeMuscleValue, computeMuscleRestDays } from '../data/muscleStats';
import { getExerciseNameById, getTrainingTypeName } from '../data/display';

/*
 * queryHandler.ts —— P0 查询执行的唯一真相源（纯函数，接收预加载数据）。
 *
 * 插件侧 handleQueryRequest() 和 CLI cmdQuery() 共用同一份 executeQuery()。
 * 数据由调用方预加载传入：插件传 DataManager 内存缓存，CLI 传 loadEnv() 的
 * CSV 解析结果。新增查询维度时只需在 executeQuery 的 switch 加一个 case +
 * 对应 handler 函数（维度元数据在 capability.ts 加一行）。
 */

/** workout-block 查询所需预加载数据包。 */
export interface WorkoutQueryData {
  /** 训练记录（插件=DataManager.getLogs()，CLI=CSV 文件解析） */
  records: LogRow[];
  /** 配置（肌肉映射/训练项/计划等） */
  config: WorkoutConfig;
}

/** 闭区间日期范围。 */
export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

/** summary entries 的单元形状。 */
type Entry = { key: string; value: number; unit?: string };

// ===== 日期工具（纯函数，避免引入 CLI 依赖）=====

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 本地当天日期（YYYY-MM-DD）。 */
export function todayStr(): string {
  return toDateStr(new Date());
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toDateStr(dt);
}

function monthStart(dateStr: string): string {
  return dateStr.slice(0, 8) + '01';
}

function lastDayOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  return `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`;
}

/** ISO 周几（周一=1 … 周日=7）。 */
function isoWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 ? 7 : dow;
}

/** 某日期所在 ISO 周的周一。 */
export function weekMonday(dateStr: string): string {
  return addDays(dateStr, -(isoWeekday(dateStr) - 1));
}

function inRange(day: string, range?: DateRange): boolean {
  if (!range) return true;
  return day >= range.from && day <= range.to;
}

/**
 * 解析 dateRange / preset 筛选器 → 闭区间。优先级：dateRange > preset > 默认 this-week。
 * 结果可直接转成 `from..to` 字符串交给 dateWithinRange / computeMuscleValue。
 */
export function resolveDateRange(filters?: Record<string, unknown>): DateRange {
  const dr = filters?.['dateRange'] as { from?: string; to?: string } | undefined;
  if (dr && dr.from && dr.to) return { from: dr.from, to: dr.to };

  const preset = filters?.['preset'] as string | undefined;
  const today = todayStr();
  switch (preset) {
    case 'this-week':
      return { from: weekMonday(today), to: today };
    case 'last-week': {
      const monday = weekMonday(today);
      return { from: addDays(monday, -7), to: addDays(monday, -1) };
    }
    case 'this-month':
      return { from: monthStart(today), to: today };
    case 'last-month': {
      const thisMonthStart = monthStart(today);
      const lastMonthEnd = addDays(thisMonthStart, -1);
      return { from: monthStart(lastMonthEnd), to: lastMonthEnd };
    }
    case '30d':
      return { from: addDays(today, -30), to: today };
    case '90d':
      return { from: addDays(today, -90), to: today };
    case 'custom':
      return { from: '', to: '' }; // 必须显式传 dateRange；空区间表示「不过滤」
    default:
      return { from: weekMonday(today), to: today }; // 默认 this-week
  }
}

// ===== StatDef 解析（优先复用配置，缺失时按默认字段 key 现场构造）=====

/** 从 strength 训练类型解析 weight/reps/duration 字段 key（用户可能自定义 FieldDef.key）。 */
function strengthFields(config: WorkoutConfig): { weight?: string; reps?: string; duration?: string } {
  const type = config.trainingTypes.find((tt) => tt.id === 'strength');
  const fields = type?.fields ?? [];
  const weight = fields.find((f) => f.mass)?.key ?? fields.find((f) => f.key === 'weight')?.key;
  const reps = fields.find((f) => f.key === 'reps')?.key ?? fields.find((f) => f.inputType === 'number' && f.unitLabel === '次')?.key;
  const duration = fields.find((f) => f.inputType === 'duration')?.key;
  return { weight, reps, duration };
}

function getVolumeStat(config: WorkoutConfig): StatDef {
  const existing = config.statistics.find((s) => s.id === 'volume');
  if (existing) return existing;
  const { weight, reps } = strengthFields(config);
  return {
    id: 'volume', name: '训练总量', associatedTypes: ['strength'], granularity: 'daily', enabled: true,
    formula: { mode: 'builder', builder: { kind: 'productSum', fieldA: reps ?? 'reps', fieldB: weight ?? 'weight' } },
  };
}

function getOneRepMaxStat(config: WorkoutConfig): StatDef {
  const existing = config.statistics.find((s) => s.id === 'oneRepMax');
  if (existing) return existing;
  const { weight, reps } = strengthFields(config);
  return {
    id: 'oneRepMax', name: '1RM 估算', associatedTypes: ['strength'], granularity: 'daily', enabled: true,
    formula: { mode: 'builder', builder: { kind: 'oneRepMax', weightField: weight ?? 'weight', repsField: reps ?? 'reps' } },
  };
}

function getMaxWeightStat(config: WorkoutConfig): StatDef {
  const { weight } = strengthFields(config);
  const wf = weight ?? 'weight';
  return {
    id: 'maxWeight', name: '最大重量', associatedTypes: ['strength'], granularity: 'daily', enabled: true,
    formula: { mode: 'builder', builder: { kind: 'max', field: wf } },
  };
}

function getSumDurationStat(config: WorkoutConfig): StatDef {
  const { duration } = strengthFields(config);
  const df = duration ?? 'duration_sec';
  return {
    id: 'sumDuration', name: '总时长', associatedTypes: ['aerobic', 'bodyweight'], granularity: 'daily', enabled: true,
    formula: { mode: 'builder', builder: { kind: 'sum', field: df } },
  };
}

function getCountStat(): StatDef {
  return {
    id: 'count', name: '组数', associatedTypes: [], granularity: 'daily', enabled: true,
    formula: { mode: 'builder', builder: { kind: 'count' } },
  };
}

// ===== 计划调度助手 =====

/** 某计划在指定日期是否排期（timeRule：date=指定日期；weekday=周几包含）。 */
export function isPlanScheduledOn(plan: TrainingPlanInstance, dateStr: string): boolean {
  if (plan.timeRule.type === 'date') return (plan.timeRule.date ?? '') === dateStr;
  return (plan.timeRule.weekdays ?? []).includes(isoWeekday(dateStr));
}

/**
 * 周期口径的完成统计：区间内计划「排期到」的组总数 vs 已完成的组数。
 * 完成状态来自 completedSets（key=`${exerciseId}#${setId}`，value=完成日期 YYYY-MM-DD）。
 */
export function countPeriodPending(
  plan: TrainingPlanInstance,
  from: string,
  to: string,
  completedSets?: Record<string, string>
): { total: number; done: number } {
  const enabled = plan.items.filter((i) => i.enabled);
  const setsPerDay = enabled.reduce((n, i) => n + i.sets.length, 0);
  let scheduledDates = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (isPlanScheduledOn(plan, d)) scheduledDates++;
  }
  const total = setsPerDay * scheduledDates;
  const setKeys = new Set<string>();
  for (const item of enabled) {
    for (const s of item.sets) setKeys.add(`${item.exerciseId}#${s.id}`);
  }
  let done = 0;
  for (const [key, date] of Object.entries(completedSets ?? {})) {
    if (setKeys.has(key) && date >= from && date <= to) done++;
  }
  return { total, done };
}

// ===== 各维度 handler =====

function scopedLogs(data: WorkoutQueryData, range?: DateRange): LogRow[] {
  if (!range || !range.from) return data.records.slice();
  return data.records.filter((r) => r.timestamp && inRange(r.timestamp.slice(0, 10), range));
}

function handleTrainingSummary(data: WorkoutQueryData, request: QueryRequest, range: DateRange): QueryResponse {
  const scoped = scopedLogs(data, range);
  const entries: Entry[] = [];
  const days = new Set(scoped.map((r) => r.timestamp.slice(0, 10))).size;
  entries.push({ key: '训练天数', value: days });
  entries.push({ key: '总组数', value: Math.round(computeStat(getCountStat(), scoped)) });
  entries.push({ key: '训练总量(kg)', value: computeStat(getVolumeStat(data.config), scoped), unit: 'kg' });
  entries.push({ key: '总时长(秒)', value: computeStat(getSumDurationStat(data.config), scoped), unit: '秒' });
  for (const tt of data.config.trainingTypes) {
    const cnt = scoped.filter((r) => r.category === tt.id).length;
    entries.push({ key: `${getTrainingTypeName(tt)}组数`, value: cnt });
  }
  return { dimension: request.dimension, mode: 'summary', data: { entries }, shapeHint: 'kv-pairs' };
}

function handleMuscleVolume(data: WorkoutQueryData, request: QueryRequest, range: DateRange): QueryResponse {
  const scoped = scopedLogs(data, range);
  const em = buildExerciseMuscleMap(data.config);
  const stat = getVolumeStat(data.config);
  const rangeStr = range.from ? `${range.from}..${range.to}` : undefined;
  const muscleId = request.filters?.['muscleId'] as string | undefined;
  const muscles = muscleId
    ? data.config.muscles.filter((m) => m.id === muscleId)
    : data.config.muscles;
  const entries = muscles
    .map((m) => ({ key: m.id, value: computeMuscleValue(m, stat, rangeStr, scoped, em, data.config), unit: 'kg' }))
    .sort((a, b) => b.value - a.value);
  return { dimension: request.dimension, mode: 'summary', data: { entries }, shapeHint: 'kv-pairs' };
}

function handleMuscleRest(data: WorkoutQueryData, request: QueryRequest): QueryResponse {
  const em = buildExerciseMuscleMap(data.config);
  const muscleId = request.filters?.['muscleId'] as string | undefined;
  const muscles = muscleId
    ? data.config.muscles.filter((m) => m.id === muscleId)
    : data.config.muscles;
  const entries = muscles
    .map((m) => ({ key: m.id, value: computeMuscleRestDays(m.id, data.records, em), unit: '天' }))
    .sort((a, b) => b.value - a.value);
  return { dimension: request.dimension, mode: 'summary', data: { entries }, shapeHint: 'kv-pairs' };
}

function handleStrengthProgress(data: WorkoutQueryData, request: QueryRequest, range: DateRange): QueryResponse {
  const scoped = scopedLogs(data, range);
  const exId = request.filters?.['exerciseId'] as string | undefined;
  const exercises = exId
    ? data.config.exercises.filter((e) => e.id === exId)
    : data.config.exercises;
  const oneRepMaxStat = getOneRepMaxStat(data.config);
  const maxWeightStat = getMaxWeightStat(data.config);
  const entries: Entry[] = [];
  for (const ex of exercises) {
    const logs = scoped.filter((r) => r.exerciseId === ex.id);
    if (logs.length === 0) continue;
    const name = getExerciseNameById(data.config.exercises, ex.id) || ex.id;
    entries.push({ key: `${name}-1RM(kg)`, value: computeStat(oneRepMaxStat, logs), unit: 'kg' });
    entries.push({ key: `${name}-最大重量(kg)`, value: computeStat(maxWeightStat, logs), unit: 'kg' });
  }
  return { dimension: request.dimension, mode: 'summary', data: { entries }, shapeHint: 'kv-pairs' };
}

function handlePlanProgress(data: WorkoutQueryData, request: QueryRequest, range: DateRange): QueryResponse {
  const plans = data.config.plans ?? [];
  const rangeStr: DateRange = range && range.from ? range : { from: weekMonday(todayStr()), to: todayStr() };
  const entries: Entry[] = [];
  for (const plan of plans) {
    const { total, done } = countPeriodPending(plan, rangeStr.from, rangeStr.to, plan.completedSets);
    const pct = total > 0 ? Math.round((done / total) * 1000) / 10 : 0;
    entries.push({ key: `${plan.name}-完成率(%)`, value: pct, unit: '%' });
    entries.push({ key: `${plan.name}-已完成组数`, value: done });
    entries.push({ key: `${plan.name}-总组数`, value: total });
  }
  return { dimension: request.dimension, mode: 'summary', data: { entries }, shapeHint: 'kv-pairs' };
}

function handleRawRecords(data: WorkoutQueryData, request: QueryRequest, range: DateRange): QueryResponse {
  const f = request.filters ?? {};
  const category = f['category'] as string | undefined;
  const exId = f['exerciseId'] as string | undefined;
  const muId = f['muscleId'] as string | undefined;

  let rows = scopedLogs(data, range);
  if (category) rows = rows.filter((r) => r.category === category);
  if (exId) rows = rows.filter((r) => r.exerciseId === exId);
  if (muId) {
    const em = buildExerciseMuscleMap(data.config);
    rows = rows.filter((r) => r.exerciseId && em.get(r.exerciseId)?.some((m) => m.muscleId === muId));
  }
  rows = rows.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const total = rows.length;
  const page = request.pagination?.page ?? 1;
  const pageSize = request.pagination?.pageSize ?? 50;
  const slice = rows.slice((page - 1) * pageSize, page * pageSize);
  const records = slice.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    exerciseId: r.exerciseId ?? '',
    exerciseName: getExerciseNameById(data.config.exercises, r.exerciseId) || '',
    category: r.category,
    categoryName: getTrainingTypeName(data.config.trainingTypes.find((tt) => tt.id === r.category)) || r.category,
    fields: r.fields,
    note: r.note ?? '',
    plan: r.plan ?? '',
  }));
  return { dimension: request.dimension, mode: 'records', data: { records }, total, shapeHint: 'records' };
}

// ===== 唯一查询执行入口 =====

/**
 * 执行一次查询。插件侧 handleQueryRequest() 与 CLI cmdQuery() 共用。
 * 未知 dimension 返回 error 响应（不抛异常）。
 */
export function executeQuery(request: QueryRequest, data: WorkoutQueryData): QueryResponse {
  const range = resolveDateRange(request.filters);
  switch (request.dimension) {
    case 'training-summary':   return handleTrainingSummary(data, request, range);
    case 'muscle-volume':      return handleMuscleVolume(data, request, range);
    case 'muscle-rest-status': return handleMuscleRest(data, request);
    case 'strength-progress':  return handleStrengthProgress(data, request, range);
    case 'plan-progress':      return handlePlanProgress(data, request, range);
    case 'raw-records':        return handleRawRecords(data, request, range);
    default:
      return {
        dimension: request.dimension,
        mode: request.mode,
        data: null,
        shapeHint: 'scalar',
        error: `未知维度: ${request.dimension}`,
      };
  }
}
