import { Exercise, Muscle, StatDef, TrainingType, WorkoutConfig, PlanItem, TrainingPlanInstance } from './types';
import { buildMappings } from './muscleMapping';

/*
 * seed.ts —— 默认配置数据（"种子数据"）。
 * 插件首次运行、配置文件不存在时，就用这里的默认训练类型、肌肉、训练项生成初始配置。
 * 想增加默认动作或肌肉，改这里即可。每个对象用稳定 id 标识，改名不影响历史记录。
 */

// 默认采用「default」档映射，使热力图开箱即用，无需用户手动打开肌肉管理触发引导。
const DEFAULT_MUSCLE_MAPPINGS = buildMappings('default');

// 默认训练类型：力量、有氧、自重三类，各自带要记录的字段。
export const DEFAULT_TRAINING_TYPES: TrainingType[] = [
  {
    id: 'strength',
    nameKey: 'type.strength',
    icon: 'dumbbell',
    fields: [
      { key: 'weight', labelKey: 'field.weight', inputType: 'number', mass: true, required: true },   // 重量（参与 kg/lb 换算）
      { key: 'reps', labelKey: 'field.reps', inputType: 'number', unitLabel: '次', required: true },        // 次数
    ],
    contributesToCoverage: true,
  },
  {
    id: 'aerobic',
    nameKey: 'type.aerobic',
    icon: 'wind',
    fields: [
      { key: 'duration_sec', labelKey: 'field.duration_sec', inputType: 'duration', required: true }, // 时长（秒）——跑步/骑行/跳绳等都先记时长
      { key: 'distance_km', labelKey: 'field.distance', inputType: 'number', unitLabel: '公里', required: false }, // 距离（跑步/骑行等，跳绳可留空）
    ],
    contributesToCoverage: false,
  },
  {
    id: 'bodyweight',
    nameKey: 'type.bodyweight',
    icon: 'person-standing',
    fields: [
      { key: 'reps', labelKey: 'field.reps', inputType: 'number', unitLabel: '次', required: false },             // 次数（俯卧撑/引体向上等）
      { key: 'duration_sec', labelKey: 'field.duration_sec', inputType: 'duration', required: false }, // 时长（平板支撑等支撑/静力类）
    ],
    contributesToCoverage: true,
  },
];

// 默认肌肉列表。svgRegionIds 已预填默认映射，使热力图开箱即用；
// 用户仍可在「肌肉管理」里重新套用「精简/手动」档覆盖。
export const DEFAULT_MUSCLES: Muscle[] = [
  { id: 'chest', nameKey: 'muscle.chest', contributesToCoverage: true, restThresholdDays: 7, svgRegionIds: DEFAULT_MUSCLE_MAPPINGS.chest ?? [] },
  { id: 'front_delt', nameKey: 'muscle.front_delt', contributesToCoverage: true, restThresholdDays: 7, svgRegionIds: DEFAULT_MUSCLE_MAPPINGS.front_delt ?? [] },
  { id: 'biceps', nameKey: 'muscle.biceps', contributesToCoverage: true, restThresholdDays: 7, svgRegionIds: DEFAULT_MUSCLE_MAPPINGS.biceps ?? [] },
  { id: 'quads', nameKey: 'muscle.quads', contributesToCoverage: true, restThresholdDays: 7, svgRegionIds: DEFAULT_MUSCLE_MAPPINGS.quads ?? [] },
  { id: 'front_calf', nameKey: 'muscle.front_calf', contributesToCoverage: true, restThresholdDays: 7, svgRegionIds: DEFAULT_MUSCLE_MAPPINGS.front_calf ?? [] },
  { id: 'abs', nameKey: 'muscle.abs', contributesToCoverage: true, restThresholdDays: 7, svgRegionIds: DEFAULT_MUSCLE_MAPPINGS.abs ?? [] },
  { id: 'lats', nameKey: 'muscle.lats', contributesToCoverage: true, restThresholdDays: 7, svgRegionIds: DEFAULT_MUSCLE_MAPPINGS.lats ?? [] },
  { id: 'traps', nameKey: 'muscle.traps', contributesToCoverage: true, restThresholdDays: 7, svgRegionIds: DEFAULT_MUSCLE_MAPPINGS.traps ?? [] },
  { id: 'rear_delt', nameKey: 'muscle.rear_delt', contributesToCoverage: true, restThresholdDays: 7, svgRegionIds: DEFAULT_MUSCLE_MAPPINGS.rear_delt ?? [] },
  { id: 'triceps', nameKey: 'muscle.triceps', contributesToCoverage: true, restThresholdDays: 7, svgRegionIds: DEFAULT_MUSCLE_MAPPINGS.triceps ?? [] },
  { id: 'hamstrings', nameKey: 'muscle.hamstrings', contributesToCoverage: true, restThresholdDays: 7, svgRegionIds: DEFAULT_MUSCLE_MAPPINGS.hamstrings ?? [] },
  { id: 'glutes', nameKey: 'muscle.glutes', contributesToCoverage: true, restThresholdDays: 7, svgRegionIds: DEFAULT_MUSCLE_MAPPINGS.glutes ?? [] },
  { id: 'back_calf', nameKey: 'muscle.back_calf', contributesToCoverage: true, restThresholdDays: 7, svgRegionIds: DEFAULT_MUSCLE_MAPPINGS.back_calf ?? [] },
];

// 默认数据统计：「组数」= 每条记录即一组，count() 即组数，作为热力图默认指标。
export const DEFAULT_COUNT_STAT: StatDef = {
  id: 'count',
  name: '组数',
  associatedTypes: ['strength', 'aerobic', 'bodyweight'],
  formula: { mode: 'builder', builder: { kind: 'count' } },
  granularity: 'daily',
  enabled: true,
  heatmapDefault: true,
  heatmapScale: [
    { color: '#3b82f6', max: 5 },
    { color: '#22c55e', max: 10 },
    { color: '#f97316', max: 20 },
    { color: '#ef4444', max: 40 },
  ],
};

// 力量训练「训练总量」：每日 Σ(次数 × 重量)，衡量训练负荷。
export const DEFAULT_VOLUME_STAT: StatDef = {
  id: 'volume',
  name: '训练总量',
  associatedTypes: ['strength'],
  formula: { mode: 'builder', builder: { kind: 'productSum', fieldA: 'reps', fieldB: 'weight' } },
  granularity: 'daily',
  enabled: true,
  heatmapDefault: false,
};

// 力量训练「1RM 估算」（Epley 公式）：取最佳组的估算一次最大重量，量化进步。
// 公式：weight × (1 + reps/30)，对每条记录计算后取 max。
// 适用范围： reps ≤ 10 时较准确；高次数组（>12）会高估，属已知局限。
export const DEFAULT_1RM_STAT: StatDef = {
  id: 'oneRepMax',
  name: '1RM 估算',
  associatedTypes: ['strength'],
  formula: { mode: 'builder', builder: { kind: 'oneRepMax', weightField: 'weight', repsField: 'reps' } },
  granularity: 'daily',
  enabled: true,
  heatmapDefault: false,
};

// 默认训练项：每个动作归属某训练类型，并标注练到哪些肌肉、主练还是辅练。
export const DEFAULT_EXERCISES: Exercise[] = [
  {
    id: 'squat',
    nameKey: 'exercise.squat',
    category: 'strength',
    muscles: [
      { muscleId: 'quads', role: 'primary' },
      { muscleId: 'glutes', role: 'secondary' },
      { muscleId: 'hamstrings', role: 'secondary' },
    ],
  },
  {
    id: 'deadlift',
    nameKey: 'exercise.deadlift',
    category: 'strength',
    muscles: [
      { muscleId: 'hamstrings', role: 'primary' },
      { muscleId: 'glutes', role: 'primary' },
      { muscleId: 'traps', role: 'secondary' },
    ],
  },
  {
    id: 'bench_press',
    nameKey: 'exercise.bench_press',
    category: 'strength',
    muscles: [
      { muscleId: 'chest', role: 'primary' },
      { muscleId: 'front_delt', role: 'secondary' },
      { muscleId: 'triceps', role: 'secondary' },
    ],
  },
  {
    id: 'pushup',
    nameKey: 'exercise.pushup',
    category: 'bodyweight',
    muscles: [
      { muscleId: 'chest', role: 'primary' },
      { muscleId: 'triceps', role: 'secondary' },
      { muscleId: 'front_delt', role: 'secondary' },
    ],
  },
  {
    id: 'pullup',
    nameKey: 'exercise.pullup',
    category: 'bodyweight',
    muscles: [
      { muscleId: 'lats', role: 'primary' },
      { muscleId: 'biceps', role: 'secondary' },
      { muscleId: 'traps', role: 'secondary' },
    ],
  },
  {
    id: 'plank',
    nameKey: 'exercise.plank',
    category: 'bodyweight',
    muscles: [
      { muscleId: 'abs', role: 'primary' },
      { muscleId: 'quads', role: 'secondary' },
    ],
  },
  {
    id: 'running',
    nameKey: 'exercise.running',
    category: 'aerobic',
    muscles: [
      { muscleId: 'quads', role: 'primary' },
      { muscleId: 'hamstrings', role: 'secondary' },
      { muscleId: 'front_calf', role: 'secondary' },
    ],
  },
  {
    id: 'jumping_rope',
    nameKey: 'exercise.jumping_rope',
    category: 'aerobic',
    muscles: [
      { muscleId: 'front_calf', role: 'primary' },
      { muscleId: 'abs', role: 'secondary' },
    ],
  },
  {
    id: 'cycling',
    nameKey: 'exercise.cycling',
    category: 'aerobic',
    muscles: [
      { muscleId: 'quads', role: 'primary' },
      { muscleId: 'hamstrings', role: 'secondary' },
    ],
  },

  // ===== 新增训练项（2026-07-14 大改：扩充力量训练动作库）=====
  // 说明：以下动作均属「力量训练」(strength)。已与种子原有动作（深蹲/硬拉/卧推/引体向上/平板支撑/跑步/跳绳/骑行）
  // 去重；「罗马尼亚硬拉」与表格里的「直腿硬拉」(romanian_deadlift) 视为同一动作，仅保留直腿硬拉。

  // —— 推 / 胸 & 肩 & 肱三头 ——
  {
    id: 'dumbbell_bench_press',
    nameKey: 'exercise.dumbbell_bench_press',
    category: 'strength',
    muscles: [
      { muscleId: 'chest', role: 'primary' },
      { muscleId: 'front_delt', role: 'secondary' },
      { muscleId: 'triceps', role: 'secondary' },
    ],
  },
  {
    id: 'incline_dumbbell_press',
    nameKey: 'exercise.incline_dumbbell_press',
    category: 'strength',
    muscles: [
      { muscleId: 'chest', role: 'primary' },
      { muscleId: 'front_delt', role: 'secondary' },
      { muscleId: 'triceps', role: 'secondary' },
    ],
  },
  {
    id: 'close_grip_bench_press',
    nameKey: 'exercise.close_grip_bench_press',
    category: 'strength',
    muscles: [
      { muscleId: 'chest', role: 'primary' },
      { muscleId: 'triceps', role: 'secondary' },
    ],
  },
  {
    id: 'dip',
    nameKey: 'exercise.dip',
    category: 'strength',
    muscles: [
      { muscleId: 'chest', role: 'primary' },
      { muscleId: 'triceps', role: 'secondary' },
      { muscleId: 'front_delt', role: 'secondary' },
    ],
  },
  {
    id: 'dumbbell_press',
    nameKey: 'exercise.dumbbell_press',
    category: 'strength',
    muscles: [
      { muscleId: 'front_delt', role: 'primary' },
      { muscleId: 'triceps', role: 'secondary' },
      { muscleId: 'traps', role: 'secondary' },
    ],
  },
  {
    id: 'dumbbell_lateral_raise',
    nameKey: 'exercise.dumbbell_lateral_raise',
    category: 'strength',
    muscles: [
      { muscleId: 'front_delt', role: 'primary' },
      { muscleId: 'traps', role: 'secondary' },
    ],
  },
  {
    id: 'barbell_front_raise',
    nameKey: 'exercise.barbell_front_raise',
    category: 'strength',
    muscles: [
      { muscleId: 'front_delt', role: 'primary' },
      { muscleId: 'traps', role: 'secondary' },
    ],
  },
  {
    id: 'barbell_push_press',
    nameKey: 'exercise.barbell_push_press',
    category: 'strength',
    muscles: [
      { muscleId: 'front_delt', role: 'primary' },
      { muscleId: 'triceps', role: 'secondary' },
      { muscleId: 'traps', role: 'secondary' },
    ],
  },
  {
    id: 'barbell_lying_triceps',
    nameKey: 'exercise.barbell_lying_triceps',
    category: 'strength',
    muscles: [
      { muscleId: 'triceps', role: 'primary' },
    ],
  },
  {
    id: 'dumbbell_overhead_triceps',
    nameKey: 'exercise.dumbbell_overhead_triceps',
    category: 'strength',
    muscles: [
      { muscleId: 'triceps', role: 'primary' },
    ],
  },

  // —— 拉 / 背 & 肱二头 ——
  {
    id: 'barbell_row',
    nameKey: 'exercise.barbell_row',
    category: 'strength',
    muscles: [
      { muscleId: 'lats', role: 'primary' },
      { muscleId: 'traps', role: 'secondary' },
      { muscleId: 'biceps', role: 'secondary' },
    ],
  },
  {
    id: 'dumbbell_row',
    nameKey: 'exercise.dumbbell_row',
    category: 'strength',
    muscles: [
      { muscleId: 'lats', role: 'primary' },
      { muscleId: 'traps', role: 'secondary' },
      { muscleId: 'biceps', role: 'secondary' },
    ],
  },
  {
    id: 'dumbbell_reverse_fly',
    nameKey: 'exercise.dumbbell_reverse_fly',
    category: 'strength',
    muscles: [
      { muscleId: 'rear_delt', role: 'primary' },
      { muscleId: 'traps', role: 'secondary' },
    ],
  },
  {
    id: 'cable_face_pull',
    nameKey: 'exercise.cable_face_pull',
    category: 'strength',
    muscles: [
      { muscleId: 'rear_delt', role: 'primary' },
      { muscleId: 'traps', role: 'secondary' },
      { muscleId: 'front_delt', role: 'secondary' },
    ],
  },
  {
    id: 'barbell_upright_row',
    nameKey: 'exercise.barbell_upright_row',
    category: 'strength',
    muscles: [
      { muscleId: 'traps', role: 'primary' },
      { muscleId: 'front_delt', role: 'secondary' },
      { muscleId: 'biceps', role: 'secondary' },
    ],
  },
  {
    id: 'barbell_curl',
    nameKey: 'exercise.barbell_curl',
    category: 'strength',
    muscles: [
      { muscleId: 'biceps', role: 'primary' },
    ],
  },
  {
    id: 'dumbbell_curl',
    nameKey: 'exercise.dumbbell_curl',
    category: 'strength',
    muscles: [
      { muscleId: 'biceps', role: 'primary' },
    ],
  },

  // —— 腿 & 核心 ——
  {
    id: 'lunge',
    nameKey: 'exercise.lunge',
    category: 'strength',
    muscles: [
      { muscleId: 'quads', role: 'primary' },
      { muscleId: 'glutes', role: 'secondary' },
      { muscleId: 'hamstrings', role: 'secondary' },
    ],
  },
  {
    id: 'romanian_deadlift',
    nameKey: 'exercise.romanian_deadlift',
    category: 'strength',
    muscles: [
      { muscleId: 'hamstrings', role: 'primary' },
      { muscleId: 'glutes', role: 'primary' },
      { muscleId: 'traps', role: 'secondary' },
    ],
  },
  {
    id: 'hanging_leg_raise',
    nameKey: 'exercise.hanging_leg_raise',
    category: 'strength',
    muscles: [
      { muscleId: 'abs', role: 'primary' },
    ],
  },
  {
    id: 'ab_crunch',
    nameKey: 'exercise.ab_crunch',
    category: 'strength',
    muscles: [
      { muscleId: 'abs', role: 'primary' },
    ],
  },
];

// 计划项构造辅助：每个动作默认带 1 个空预设组（用户训练时再填重量/次数）。
function pItem(exerciseId: string, category: string, enabled = true): PlanItem {
  return {
    exerciseId,
    category,
    enabled,
    sets: [{ id: 's1', fields: {} }],
  };
}

// 默认训练计划：三分化（背 / 胸 / 腿）。时间规则为经典的一周三练排期（可在设置里改）。
export const DEFAULT_PLANS: TrainingPlanInstance[] = [
  {
    id: '374890bb-4fd8-449b-8b1e-60dd652eed32',
    name: '三分化-背',
    timeRule: { type: 'weekday', weekdays: [1, 4] }, // 周一、周四
    createdAt: '2026-07-14',
    items: [
      pItem('barbell_row', 'strength'),
      pItem('dumbbell_row', 'strength'),
      pItem('pullup', 'bodyweight'),
      pItem('dumbbell_reverse_fly', 'strength'),
      pItem('cable_face_pull', 'strength'),
      pItem('barbell_curl', 'strength'),
      pItem('dumbbell_curl', 'strength'),
    ],
  },
  {
    id: '1200e157-ae12-4394-b523-bc62218c15df',
    name: '三分化-胸',
    timeRule: { type: 'weekday', weekdays: [2, 5] }, // 周二、周五
    createdAt: '2026-07-14',
    items: [
      pItem('dumbbell_bench_press', 'strength'),
      pItem('incline_dumbbell_press', 'strength'),
      pItem('dumbbell_press', 'strength'),
      pItem('dumbbell_lateral_raise', 'strength'),
      pItem('dip', 'strength', false),                 // 可选
      pItem('close_grip_bench_press', 'strength', false), // 可选
      pItem('dumbbell_overhead_triceps', 'strength', false), // 可选
    ],
  },
  {
    id: '44db2031-cba7-414b-83f5-72dcc62d90fd',
    name: '三分化-腿',
    timeRule: { type: 'weekday', weekdays: [3, 6] }, // 周三、周六
    createdAt: '2026-07-14',
    items: [
      pItem('squat', 'strength'),
      pItem('lunge', 'strength'),
      pItem('romanian_deadlift', 'strength'),
      pItem('ab_crunch', 'strength'),
      pItem('hanging_leg_raise', 'strength'),
    ],
  },
];

// 汇总成完整默认配置（version = 1，表示第一版结构）
export function getDefaultConfig(): WorkoutConfig {
  return {
    version: 1,
    trainingTypes: DEFAULT_TRAINING_TYPES,
    exercises: DEFAULT_EXERCISES,
    muscles: DEFAULT_MUSCLES,
    statistics: [DEFAULT_COUNT_STAT, DEFAULT_VOLUME_STAT, DEFAULT_1RM_STAT],
    plans: DEFAULT_PLANS,
  };
}
