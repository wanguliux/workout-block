import { getExerciseName, getMuscleName, getTrainingTypeName, resolveExerciseByName } from '../../data/display';
import { LogRow } from '../../data/types';
import { logsToCsv, tombstoneLines } from '../../data/csvFormat';
import { ParsedArgs, requireOption, UsageError } from '../args';
import { CliEnv } from '../context';
import {
  addExercise, addMuscle, addStat, addType,
  applyExerciseDelete, applyExerciseUpdate,
  applyMuscleDelete, applyMuscleUpdate,
  applyStatDelete, applyStatUpdate,
  applyTypeDelete, applyTypeUpdate,
  parseBuilderSpec, parseFieldDefsJson, parseMuscleSpecs,
} from '../configOps';
import { printJson } from '../output';
import { CliError } from '../vault';

/*
 * configWriteCmd.ts —— 配置写入命令（exercises/types/muscles/stats 的增改删）。
 *
 * 编排规则（与插件写盘行为对齐）：
 *  - 配置改动统一原子写回 workout-config.json（写的是迁移后的生效配置，
 *    与插件自身保存配置时的落盘内容一致）；
 *  - 级联改动记录时整文件原子重写（镜像 renameExercise/renameTrainingType 的 writeAll）；
 *  - 删训练项的关联记录走软删除墓碑（镜像 deleteExercise 的 appendTombstones）；
 *  - 所有 delete-* 需要 --yes 显式确认，未确认时只给影响预览、不动数据。
 */

// ===== 小工具 =====

function parseBool(value: string, opt: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new UsageError(`--${opt} 只接受 true/false，收到 "${value}"`);
}

function parseCommaList(value: string): string[] {
  return value.split(',').map((x) => x.trim()).filter(Boolean);
}

async function saveConfig(env: CliEnv): Promise<void> {
  await env.vault.writeAtomic(env.vault.configPath(env.settings), JSON.stringify(env.config, null, 2));
}

// 级联改写记录后的整文件原子重写（镜像插件 writeAll）
async function saveLogsFull(env: CliEnv, logs: LogRow[]): Promise<void> {
  await env.vault.writeAtomic(env.vault.csvPath(env.settings), logsToCsv(logs) + '\n');
}

function requireYes(args: ParsedArgs, impact: string): void {
  if (!args.flags.has('yes')) {
    throw new CliError(`危险操作：${impact}。确认执行请加 --yes`);
  }
}

// 训练项定位：中/英显示名或 id（resolveExerciseByName 已支持 id）
function locateExerciseId(env: CliEnv, nameOrId: string): string {
  const ex = resolveExerciseByName(env.config, nameOrId);
  if (ex) return ex.id;
  throw new CliError(`找不到训练项 "${nameOrId}"，请先用 resolve 命令确认可用名称`);
}

// 训练类型定位：id 或（任意语言）显示名
function locateTypeId(env: CliEnv, idOrName: string): string {
  const hit = env.config.trainingTypes.find(
    (t) => t.id === idOrName || getTrainingTypeName(t) === idOrName || (t.name ?? '') === idOrName
  );
  if (!hit) throw new CliError(`找不到训练类型 "${idOrName}"`);
  return hit.id;
}

// ===== 训练项 =====

async function addExerciseCmd(env: CliEnv, args: ParsedArgs): Promise<void> {
  const name = requireOption(args, 'name', 'config add-exercise --name <名称> --category <类型id> [--id <id>] [--muscle <肌肉id>:primary|secondary ...]');
  const category = locateTypeId(env, requireOption(args, 'category', 'config add-exercise --name <名称> --category <类型id>'));
  const muscles = parseMuscleSpecs(args.repeated['muscle'] ?? [], env.config);
  const exercise = addExercise(env.config, { id: args.options['id'], name, category, muscles });
  await saveConfig(env);
  if (args.flags.has('json')) return printJson(exercise);
  console.log(`已添加训练项：${exercise.id}（${exercise.name}，类型 ${exercise.category}）`);
}

async function updateExerciseCmd(env: CliEnv, args: ParsedArgs): Promise<void> {
  const id = locateExerciseId(env, requireOption(args, 'exercise', 'config update-exercise --exercise <名称或id> [--new-id ...] [--name ...] [--category ...] [--muscle ...] [--clear-muscles]'));
  const patch: Parameters<typeof applyExerciseUpdate>[2] = { id };
  if (args.options['new-id']) patch.newId = args.options['new-id'];
  if (args.options['name']) patch.name = args.options['name'];
  if (args.options['category']) patch.category = locateTypeId(env, args.options['category']);
  if (args.flags.has('clear-muscles')) patch.muscles = null;
  else if ((args.repeated['muscle'] ?? []).length > 0) patch.muscles = parseMuscleSpecs(args.repeated['muscle'] ?? [], env.config);

  const { logs, logsChanged, exercise } = applyExerciseUpdate(env.config, env.logs, patch);
  if (logsChanged) await saveLogsFull(env, logs);
  await saveConfig(env);
  if (args.flags.has('json')) return printJson({ exercise, logsChanged });
  console.log(`已更新训练项：${exercise.id}（${getExerciseName(exercise)}）${logsChanged ? '，关联记录的 exerciseId 已级联改写' : ''}`);
}

async function deleteExerciseCmd(env: CliEnv, args: ParsedArgs): Promise<void> {
  const id = locateExerciseId(env, requireOption(args, 'exercise', 'config delete-exercise --exercise <名称或id> --yes'));
  const related = env.logs.filter((r) => r.exerciseId === id).length;
  requireYes(args, `将移除训练项 ${id}，并级联软删除其 ${related} 条训练记录`);
  const { logs, tombstoneIds } = applyExerciseDelete(env.config, env.logs, id);
  if (tombstoneIds.length > 0) {
    await env.vault.appendCsvLines(env.vault.csvPath(env.settings), tombstoneLines(tombstoneIds));
  }
  await saveConfig(env);
  if (args.flags.has('json')) return printJson({ deletedExercise: id, tombstonedRecords: tombstoneIds.length });
  console.log(`已删除训练项 ${id}；级联软删除 ${tombstoneIds.length} 条记录（compact 可清理）。`);
}

// ===== 训练类型 =====

async function addTypeCmd(env: CliEnv, args: ParsedArgs): Promise<void> {
  const name = requireOption(args, 'name', 'config add-type --name <名称> --fields-json \'[{"key":"weight","inputType":"number","mass":true,"required":true}]\'');
  const fields = parseFieldDefsJson(requireOption(args, 'fields-json', 'config add-type 需要 --fields-json 描述字段'));
  const contributesToCoverage = args.options['coverage'] !== undefined
    ? parseBool(args.options['coverage'], 'coverage')
    : undefined;
  const type = addType(env.config, { id: args.options['id'], name, fields, contributesToCoverage });
  await saveConfig(env);
  if (args.flags.has('json')) return printJson(type);
  console.log(`已添加训练类型：${type.id}（${type.name}，字段 ${type.fields.map((f) => f.key).join(', ')}）`);
}

async function updateTypeCmd(env: CliEnv, args: ParsedArgs): Promise<void> {
  const id = locateTypeId(env, requireOption(args, 'type', 'config update-type --type <名称或id> [--new-id ...] [--name ...] [--fields-json ...]'));
  const patch: Parameters<typeof applyTypeUpdate>[2] = { id };
  if (args.options['new-id']) patch.newId = args.options['new-id'];
  if (args.options['name']) patch.name = args.options['name'];
  if (args.options['fields-json']) patch.fields = parseFieldDefsJson(args.options['fields-json']);
  const { logs, logsChanged, type } = applyTypeUpdate(env.config, env.logs, patch);
  if (logsChanged) await saveLogsFull(env, logs);
  await saveConfig(env);
  if (args.flags.has('json')) return printJson({ type, logsChanged });
  console.log(`已更新训练类型：${type.id}${logsChanged ? '，关联记录 category / 训练项 / 统计已级联改写' : ''}`);
}

async function deleteTypeCmd(env: CliEnv, args: ParsedArgs): Promise<void> {
  const id = locateTypeId(env, requireOption(args, 'type', 'config delete-type --type <名称或id> --yes'));
  const orphans = env.config.exercises.filter((e) => e.category === id);
  requireYes(args, `将移除训练类型 ${id}${orphans.length > 0 ? `，${orphans.length} 个训练项将失去类型归属（${orphans.map((e) => e.id).join(', ')}）` : ''}`);
  const { orphanExerciseIds } = applyTypeDelete(env.config, id);
  await saveConfig(env);
  if (args.flags.has('json')) return printJson({ deletedType: id, orphanExerciseIds });
  console.log(`已删除训练类型 ${id}。${orphanExerciseIds.length > 0 ? `注意：${orphanExerciseIds.join(', ')} 仍引用该类型，建议一并处理。` : ''}`);
}

// ===== 肌肉 =====

async function addMuscleCmd(env: CliEnv, args: ParsedArgs): Promise<void> {
  const name = requireOption(args, 'name', 'config add-muscle --name <名称> [--id ...] [--coverage true|false] [--rest-days N] [--svg-ids a,b]');
  const muscle = addMuscle(env.config, {
    id: args.options['id'],
    name,
    contributesToCoverage: args.options['coverage'] !== undefined ? parseBool(args.options['coverage'], 'coverage') : undefined,
    restThresholdDays: args.options['rest-days'] !== undefined ? parseInt(args.options['rest-days'], 10) : undefined,
    svgRegionIds: args.options['svg-ids'] !== undefined ? parseCommaList(args.options['svg-ids']) : undefined,
  });
  await saveConfig(env);
  if (args.flags.has('json')) return printJson(muscle);
  console.log(`已添加肌肉：${muscle.id}（${muscle.name}）`);
}

// --muscle 在参数规格里是可重复项（训练项命令用来传多组肌肉映射），
// 肌肉命令的单值目标因此要从 repeated 里取，且只允许一个。
function muscleTarget(args: ParsedArgs, usage: string): string {
  const vals = args.repeated['muscle'] ?? [];
  if (vals.length !== 1) {
    throw new UsageError(`缺少必填选项 --muscle。用法：${usage}`);
  }
  return vals[0];
}

async function updateMuscleCmd(env: CliEnv, args: ParsedArgs): Promise<void> {
  const id = muscleTarget(args, 'config update-muscle --muscle <id> [--name ...] [--coverage ...] [--rest-days ...] [--svg-ids ...]');
  const muscle = applyMuscleUpdate(env.config, {
    id,
    name: args.options['name'],
    contributesToCoverage: args.options['coverage'] !== undefined ? parseBool(args.options['coverage'], 'coverage') : undefined,
    restThresholdDays: args.options['rest-days'] !== undefined ? parseInt(args.options['rest-days'], 10) : undefined,
    svgRegionIds: args.options['svg-ids'] !== undefined ? parseCommaList(args.options['svg-ids']) : undefined,
  });
  await saveConfig(env);
  if (args.flags.has('json')) return printJson(muscle);
  console.log(`已更新肌肉：${muscle.id}（${getMuscleName(muscle)}）`);
}

async function deleteMuscleCmd(env: CliEnv, args: ParsedArgs): Promise<void> {
  const id = muscleTarget(args, 'config delete-muscle --muscle <id> --yes');
  const dangling = env.config.exercises.filter((e) => (e.muscles ?? []).some((m) => m.muscleId === id));
  requireYes(args, `将移除肌肉 ${id}${dangling.length > 0 ? `，${dangling.length} 个训练项仍引用它（映射将失效）` : ''}`);
  const { danglingExerciseIds } = applyMuscleDelete(env.config, id);
  await saveConfig(env);
  if (args.flags.has('json')) return printJson({ deletedMuscle: id, danglingExerciseIds });
  console.log(`已删除肌肉 ${id}。${danglingExerciseIds.length > 0 ? `注意：${danglingExerciseIds.join(', ')} 的肌肉映射引用已失效。` : ''}`);
}

// ===== 数据统计 =====

function parseFormula(args: ParsedArgs, required: boolean): { mode: 'builder' | 'expression'; builder?: ReturnType<typeof parseBuilderSpec>; expression?: string } | undefined {
  const builderSpec = args.options['builder'];
  const expr = args.options['expr'];
  if (builderSpec && expr) throw new UsageError('--builder 与 --expr 只能二选一');
  if (builderSpec) return { mode: 'builder', builder: parseBuilderSpec(builderSpec) };
  if (expr) return { mode: 'expression', expression: expr };
  if (required) throw new UsageError('需要 --builder（如 sum:reps）或 --expr（如 "sum(reps * weight)"）');
  return undefined;
}

async function addStatCmd(env: CliEnv, args: ParsedArgs): Promise<void> {
  const name = requireOption(args, 'name', 'config add-stat --name <名称> --types <类型id,...> --builder <预设> | --expr <表达式>');
  const associatedTypes = parseCommaList(requireOption(args, 'types', 'config add-stat 需要 --types <训练类型id, 逗号分隔>')).map((t) => locateTypeId(env, t));
  const formula = parseFormula(args, true)!;
  const stat = addStat(env.config, {
    id: args.options['id'],
    name,
    associatedTypes,
    formula,
    granularity: (args.options['granularity'] as 'daily' | 'weekly' | 'monthly' | undefined),
    enabled: args.options['enabled'] !== undefined ? parseBool(args.options['enabled'], 'enabled') : undefined,
    unit: args.options['unit'],
  });
  await saveConfig(env);
  if (args.flags.has('json')) return printJson(stat);
  console.log(`已添加统计：${stat.id}（${stat.name}）`);
}

async function updateStatCmd(env: CliEnv, args: ParsedArgs): Promise<void> {
  const statRef = requireOption(args, 'stat', 'config update-stat --stat <名称或id> [--name ...] [--types ...] [--builder ... | --expr ...] [--granularity ...] [--enabled ...] [--unit ...]');
  const formula = parseFormula(args, false);
  const stat = applyStatUpdate(env.config, {
    stat: statRef,
    name: args.options['name'],
    associatedTypes: args.options['types'] !== undefined ? parseCommaList(args.options['types']).map((t) => locateTypeId(env, t)) : undefined,
    formula,
    granularity: args.options['granularity'] as 'daily' | 'weekly' | 'monthly' | undefined,
    enabled: args.options['enabled'] !== undefined ? parseBool(args.options['enabled'], 'enabled') : undefined,
    unit: args.options['unit'],
  });
  await saveConfig(env);
  if (args.flags.has('json')) return printJson(stat);
  console.log(`已更新统计：${stat.id}（${stat.name}）`);
}

async function deleteStatCmd(env: CliEnv, args: ParsedArgs): Promise<void> {
  const statRef = requireOption(args, 'stat', 'config delete-stat --stat <名称或id> --yes');
  requireYes(args, `将删除统计项 "${statRef}"（引用它的热力图指标会回退默认）`);
  const { heatmapReferencers } = applyStatDelete(env.config, statRef);
  await saveConfig(env);
  if (args.flags.has('json')) return printJson({ deletedStat: statRef, heatmapReferencers });
  console.log(`已删除统计 ${statRef}。${heatmapReferencers.length > 0 ? `注意：肌肉 ${heatmapReferencers.join('、')} 的热力图指标将回退默认。` : ''}`);
}

// ===== 分发 =====

export const CONFIG_WRITE_VERBS = [
  'add-exercise', 'update-exercise', 'delete-exercise',
  'add-type', 'update-type', 'delete-type',
  'add-muscle', 'update-muscle', 'delete-muscle',
  'add-stat', 'update-stat', 'delete-stat',
] as const;

export type ConfigWriteVerb = typeof CONFIG_WRITE_VERBS[number];

export async function dispatchConfigWrite(env: CliEnv, verb: ConfigWriteVerb, args: ParsedArgs): Promise<void> {
  switch (verb) {
    case 'add-exercise': return addExerciseCmd(env, args);
    case 'update-exercise': return updateExerciseCmd(env, args);
    case 'delete-exercise': return deleteExerciseCmd(env, args);
    case 'add-type': return addTypeCmd(env, args);
    case 'update-type': return updateTypeCmd(env, args);
    case 'delete-type': return deleteTypeCmd(env, args);
    case 'add-muscle': return addMuscleCmd(env, args);
    case 'update-muscle': return updateMuscleCmd(env, args);
    case 'delete-muscle': return deleteMuscleCmd(env, args);
    case 'add-stat': return addStatCmd(env, args);
    case 'update-stat': return updateStatCmd(env, args);
    case 'delete-stat': return deleteStatCmd(env, args);
  }
}

