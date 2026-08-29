import {
  Exercise,
  ExerciseMuscle,
  FieldDef,
  LogRow,
  Muscle,
  StatAggregation,
  StatDef,
  StatGranularity,
  TrainingType,
  WorkoutConfig,
} from '../data/types';
import { allowedStatFields, builderToExpr, validateExpression, validateFieldExpr } from '../data/statExpr';
import { getMuscleName } from '../data/display';
import { INVALID_ID_RE, isInvalidId } from '../ui/idValidation';
import { CliError } from './errors';

/*
 * configOps.ts —— workout-config.json 写入面的「纯领域操作层」（零 fs / 零 Obsidian）。
 *
 * 覆盖 exercises / types / muscles / statistics 四类实体的增改删，
 * 级联规则逐条镜像 DataManager（renameExercise / renameTrainingType / deleteExercise）：
 *  - 训练项改 id   → 记录表 exerciseId 级联改写；
 *  - 训练类型改 id → 记录表 category + 训练项 category + 统计 associatedTypes 级联改写；
 *  - 删训练项      → 其全部记录进入软删除名单（命令层追加墓碑）。
 *
 * 所有函数在内存中改 config / 返回新 logs，不落盘；落盘与墓碑追加由命令层统一执行，
 * 便于单元测试对「改了什么」做精确断言。
 */

// ===== 通用校验 =====

// 名称类参数：trim 后非空。
export function assertName(raw: string | undefined, what: string): string {
  const name = (raw ?? '').trim();
  if (!name) throw new CliError(`${what}缺少名称`);
  return name;
}

// id 归一（与 ExerciseModal/TypeModal.save 一致）：留空按名称推导（小写），
// 空白转下划线，剥掉 CSV 敏感字符（逗号/引号/换行）。
// 注：插件模态框有实时输入校验兜底、replace 未加全局标志；CLI 无实时校验，全量剥离才是规则本意。
export function normalizeEntityId(rawId: string | undefined, name: string): string {
  const id = ((rawId ?? '').trim() || name.toLowerCase())
    .replace(/\s+/g, '_')
    .replace(/[,"\n\r]/g, '');
  if (!id || isInvalidId(id)) {
    throw new CliError(`id 非法（不能包含逗号/引号/换行，且不能为空）："${rawId ?? ''}"`);
  }
  return id;
}

function assertIdFree(ids: string[], id: string, what: string, exceptId?: string): void {
  if (ids.some((x) => x === id && x !== exceptId)) {
    throw new CliError(`${what} id "${id}" 已被占用`);
  }
}

function assertTypeExists(config: WorkoutConfig, categoryId: string): TrainingType {
  const type = config.trainingTypes.find((t) => t.id === categoryId);
  if (!type) {
    const names = config.trainingTypes.map((t) => t.id).join(', ');
    throw new CliError(`训练类型 "${categoryId}" 不存在（现有：${names || '无'}）`);
  }
  return type;
}

// ===== 训练项（Exercise） =====

export interface ExerciseInput {
  id?: string;
  name: string;
  category: string;
  muscles?: ExerciseMuscle[];
}

/** 校验 --muscle 参数（muscleId:role），肌肉必须存在。 */
export function parseMuscleSpecs(specs: string[], config: WorkoutConfig): ExerciseMuscle[] {
  return specs.map((spec) => {
    const sep = spec.lastIndexOf(':');
    const muscleId = (sep >= 0 ? spec.slice(0, sep) : spec).trim();
    const role = sep >= 0 ? spec.slice(sep + 1).trim() : 'primary';
    if (!config.muscles.some((m) => m.id === muscleId)) {
      const names = config.muscles.map((m) => m.id).join(', ');
      throw new CliError(`肌肉 "${muscleId}" 不存在（现有：${names || '无'}）`);
    }
    if (role !== 'primary' && role !== 'secondary') {
      throw new CliError(`肌肉角色只能是 primary / secondary，收到 "${role}"（写法：--muscle ${muscleId}:primary）`);
    }
    return { muscleId, role };
  });
}

export function addExercise(config: WorkoutConfig, input: ExerciseInput): Exercise {
  const name = assertName(input.name, '训练项');
  assertTypeExists(config, input.category);
  const id = normalizeEntityId(input.id, name);
  assertIdFree(config.exercises.map((e) => e.id), id, '训练项');
  const exercise: Exercise = {
    id,
    nameKey: undefined, // 自定义名称不走 i18n nameKey（与 ExerciseModal 新建一致）
    name,
    category: input.category,
    muscles: input.muscles && input.muscles.length > 0 ? input.muscles : undefined,
  };
  config.exercises.push(exercise);
  return exercise;
}

export interface ExercisePatch {
  id: string;                          // 现有 id（或显示名也可，命令层先反查）
  newId?: string;                      // 改 id（触发记录级联）
  name?: string;
  category?: string;
  muscles?: ExerciseMuscle[] | null;   // 数组=整体替换；null=清空；undefined=不动
}

/** 更新训练项；改 id 时级联改写记录。返回新 logs 与是否变动。 */
export function applyExerciseUpdate(
  config: WorkoutConfig,
  logs: LogRow[],
  patch: ExercisePatch
): { logs: LogRow[]; logsChanged: boolean; exercise: Exercise } {
  const index = config.exercises.findIndex((e) => e.id === patch.id);
  if (index === -1) throw new CliError(`找不到训练项 id "${patch.id}"`);

  const updates: Partial<Exercise> = {};
  if (patch.name !== undefined) {
    updates.name = assertName(patch.name, '训练项');
    updates.nameKey = undefined; // 自定义名覆盖种子 nameKey，否则改名不生效
  }
  if (patch.category !== undefined) {
    assertTypeExists(config, patch.category);
    updates.category = patch.category;
  }
  if (patch.muscles !== undefined) {
    updates.muscles = patch.muscles && patch.muscles.length > 0 ? patch.muscles : undefined;
  }

  let nextLogs = logs;
  let logsChanged = false;
  const finalId = patch.newId ? normalizeEntityId(patch.newId, updates.name ?? config.exercises[index].name ?? patch.id) : patch.id;
  if (patch.newId && finalId !== patch.id) {
    assertIdFree(config.exercises.map((e) => e.id), finalId, '训练项', patch.id);
    // 镜像 DataManager.renameExercise：配置改 id + 记录级联
    config.exercises[index] = { ...config.exercises[index], ...updates, id: finalId };
    nextLogs = logs.map((r) => (r.exerciseId === patch.id ? { ...r, exerciseId: finalId } : r));
    logsChanged = nextLogs.some((r, i) => r !== logs[i]);
  } else {
    config.exercises[index] = { ...config.exercises[index], ...updates };
  }
  return { logs: nextLogs, logsChanged, exercise: config.exercises[index] };
}

/** 删除训练项：返回需软删除的记录 id（命令层追加墓碑）。镜像 DataManager.deleteExercise。 */
export function applyExerciseDelete(
  config: WorkoutConfig,
  logs: LogRow[],
  id: string
): { logs: LogRow[]; tombstoneIds: string[] } {
  if (!config.exercises.some((e) => e.id === id)) {
    throw new CliError(`找不到训练项 id "${id}"`);
  }
  const related = logs.filter((r) => r.exerciseId === id);
  config.exercises = config.exercises.filter((e) => e.id !== id);
  return { logs: logs.filter((r) => r.exerciseId !== id), tombstoneIds: related.map((r) => r.id) };
}

// ===== 训练类型（TrainingType） =====

const INPUT_TYPES = ['number', 'duration', 'text', 'select', 'computed'] as const;

/** 常见字段 key → 中文标签。CLI 添加训练类型时，若字段未显式给 label / labelKey，
 * 先用本表补一个可读标签（未知 key 回退用 key 本身），避免插件 UI（TypeModal）
 * 把"无标签字段"判为无效、显示空白。配速/速度等计算字段也纳入，减少手填标签。
 */
const BUILTIN_FIELD_LABELS: Record<string, string> = {
  weight: '重量',
  reps: '次数',
  sets: '组数',
  duration_sec: '时长',
  distance_km: '距离',
  routes: '线路数',
  grade: '难度等级',
  style: '方式',
  level: '等级',
  height: '高度',
  rest_sec: '休息',
  heart_rate: '心率',
  calories: '卡路里',
  count: '个数',
  notes: '备注',
  avg_pace: '配速',
  avg_speed: '速度',
};

/** FieldDef[] 结构校验（JSON 输入的唯一入口）。 */
export function validateFieldDefs(fields: unknown): FieldDef[] {
  if (!Array.isArray(fields)) throw new CliError('fields 必须是 FieldDef 数组');
  const defs: FieldDef[] = [];
  const seen = new Set<string>();
  fields.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new CliError(`fields[${i}] 不是对象`);
    const f = raw as Record<string, unknown>;
    const key = typeof f.key === 'string' ? f.key.trim() : '';
    if (!key) throw new CliError(`fields[${i}] 缺少 key`);
    if (INVALID_ID_RE.test(key)) throw new CliError(`字段 key "${key}" 含非法字符（逗号/引号/换行）`);
    if (seen.has(key)) throw new CliError(`字段 key "${key}" 重复`);
    seen.add(key);
    const inputType = f.inputType as FieldDef['inputType'];
    if (!INPUT_TYPES.includes(inputType)) {
      throw new CliError(`fields[${i}].inputType 必须是 ${INPUT_TYPES.join('/')}，收到 "${String(f.inputType)}"`);
    }
    const def: FieldDef = { key, inputType };
    if (typeof f.label === 'string') def.label = f.label;
    if (typeof f.labelKey === 'string') def.labelKey = f.labelKey;
    // 自动补标签：字段既无 label 也无 labelKey 时，用内置词典（未知 key 回退 key），
    // 保证插件 UI 不为空、且不被 TypeModal 判为无效字段。
    if (!def.label && !def.labelKey) {
      def.label = BUILTIN_FIELD_LABELS[key] ?? key;
    }
    if (f.mass === true) {
      if (inputType !== 'number') throw new CliError(`字段 "${key}"：mass 只对 number 字段有意义`);
      def.mass = true;
    }
    if (typeof f.unitLabel === 'string') def.unitLabel = f.unitLabel;
    // 历史 key 别名：字段 key 改名时记录旧 key，读取时按 legacyKeys 把旧值映射到新 key（零迁移向后兼容）。
    if (Array.isArray(f.legacyKeys)) {
      def.legacyKeys = f.legacyKeys.filter((x) => typeof x === 'string' && x.trim());
      if (def.legacyKeys.length === 0) delete def.legacyKeys;
    }
    // computed 是派生字段，不落库、不能是必填（必填语义毫无意义，直接忽略）
    if (f.required === true && inputType !== 'computed') def.required = true;
    if (inputType === 'select') {
      if (!Array.isArray(f.options) || f.options.length === 0 || f.options.some((o) => typeof o !== 'string')) {
        throw new CliError(`字段 "${key}"：select 类型需要非空的 options 字符串数组`);
      }
      def.options = f.options as string[];
    }
    if (inputType === 'computed') {
      if (typeof f.formula !== 'string' || !f.formula.trim()) {
        throw new CliError(`字段 "${key}"：computed 计算字段必须提供 formula（如 "duration_sec / distance_km"）`);
      }
      def.formula = f.formula.trim();
      if (f.renderAs === 'duration') def.renderAs = 'duration';
    }
    defs.push(def);
  });

  // computed 公式白名单校验：必须引用同类型内「已定义的」其他字段，且不能用聚合函数。
  // 整体遍历收集全部 key 后再校验，保证可引用任意顺序定义的字段。
  const keys = defs.map((d) => d.key);
  for (const d of defs) {
    if (d.inputType !== 'computed') continue;
    try {
      validateFieldExpr(d.formula!, keys);
    } catch (e) {
      throw new CliError(`字段 "${d.key}" 的公式无效：${(e as Error).message}`);
    }
  }
  return defs;
}

export function parseFieldDefsJson(json: string): FieldDef[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new CliError(`--fields-json 不是合法 JSON：${(e as Error).message}`);
  }
  return validateFieldDefs(parsed);
}

export interface TypeInput {
  id?: string;
  name: string;
  fields: FieldDef[];
  contributesToCoverage?: boolean;
}

export function addType(config: WorkoutConfig, input: TypeInput): TrainingType {
  const name = assertName(input.name, '训练类型');
  const id = normalizeEntityId(input.id, name);
  assertIdFree(config.trainingTypes.map((t) => t.id), id, '训练类型');
  if (input.fields.length === 0) throw new CliError('训练类型至少需要一个字段（--fields-json）');
  const type: TrainingType = {
    id,
    nameKey: undefined,
    name,
    fields: input.fields,
    ...(input.contributesToCoverage !== undefined ? { contributesToCoverage: input.contributesToCoverage } : {}),
  };
  config.trainingTypes.push(type);
  return type;
}

export interface TypePatch {
  id: string;
  newId?: string;
  name?: string;
  fields?: FieldDef[];
}

// 字段替换时自动继承「历史 key」：当旧字段集里恰好移除一个 key、新字段集里恰好新增一个 key，
// 判定为单字段改名，把移除的旧 key 记到新增字段的 legacyKeys 上，使历史记录旧值能映射到新 key。
// 多字段同时增减无法确定一一映射，保守跳过（不猜测、不丢数据，留待显式指定 legacyKeys）。
function inheritLegacyKeys(oldFields: FieldDef[], newFields: FieldDef[]): FieldDef[] {
  const oldKeys = new Set(oldFields.map((f) => f.key));
  const added = newFields.map((f) => f.key).filter((k) => !oldKeys.has(k));
  const removed = oldFields.map((f) => f.key).filter((k) => !newFields.some((f) => f.key === k));
  if (added.length !== 1 || removed.length !== 1) return newFields;
  return newFields.map((f) => {
    if (f.key !== added[0]) return f;
    const legacy = Array.from(new Set([...(f.legacyKeys ?? []), removed[0]]));
    return { ...f, legacyKeys: legacy };
  });
}

/** 更新训练类型；改 id 时级联改写记录 category、训练项 category、统计 associatedTypes。 */
export function applyTypeUpdate(
  config: WorkoutConfig,
  logs: LogRow[],
  patch: TypePatch
): { logs: LogRow[]; logsChanged: boolean; type: TrainingType } {
  const index = config.trainingTypes.findIndex((t) => t.id === patch.id);
  if (index === -1) throw new CliError(`找不到训练类型 id "${patch.id}"`);

  const updates: Partial<TrainingType> = {};
  if (patch.name !== undefined) {
    updates.name = assertName(patch.name, '训练类型');
    updates.nameKey = undefined;
  }
  if (patch.fields !== undefined) {
    if (patch.fields.length === 0) throw new CliError('训练类型至少需要一个字段');
    updates.fields = inheritLegacyKeys(config.trainingTypes[index].fields, patch.fields);
  }

  const finalId = patch.newId ? normalizeEntityId(patch.newId, updates.name ?? config.trainingTypes[index].name ?? patch.id) : patch.id;
  let nextLogs = logs;
  let logsChanged = false;

  if (patch.newId && finalId !== patch.id) {
    assertIdFree(config.trainingTypes.map((t) => t.id), finalId, '训练类型', patch.id);
    // 镜像 DataManager.renameTrainingType 的三路级联
    config.trainingTypes[index] = { ...config.trainingTypes[index], ...updates, id: finalId };
    config.exercises = config.exercises.map((e) =>
      e.category === patch.id ? { ...e, category: finalId } : e
    );
    config.statistics = (config.statistics ?? []).map((s) =>
      s.associatedTypes.includes(patch.id)
        ? { ...s, associatedTypes: s.associatedTypes.map((t) => (t === patch.id ? finalId : t)) }
        : s
    );
    nextLogs = logs.map((r) => (r.category === patch.id ? { ...r, category: finalId } : r));
    logsChanged = nextLogs.some((r, i) => r !== logs[i]);
  } else {
    config.trainingTypes[index] = { ...config.trainingTypes[index], ...updates };
  }
  return { logs: nextLogs, logsChanged, type: config.trainingTypes[index] };
}

/** 删除训练类型（与插件一致：不级联记录）。返回变成孤儿的训练项，供命令层警告。 */
export function applyTypeDelete(config: WorkoutConfig, id: string): { orphanExerciseIds: string[] } {
  if (!config.trainingTypes.some((t) => t.id === id)) {
    throw new CliError(`找不到训练类型 id "${id}"`);
  }
  config.trainingTypes = config.trainingTypes.filter((t) => t.id !== id);
  return { orphanExerciseIds: config.exercises.filter((e) => e.category === id).map((e) => e.id) };
}

// ===== 肌肉（Muscle） =====

export interface MuscleInput {
  id?: string;
  name: string;
  contributesToCoverage?: boolean;
  restThresholdDays?: number;
  svgRegionIds?: string[];
}

export function addMuscle(config: WorkoutConfig, input: MuscleInput): Muscle {
  const name = assertName(input.name, '肌肉');
  const id = normalizeEntityId(input.id, name);
  assertIdFree(config.muscles.map((m) => m.id), id, '肌肉');
  const muscle: Muscle = {
    id,
    nameKey: undefined,
    name,
    contributesToCoverage: input.contributesToCoverage ?? true,
    svgRegionIds: input.svgRegionIds ?? [],
    ...(input.restThresholdDays !== undefined ? { restThresholdDays: input.restThresholdDays } : {}),
  };
  config.muscles.push(muscle);
  return muscle;
}

export interface MusclePatch {
  id: string;
  name?: string;
  contributesToCoverage?: boolean;
  restThresholdDays?: number;
  svgRegionIds?: string[];
}

export function applyMuscleUpdate(config: WorkoutConfig, patch: MusclePatch): Muscle {
  const index = config.muscles.findIndex((m) => m.id === patch.id);
  if (index === -1) throw new CliError(`找不到肌肉 id "${patch.id}"`);
  const updates: Partial<Muscle> = {};
  if (patch.name !== undefined) {
    updates.name = assertName(patch.name, '肌肉');
    updates.nameKey = undefined;
  }
  if (patch.contributesToCoverage !== undefined) updates.contributesToCoverage = patch.contributesToCoverage;
  if (patch.restThresholdDays !== undefined) updates.restThresholdDays = patch.restThresholdDays;
  if (patch.svgRegionIds !== undefined) updates.svgRegionIds = patch.svgRegionIds;
  config.muscles[index] = { ...config.muscles[index], ...updates };
  return config.muscles[index];
}

/** 删除肌肉（与插件一致）。返回仍引用它的训练项，供命令层警告。 */
export function applyMuscleDelete(config: WorkoutConfig, id: string): { danglingExerciseIds: string[] } {
  if (!config.muscles.some((m) => m.id === id)) {
    throw new CliError(`找不到肌肉 id "${id}"`);
  }
  config.muscles = config.muscles.filter((m) => m.id !== id);
  const dangling = config.exercises
    .filter((e) => (e.muscles ?? []).some((em) => em.muscleId === id))
    .map((e) => e.id);
  return { danglingExerciseIds: dangling };
}

// ===== 数据统计（StatDef） =====

const GRANULARITIES = ['daily', 'weekly', 'monthly'] as const;

/** 解析 --builder 预设语法为 StatAggregation。 */
export function parseBuilderSpec(spec: string): StatAggregation {
  const s = spec.trim();
  if (s === 'count') return { kind: 'count' };
  const sep = s.indexOf(':');
  if (sep <= 0) {
    throw new CliError(`--builder 语法：count / sum:<字段> / avg|max|min:<字段> / productSum:<字段A>,<字段B> / oneRepMax:<重量字段>,<次数字段>，收到 "${spec}"`);
  }
  const kind = s.slice(0, sep).trim();
  const parts = s.slice(sep + 1).split(',').map((x) => x.trim()).filter(Boolean);
  if (kind === 'sum' || kind === 'avg' || kind === 'max' || kind === 'min') {
    if (parts.length !== 1) throw new CliError(`--builder ${kind} 需要恰好 1 个字段`);
    return { kind, field: parts[0] };
  }
  if (kind === 'productSum') {
    if (parts.length !== 2) throw new CliError('--builder productSum 需要 2 个字段：productSum:<字段A>,<字段B>');
    return { kind: 'productSum', fieldA: parts[0], fieldB: parts[1] };
  }
  if (kind === 'oneRepMax') {
    if (parts.length !== 2) throw new CliError('--builder oneRepMax 需要 2 个字段：oneRepMax:<重量字段>,<次数字段>');
    return { kind: 'oneRepMax', weightField: parts[0], repsField: parts[1] };
  }
  throw new CliError(`未知 builder 类型 "${kind}"（支持 sum/avg/max/min/count/productSum/oneRepMax）`);
}

export interface StatInput {
  id?: string;
  name: string;
  associatedTypes: string[];
  formula: StatDef['formula'];
  granularity?: StatGranularity;
  enabled?: boolean;
  unit?: string;
}

function assertStatFormulaValid(stat: StatDef, config: WorkoutConfig): void {
  const expr = stat.formula.mode === 'builder' ? builderToExpr(stat.formula.builder) : (stat.formula.expression ?? '');
  const allowed = allowedStatFields(stat, config);
  try {
    validateExpression(expr, allowed);
  } catch (e) {
    throw new CliError(`统计公式无效：${(e as Error).message}（可用字段：${allowed.join(', ') || '无'}）`);
  }
}

function assertTypesExist(config: WorkoutConfig, ids: string[]): void {
  if (ids.length === 0) throw new CliError('统计至少要关联一个训练类型（--types）');
  for (const id of ids) assertTypeExists(config, id);
}

export function addStat(config: WorkoutConfig, input: StatInput): StatDef {
  const name = assertName(input.name, '统计');
  assertTypesExist(config, input.associatedTypes);
  const id = normalizeEntityId(input.id, name);
  assertIdFree(config.statistics.map((s) => s.id), id, '统计');
  const stat: StatDef = {
    id,
    name,
    associatedTypes: input.associatedTypes,
    formula: input.formula,
    granularity: input.granularity ?? 'daily',
    enabled: input.enabled ?? true,
    ...(input.unit ? { unit: input.unit } : {}),
  };
  assertStatFormulaValid(stat, config);
  config.statistics.push(stat);
  return stat;
}

export interface StatPatch {
  stat: string; // id 或名称
  name?: string;
  associatedTypes?: string[];
  formula?: StatDef['formula'];
  granularity?: StatGranularity;
  enabled?: boolean;
  unit?: string;
}

export function resolveStatIndex(config: WorkoutConfig, idOrName: string): number {
  const lower = idOrName.toLowerCase();
  return config.statistics.findIndex(
    (s) => s.id.toLowerCase() === lower || s.name.toLowerCase() === lower
  );
}

export function applyStatUpdate(config: WorkoutConfig, patch: StatPatch): StatDef {
  const index = resolveStatIndex(config, patch.stat);
  if (index === -1) throw new CliError(`找不到统计项 "${patch.stat}"`);
  const current = config.statistics[index];
  const next: StatDef = { ...current };
  if (patch.name !== undefined) next.name = assertName(patch.name, '统计');
  if (patch.associatedTypes !== undefined) {
    assertTypesExist(config, patch.associatedTypes);
    next.associatedTypes = patch.associatedTypes;
  }
  if (patch.formula !== undefined) next.formula = patch.formula;
  if (patch.granularity !== undefined) {
    if (!GRANULARITIES.includes(patch.granularity)) {
      throw new CliError(`granularity 必须是 ${GRANULARITIES.join('/')}`);
    }
    next.granularity = patch.granularity;
  }
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.unit !== undefined) {
    if (patch.unit === '') delete next.unit;
    else next.unit = patch.unit;
  }
  assertStatFormulaValid(next, config);
  config.statistics[index] = next;
  return next;
}

/** 删除统计。返回仍引用它作为热力图指标的肌肉，供命令层提示（引用会回退默认，不损坏数据）。 */
export function applyStatDelete(config: WorkoutConfig, idOrName: string): { heatmapReferencers: string[] } {
  const index = resolveStatIndex(config, idOrName);
  if (index === -1) throw new CliError(`找不到统计项 "${idOrName}"`);
  const stat = config.statistics[index];
  config.statistics = config.statistics.filter((_, i) => i !== index);
  const referencers = config.muscles
    .filter((m) => m.heatmapMetric === stat.id)
    .map((m) => getMuscleName(m));
  return { heatmapReferencers: referencers };
}
