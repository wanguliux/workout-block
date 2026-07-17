import { t, getAllTranslations } from '../i18n';
import { Exercise, FieldDef, LogRow, Muscle, TimeRule, TrainingType, WorkoutConfig } from './types';
import { formatDuration } from '../util/duration';
import { formatMass } from '../util/units';

/*
 * display.ts —— "显示名解析"工具集。
 * 配置里的名称优先用 nameKey（国际化 key，由 i18n 函数 t 翻译成当前语言），
 * 没有 nameKey 才用 name 字段。本文件还提供字段标签、单位、字段值的格式化函数，
 * 负责把"程序存起来的数据"变成"用户看得懂的文字"。
 */

// 默认肌肉 -> 国际化 key 的映射表（当配置里没写 nameKey 时作为兜底）
export const DEFAULT_MUSCLE_NAME_KEYS: Record<string, string> = {
  chest: 'muscle.chest',
  front_delt: 'muscle.front_delt',
  biceps: 'muscle.biceps',
  quads: 'muscle.quads',
  front_calf: 'muscle.front_calf',
  abs: 'muscle.abs',
  lats: 'muscle.lats',
  traps: 'muscle.traps',
  rear_delt: 'muscle.rear_delt',
  triceps: 'muscle.triceps',
  hamstrings: 'muscle.hamstrings',
  glutes: 'muscle.glutes',
  back_calf: 'muscle.back_calf',
};

// 默认训练项 -> 国际化 key 映射
export const DEFAULT_EXERCISE_NAME_KEYS: Record<string, string> = {
  squat: 'exercise.squat',
  deadlift: 'exercise.deadlift',
  bench_press: 'exercise.bench_press',
  pushup: 'exercise.pushup',
  pullup: 'exercise.pullup',
  plank: 'exercise.plank',
  running: 'exercise.running',
  jumping_rope: 'exercise.jumping_rope',
  cycling: 'exercise.cycling',
};

// 默认训练类型 -> 国际化 key 映射
export const DEFAULT_TRAINING_TYPE_NAME_KEYS: Record<string, string> = {
  strength: 'type.strength',
  aerobic: 'type.aerobic',
  bodyweight: 'type.bodyweight',
};

// 取训练类型的显示名：nameKey 优先（翻译成当前语言），否则用 name/id 兜底。
export function getTrainingTypeName(type?: TrainingType): string {
  if (!type) return '';
  return type.nameKey ? t(type.nameKey) : type.name || type.id;
}

// 取训练项显示名
export function getExerciseName(exercise?: Exercise): string {
  if (!exercise) return '';
  return exercise.nameKey ? t(exercise.nameKey) : exercise.name || exercise.id;
}

// 取肌肉显示名
export function getMuscleName(muscle?: Muscle): string {
  if (!muscle) return '';
  return muscle.nameKey ? t(muscle.nameKey) : muscle.name || muscle.id;
}

// 取字段标签（展示给用户看的字段名）
export function getFieldLabel(field: FieldDef): string {
  return field.labelKey ? t(field.labelKey) : field.label || field.key;
}

// 取字段单位文字：质量类返回用户设置的 kg/lb；其余返回自由单位文字（unitLabel）。
export function getFieldUnit(field: FieldDef, unit: 'kg' | 'lb'): string {
  if (field.mass) return unit;            // 质量跟随插件单位设置（kg 或 lb）
  if (field.unitLabel) return field.unitLabel;  // 自由单位文字（如"次""层""圈"）
  return '';
}

// 把字段值格式化成展示文字：时长用 formatDuration，质量用 formatMass（含单位换算），其余直接转字符串。
export function renderFieldValue(value: unknown, field: FieldDef, unit: 'kg' | 'lb'): string {
  if (value === undefined || value === null) return '';

  switch (field.inputType) {
    case 'duration':
      return formatDuration(Number(value));  // 秒数 -> "1分30秒"这类可读文本
    case 'number':
      if (field.mass) {
        return formatMass(Number(value), unit);  // 质量按 kg/lb 换算并显示单位
      }
      return String(value);
    case 'text':
      return String(value);
    default:
      return String(value);
  }
}

// 按 id 在训练项列表里查找并返回显示名（找不到返回空字符串）
export function getExerciseNameById(exercises: Exercise[], id?: string): string {
  if (!id) return '';
  const exercise = exercises.find((e) => e.id === id);
  return exercise ? getExerciseName(exercise) : '';
}

// 把计划时间规则渲染成可读文字：指定日期直接返回日期；每周模式按 ISO 周几
// （周一=1 … 周日=7）拼成「每周 一、三、五」这样的提示。供「新增训练计划」弹窗
// 与 workout-plan 完成面板复用，避免各模块各自拼装造成表述不一致。
export function formatTimeRule(rule: TimeRule): string {
  if (rule.type === 'date') {
    if (!rule.date) return '';
    return rule.date;
  }
  const labels = ['一', '二', '三', '四', '五', '六', '日']; // ISO 周一=1 … 周日=7
  const days = (rule.weekdays ?? [])
    .slice()
    .sort((a, b) => a - b)
    .map((d) => (d >= 1 && d <= 7 ? labels[d - 1] : String(d)));
  if (days.length === 0) return t('modal.newPlan.weekdayNone');
  return t('modal.newPlan.weekdayHint', { days: days.join('、') });
}

// 按「名字/显示名/id」在配置里反查训练项对象。
// 用于把代码块里的 `exercise: 深蹲` 或 `exercise: Squat` 解析成稳定的训练项 id，
// 解决多语言切换后按「当前语言显示名」匹配不到历史记录的问题。
export function resolveExerciseByName(config: WorkoutConfig, name: string): Exercise | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  return config.exercises.find((e) => {
    if (e.id.toLowerCase() === lower) return true;
    if ((e.name || '').toLowerCase() === lower) return true;
    // 默认训练项用 nameKey 做国际化；按全部支持语言的显示名匹配，
    // 这样中英文切换后，代码块里用任意一种语言写的名字都能查到记录。
    if (e.nameKey && getAllTranslations(e.nameKey).some((n) => n.toLowerCase() === lower)) return true;
    return false;
  });
}

// 同上，但直接返回训练项 id（找不到返回 undefined）。
export function resolveExerciseIdByName(config: WorkoutConfig, name: string): string | undefined {
  return resolveExerciseByName(config, name)?.id;
}

// 解析日志记录的运动显示名：
// 仅用 exerciseId（稳定，改名/切换语言后自动解析为最新显示名）。
// 无 exerciseId 的旧数据无法关联配置，返回空串，由调用方决定兜底展示。
export function resolveLogExerciseName(config: WorkoutConfig, log: LogRow): string {
  if (log.exerciseId) {
    const name = getExerciseNameById(config.exercises, log.exerciseId);
    if (name) return name;  // 找到了就返回最新显示名（始终随配置更新）
  }
  return '';  // 无 exerciseId（旧数据）时返回空
}

// 给配置里的训练类型/训练项/肌肉补齐默认 nameKey（仅在还没有 nameKey 时补，不覆盖已有值）。
export function applyDefaultNameKeys(config: WorkoutConfig): WorkoutConfig {
  config.trainingTypes = config.trainingTypes.map((type) => ({
    ...type,
    nameKey: type.nameKey || DEFAULT_TRAINING_TYPE_NAME_KEYS[type.id],
  }));

  config.exercises = config.exercises.map((exercise) => ({
    ...exercise,
    nameKey: exercise.nameKey || DEFAULT_EXERCISE_NAME_KEYS[exercise.id],
  }));

  config.muscles = config.muscles.map((muscle) => ({
    ...muscle,
    nameKey: muscle.nameKey || DEFAULT_MUSCLE_NAME_KEYS[muscle.id],
  }));

  return config;
}
