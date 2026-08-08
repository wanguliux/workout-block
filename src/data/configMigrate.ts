import { WorkoutConfig, FieldDef } from './types';
import { applyDefaultNameKeys } from './display';
import { getDefaultConfig } from './seed';

/*
 * configMigrate.ts —— workout-config.json 的「纯迁移层」（零 Obsidian 依赖）。
 *
 * 职责：把任意历史版本的配置归一到当前结构——补全缺失块、幂等并入种子数据、
 * 迁移旧字段单位模型、补齐默认 nameKey。重复执行安全（幂等）。
 *
 * 插件的 ConfigStore 与 workout-block CLI（src/cli/）共用本模块：
 * 插件在加载配置时调用；CLI 在内存中计算「生效配置」时调用（与插件看到的一致），
 * 保证两侧对同一份配置文件的理解完全相同。
 */

// 旧版字段单位模型遗留字段（unit 枚举 + customUnit）。仅迁移函数内部使用，
// 不污染权威的 FieldDef 类型。
type LegacyFieldDef = FieldDef & { unit?: string; customUnit?: string };

// 数据迁移(migrate)：补全缺失结构，保证向后兼容。
export function migrateConfig(config: WorkoutConfig): WorkoutConfig {
  if (!config.version) config.version = 1;
  if (!config.trainingTypes) config.trainingTypes = getDefaultConfig().trainingTypes;
  if (!config.exercises) config.exercises = getDefaultConfig().exercises;
  if (!config.muscles) config.muscles = getDefaultConfig().muscles;
  // 数据统计：旧配置缺 statistics 时，按每个训练类型注入一条种子"总组数"。
  // 用 count()（不引用字段），单类型关联即可复现"每个块都有总组数"；
  // 用户想跨类型可手动把 associatedTypes 改为多个类型。
  if (!config.statistics) {
    config.statistics = config.trainingTypes.map((type) => ({
      id: `seed-total-sets-${type.id}`,
      name: '总组数',
      associatedTypes: [type.id],
      formula: { mode: 'builder', builder: { kind: 'count' } },
      granularity: 'daily',
      enabled: true,
    }));
  }
  // 训练计划：旧配置缺 plans 时置空数组（聚合进既有配置，不单独建文件）
  if (!config.plans) config.plans = [];
  // 2026-07-14 大改：把种子新增的训练项 / 计划 / 训练总量指标，幂等地并入既有配置。
  // 按 id（训练项/统计）或 name（计划）去重，绝不覆盖用户已改/已建的数据；重复执行安全。
  {
    const seed = getDefaultConfig();
    const exIds = new Set(config.exercises.map((e) => e.id));
    for (const ex of seed.exercises) if (!exIds.has(ex.id)) config.exercises.push(ex);
    const planNames = new Set(config.plans.map((p) => p.name));
    for (const pl of seed.plans ?? []) if (!planNames.has(pl.name)) config.plans.push(pl);
    const statIds = new Set(config.statistics.map((s) => s.id));
    for (const st of seed.statistics) if (!statIds.has(st.id)) config.statistics.push(st);
  }
  // 字段单位模型迁移：旧 unit 枚举(none/mass/length/count/time/custom) -> mass + unitLabel。
  // 幂等：已迁移的数据没有 unit/customUnit 字段，重复执行无副作用。
  const migrateUnit = (fields: LegacyFieldDef[] | undefined): void => {
    if (!fields) return;
    for (const f of fields) {
      if (!f) continue;
      if (f.unit === 'mass') f.mass = true;
      else if (f.unit === 'custom') f.unitLabel = f.customUnit ?? '';
      else if (f.unit === 'count') f.unitLabel = '次';
      // length/time/none/未定义 -> 全部清空（不再保留死值）
      delete f.unit;
      delete f.customUnit;
    }
  };
  for (const type of config.trainingTypes ?? []) migrateUnit(type.fields);

  return applyDefaultNameKeys(config);
}
