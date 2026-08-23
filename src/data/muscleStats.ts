import { ExerciseMuscle, LogRow, Muscle, StatDef, WorkoutConfig } from './types';
import { computeStat } from './statExpr';
import { dateWithinRange } from './heatmapDefaults';

/*
 * muscleStats.ts —— 肌肉统计纯函数（单一真相源）。
 *
 * 从 codeblock/workoutHeatmap.ts 抽取的纯核心逻辑（零 Obsidian / 零 DOM 依赖），
 * 渲染层（热力图）与查询层（decision/queryHandler）共用，保证口径一致。
 * 计算语义与热力图保持一致：纳入全部训练类型（含有氧）对肌肉的贡献，
 * `contributesToCoverage` 字段不被计算消费（仅 UI 标签用）。
 */

/** 角色加权：主练 1.0，辅练 0.5。 */
export function roleWeight(role: 'primary' | 'secondary'): number {
  return role === 'primary' ? 1.0 : 0.5;
}

/**
 * 预构建 exerciseId → 训练项肌肉映射，供 computeMuscleValue 做 O(1) 查找
 * （避免逐日志 O(exercises) 线性扫描），把整体复杂度从 O(muscles × logs × exercises)
 * 降到 O(muscles × logs)。
 */
export function buildExerciseMuscleMap(config: WorkoutConfig): Map<string, ExerciseMuscle[]> {
  const map = new Map<string, ExerciseMuscle[]>();
  for (const ex of config.exercises) {
    if (ex.muscles && ex.muscles.length) {
      map.set(ex.id, ex.muscles.map((m) => ({ muscleId: m.muscleId, role: m.role })));
    }
  }
  return map;
}

/**
 * 计算某块肌肉在 range 范围内的统计值（按该肌肉涉及的训练项记录累加，角色加权）。
 * range 支持 dateWithinRange 的全部写法：'7d'/'30d'/'all'/'YYYY-MM-DD..YYYY-MM-DD'/undefined。
 */
export function computeMuscleValue(
  muscle: Muscle,
  stat: StatDef,
  range: string | undefined,
  logs: LogRow[],
  exerciseMuscleMap: Map<string, ExerciseMuscle[]>
): number {
  let total = 0;
  for (const log of logs) {
    if (!log.timestamp || !log.exerciseId || !dateWithinRange(log.timestamp.split(' ')[0], range)) continue;
    const em = exerciseMuscleMap.get(log.exerciseId);
    if (!em) continue;
    const hit = em.find((m) => m.muscleId === muscle.id);
    if (!hit) continue;
    const instanceValue = computeStat(stat, [log]);
    if (!Number.isFinite(instanceValue)) continue;
    total += instanceValue * roleWeight(hit.role);
  }
  return Math.round(total * 100) / 100;
}

/** 批量计算所有肌肉的统计值（查询层用：单一口径 stat 遍历全部肌肉）。 */
export function computeAllMuscleValues(
  config: WorkoutConfig,
  logs: LogRow[],
  range: string | undefined,
  stat: StatDef
): Map<string, number> {
  const map = new Map<string, number>();
  const em = buildExerciseMuscleMap(config);
  for (const muscle of config.muscles) {
    map.set(muscle.id, computeMuscleValue(muscle, stat, range, logs, em));
  }
  return map;
}

/** 本地当天日期（YYYY-MM-DD）。 */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** YYYY-MM-DD → UTC 毫秒（用 UTC 避免本地时区/DST 干扰的天数差计算）。 */
function parseDay(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** 两个 YYYY-MM-DD 日期之间相隔的天数（toDay - fromDay）。 */
export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((parseDay(toDay) - parseDay(fromDay)) / 86400000);
}

/**
 * 某肌肉距上次训练的天数。回看全部历史记录（不受 range 限制）；
 * 从未训练（记录中找不到该肌肉）返回 -1。
 */
export function computeMuscleRestDays(
  muscleId: string,
  logs: LogRow[],
  exerciseMuscleMap: Map<string, ExerciseMuscle[]>
): number {
  let lastDay: string | null = null;
  for (const log of logs) {
    if (!log.timestamp || !log.exerciseId) continue;
    const em = exerciseMuscleMap.get(log.exerciseId);
    if (!em || !em.some((m) => m.muscleId === muscleId)) continue;
    const day = log.timestamp.slice(0, 10);
    if (!lastDay || day > lastDay) lastDay = day;
  }
  if (!lastDay) return -1;
  return daysBetween(lastDay, todayStr());
}
