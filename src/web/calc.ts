/*
 * calc.ts —— 网页端页面共用的派生计算（统计、计划进度、动作汇总）。
 * 全部基于 src/data 的纯函数，保证与插件/CLI 口径一致。
 */

import {
  Exercise,
  LogRow,
  PlanItem,
  PlanSet,
  StatDef,
  TrainingPlanInstance,
  TrainingType,
  WorkoutConfig,
} from '../data/types';
import { computeStat } from '../data/statExpr';
import { materializeLog, fieldsOfCategory } from '../data/computedField';
import { dateWithinRange } from '../data/heatmapDefaults';
import {
  getExerciseName,
  getExerciseNameById,
  getFieldLabel,
  getMuscleName,
  getTrainingTypeName,
  renderFieldValue,
} from '../data/display';
import { formatMass } from '../util/units';
import { L, compactFields, dateOf, isoWeekday, spanSeconds, todayStr, weekdayLabel } from './format';
import type { WebRange } from './store';

export function sortLogsDesc(logs: LogRow[]): LogRow[] {
  return [...logs].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

export function sortLogsAsc(logs: LogRow[]): LogRow[] {
  return [...logs].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
}

export function logsInRange(logs: LogRow[], range: WebRange | string | undefined): LogRow[] {
  if (!range || range === 'all') return [...logs];
  return logs.filter((log) => dateWithinRange(dateOf(log.timestamp), range));
}

export function typeOf(config: WorkoutConfig, id: string | undefined): TrainingType | undefined {
  return config.trainingTypes.find((t) => t.id === id);
}

export function exerciseOf(config: WorkoutConfig, id: string | undefined): Exercise | undefined {
  return config.exercises.find((e) => e.id === id);
}

export function exercisesOfType(config: WorkoutConfig, typeId: string): Exercise[] {
  return config.exercises.filter((e) => e.category === typeId);
}

export function typeName(config: WorkoutConfig, id: string): string {
  return getTrainingTypeName(typeOf(config, id)) || id;
}

export function logExerciseName(config: WorkoutConfig, log: LogRow): string {
  return getExerciseNameById(config.exercises, log.exerciseId) || L('未关联动作', 'Unlinked');
}

export function planExerciseName(config: WorkoutConfig, item: PlanItem): string {
  return getExerciseName(exerciseOf(config, item.exerciseId)) || item.exerciseId;
}

export function muscleNamesOf(config: WorkoutConfig, exerciseId: string, role: 'primary' | 'secondary'): string[] {
  const ex = exerciseOf(config, exerciseId);
  if (!ex?.muscles) return [];
  return ex.muscles
    .filter((m) => m.role === role)
    .map((m) => getMuscleName(config.muscles.find((x) => x.id === m.muscleId)) || m.muscleId);
}

export function materializedLog(config: WorkoutConfig, log: LogRow): LogRow {
  return materializeLog(log, fieldsOfCategory(config, log.category));
}

export interface LogChip {
  label: string;
  value: string;
}

export function logChips(config: WorkoutConfig, log: LogRow, unit: 'kg' | 'lb'): LogChip[] {
  const type = typeOf(config, log.category);
  const materialized = materializedLog(config, log);
  const out: LogChip[] = [];
  for (const field of type?.fields ?? []) {
    const value = materialized.fields[field.key];
    if (value === undefined || value === null || value === '') continue;
    const text = renderFieldValue(value, field, unit);
    if (!text) continue;
    out.push({ label: getFieldLabel(field), value: text });
  }
  if (out.length === 0) {
    for (const [key, value] of Object.entries(log.fields ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      out.push({ label: key, value: String(value) });
    }
  }
  return out;
}

export function compactSetText(
  config: WorkoutConfig,
  category: string,
  fields: Record<string, unknown>,
  unit: 'kg' | 'lb'
): string {
  return compactFields(fields, typeOf(config, category), unit);
}

// —— 训练量：优先复用配置里的「训练总量」统计（公式可自定义），否则按 weight×reps 兜底 ——
export function volumeStat(config: WorkoutConfig): StatDef | undefined {
  return (
    config.statistics.find((s) => s.id === 'volume') ??
    config.statistics.find((s) => s.formula.builder?.kind === 'productSum')
  );
}

export function statValue(
  config: WorkoutConfig,
  stat: StatDef,
  logs: LogRow[],
  range?: string,
  day?: string
): number {
  const records = logs
    .filter((log) => (range ? dateWithinRange(dateOf(log.timestamp), range) : true))
    .filter((log) => (day ? dateOf(log.timestamp) === day : true))
    .filter((log) => stat.associatedTypes.includes(log.category))
    .map((log) => materializedLog(config, log));
  return computeStat(stat, records);
}

export function volumeOfLogs(config: WorkoutConfig, logs: LogRow[]): number {
  const stat = volumeStat(config);
  if (stat) return statValue(config, stat, logs);
  let total = 0;
  for (const log of logs) {
    const value = directVolumeOfLog(config, log);
    if (Number.isFinite(value)) total += value;
  }
  return Math.round(total * 100) / 100;
}

export function directVolumeOfLog(config: WorkoutConfig, log: LogRow): number {
  const materialized = materializedLog(config, log);
  const weight = Number(materialized.fields.weight);
  const reps = Number(materialized.fields.reps);
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) return 0;
  return weight * reps;
}

export function oneRepMaxOfLog(config: WorkoutConfig, log: LogRow): number {
  const materialized = materializedLog(config, log);
  const weight = Number(materialized.fields.weight);
  const reps = Number(materialized.fields.reps);
  if (!Number.isFinite(weight) || !Number.isFinite(reps) || reps <= 0) return 0;
  return weight * (1 + reps / 30);
}

export function bestSetOfLogs(config: WorkoutConfig, logs: LogRow[], unit: 'kg' | 'lb'): string {
  let best: { weight: number; reps: number } | null = null;
  for (const log of logs) {
    const materialized = materializedLog(config, log);
    const weight = Number(materialized.fields.weight);
    const reps = Number(materialized.fields.reps);
    if (!Number.isFinite(weight) || !Number.isFinite(reps)) continue;
    if (!best || weight * reps > best.weight * best.reps) best = { weight, reps };
  }
  if (best) return `${formatMass(best.weight, unit)} ${unit} × ${best.reps}`;
  const last = logs[0];
  return last ? compactSetText(config, last.category, materializedLog(config, last).fields, unit) : '—';
}

export interface ExerciseSummaryRow {
  exerciseId: string;
  name: string;
  category: string;
  typeName: string;
  sets: number;
  volume: number;
  best: string;
  oneRM: number;
  share: number;
}

export function exerciseSummary(
  config: WorkoutConfig,
  logs: LogRow[],
  unit: 'kg' | 'lb'
): ExerciseSummaryRow[] {
  const groups = new Map<string, LogRow[]>();
  for (const log of logs) {
    const key = log.exerciseId || `?${log.category}`;
    const list = groups.get(key);
    if (list) list.push(log);
    else groups.set(key, [log]);
  }
  const totalSets = logs.length || 1;
  const rows: ExerciseSummaryRow[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    const volume = group.reduce((sum, log) => sum + directVolumeOfLog(config, log), 0);
    const oneRM = group.reduce((max, log) => Math.max(max, oneRepMaxOfLog(config, log)), 0);
    rows.push({
      exerciseId: key,
      name: logExerciseName(config, first),
      category: first.category,
      typeName: typeName(config, first.category),
      sets: group.length,
      volume: Math.round(volume * 100) / 100,
      best: bestSetOfLogs(config, sortLogsDesc(group), unit),
      oneRM: Math.round(oneRM * 100) / 100,
      share: Math.round((group.length / totalSets) * 100),
    });
  }
  return rows.sort((a, b) => b.sets - a.sets || b.volume - a.volume);
}

// —— 趋势 ——
export function dateSeries(days: number, endDay?: string): string[] {
  const out: string[] = [];
  const end = endDay ?? new Date();
  const base =
    typeof end === 'string'
      ? new Date(`${end}T00:00:00`)
      : new Date(end.getFullYear(), end.getMonth(), end.getDate());
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

export function metricOfDay(config: WorkoutConfig, dayLogs: LogRow[], metric: 'sets' | 'volume' | 'time'): number {
  if (metric === 'sets') return dayLogs.length;
  if (metric === 'volume') return volumeOfLogs(config, dayLogs);
  return spanSeconds(dayLogs);
}

// —— 连续训练 ——
export function bestStreak(logs: LogRow[]): number {
  const days = Array.from(new Set(logs.map((l) => dateOf(l.timestamp)).filter(Boolean))).sort();
  let best = 0;
  let run = 0;
  let prev = '';
  for (const day of days) {
    if (!prev) {
      run = 1;
    } else {
      const [y, m, d] = prev.split('-').map(Number);
      const next = new Date(y, m - 1, d + 1);
      const expected = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
      run = expected === day ? run + 1 : 1;
    }
    best = Math.max(best, run);
    prev = day;
  }
  return best;
}

// —— 训练计划 ——
export function planMatchesDay(plan: TrainingPlanInstance, day: string): boolean {
  if (plan.timeRule.type === 'date') return plan.timeRule.date === day;
  return (plan.timeRule.weekdays ?? []).includes(isoWeekday(day));
}

export function plansForDay(config: WorkoutConfig, day: string): TrainingPlanInstance[] {
  return (config.plans ?? []).filter((plan) => planMatchesDay(plan, day));
}

export function planRuleText(plan: TrainingPlanInstance): string {
  if (plan.timeRule.type === 'date') {
    return plan.timeRule.date || L('未设置时间', 'No schedule');
  }
  const days = [...new Set(plan.timeRule.weekdays ?? [])].sort((a, b) => a - b);
  if (days.length === 0) return L('未设置时间', 'No schedule');
  const labels = days.map((d) => weekdayLabel(d, true));
  return L(`每周 ${labels.join(' / ')}`, `Every ${labels.join(', ')}`);
}

export function completionKey(exerciseId: string, setId: string): string {
  return `${exerciseId}#${setId}`;
}

/** 某天所在自然周的周一（ISO 周，周一为一周之始）。 */
function weekStartOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const back = (dt.getDay() || 7) - 1;
  dt.setDate(dt.getDate() - back);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * 完成态是否算「在本周期内完成」。
 * 周计划（timeRule=weekday）按自然周判定：上周勾掉的组，这周打开应重新变成未完成；
 * 日期计划按当天判定。历史完成日期仍留在 completedSets 里，不做删除。
 */
function doneInPeriod(plan: TrainingPlanInstance, storedDate: string | undefined, day: string): boolean {
  if (!storedDate) return false;
  if (plan.timeRule?.type === 'date') return storedDate === day;
  return weekStartOf(storedDate) === weekStartOf(day);
}

export function isSetDone(
  plan: TrainingPlanInstance,
  exerciseId: string,
  setId: string,
  day: string = todayStr()
): boolean {
  return doneInPeriod(plan, plan.completedSets?.[completionKey(exerciseId, setId)], day);
}

export function setDoneDate(plan: TrainingPlanInstance, exerciseId: string, setId: string): string | undefined {
  return plan.completedSets?.[completionKey(exerciseId, setId)];
}

/** 切换某组完成状态（直接修改传入的 plan；调用方负责 updateConfig 持久化）。 */
export function toggleSetDone(plan: TrainingPlanInstance, exerciseId: string, setId: string, day: string): boolean {
  const key = completionKey(exerciseId, setId);
  const map = { ...(plan.completedSets ?? {}) };
  // 只有「本周期内已完成」才取消；上个周期的旧记录视为未完成，直接覆盖成本次日期。
  if (doneInPeriod(plan, map[key], day)) {
    delete map[key];
    plan.completedSets = map;
    return false;
  }
  map[key] = day;
  plan.completedSets = map;
  return true;
}

export interface PlanProgress {
  total: number;
  done: number;
  pct: number;
  next: { item: PlanItem; set: PlanSet } | null;
}

export function planProgress(plan: TrainingPlanInstance): PlanProgress {
  let total = 0;
  let done = 0;
  let next: { item: PlanItem; set: PlanSet } | null = null;
  for (const item of plan.items) {
    if (!item.enabled) continue;
    for (const set of item.sets) {
      total++;
      if (isSetDone(plan, item.exerciseId, set.id)) {
        done++;
      } else if (!next) {
        next = { item, set };
      }
    }
  }
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0, next };
}

export function itemProgress(plan: TrainingPlanInstance, item: PlanItem): { total: number; done: number; pct: number } {
  let done = 0;
  for (const set of item.sets) if (isSetDone(plan, item.exerciseId, set.id)) done++;
  const total = item.sets.length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function todayPlan(config: WorkoutConfig, day: string): TrainingPlanInstance | undefined {
  return plansForDay(config, day)[0];
}

// —— 统计指标解析 ——
export function resolveMetric(config: WorkoutConfig, requested: string): StatDef | undefined {
  const enabled = config.statistics.filter((s) => s.enabled);
  const pool = enabled.length > 0 ? enabled : config.statistics;
  return (
    pool.find((s) => s.id === requested) ??
    pool.find((s) => s.heatmapDefault) ??
    pool[0]
  );
}

export function statUnit(stat: StatDef | undefined): string {
  return stat?.unit?.trim() ?? '';
}

export function statFormulaText(stat: StatDef): string {
  if (stat.formula.mode === 'expression') return stat.formula.expression || '';
  const b = stat.formula.builder;
  if (!b) return '';
  switch (b.kind) {
    case 'count':
      return 'count()';
    case 'sum':
      return `sum(${b.field})`;
    case 'productSum':
      return `sum(${b.fieldA} * ${b.fieldB})`;
    case 'oneRepMax':
      return `max(${b.weightField} * (1 + ${b.repsField} / 30))`;
    case 'avg':
      return `avg(${b.field})`;
    case 'max':
      return `max(${b.field})`;
    case 'min':
      return `min(${b.field})`;
  }
}

export function statAssocText(config: WorkoutConfig, stat: StatDef): string {
  return stat.associatedTypes.map((id) => typeName(config, id)).join(L(' / ', ' / '));
}

export function statDelta(current: number, previous: number): { text: string; tone: string } {
  if (!Number.isFinite(previous) || previous === 0) {
    return current > 0
      ? { text: L('新增', 'New'), tone: 'delta-up' }
      : { text: '—', tone: 'faint' };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: '0%', tone: 'faint' };
  return pct > 0
    ? { text: `↑ ${pct}%`, tone: 'delta-up' }
    : { text: `↓ ${Math.abs(pct)}%`, tone: 'delta-down' };
}

export function rangeDays(range: WebRange): number | null {
  if (range === '7d') return 7;
  if (range === '30d') return 30;
  if (range === '90d') return 90;
  return null;
}
