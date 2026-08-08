import { getExerciseName, getMuscleName, getTrainingTypeName, resolveExerciseByName } from '../../data/display';
import { builderToExpr } from '../../data/statExpr';
import { ParsedArgs, UsageError } from '../args';
import { CliEnv } from '../context';
import { CONFIG_WRITE_VERBS, ConfigWriteVerb, dispatchConfigWrite } from './configWriteCmd';
import { renderTable, printJson } from '../output';
import { CliError } from '../vault';

/*
 * configCmd.ts —— 配置命令入口：查询（locate / config / resolve）+
 * 写入动词（add / update / delete 系列，路由到 configWriteCmd）。
 * agent 用 locate 核对数据落点，用 resolve 把人话里的训练项名落到稳定 id。
 */

/** locate：打印 vault 与数据文件的定位结果（agent 首次接入必跑）。 */
export async function cmdLocate(env: CliEnv, args: ParsedArgs): Promise<void> {
  const info = {
    vault: env.vault.vaultPath,
    settingsFile: env.vault.settingsPath,
    settingsFound: env.settingsFound,
    csvFile: env.vault.csvPath(env.settings),
    csvFound: env.csvFound,
    configFile: env.vault.configPath(env.settings),
    configFound: env.configFound,
    unit: env.settings.unit,
    language: env.settings.language,
  };
  if (args.flags.has('json')) {
    printJson(info);
    return;
  }
  const mark = (found: boolean) => (found ? '存在' : '不存在');
  console.log(`vault      ${info.vault}`);
  console.log(`设置文件   ${info.settingsFile}（${mark(info.settingsFound)}，未找到时用默认设置）`);
  console.log(`训练记录   ${info.csvFile}（${mark(info.csvFound)}）`);
  console.log(`配置文件   ${info.configFile}（${mark(info.configFound)}，未找到时用默认配置）`);
  console.log(`重量单位   ${info.unit}（质量字段按此单位解析输入、以 kg 存储）`);
  console.log(`语言       ${info.language}`);
}

const CONFIG_TARGETS = ['exercises', 'types', 'stats', 'plans', 'muscles'] as const;
type ConfigTarget = typeof CONFIG_TARGETS[number];

/** config <target>：列出配置里的某一类实体；写入动词路由到 configWriteCmd。 */
export async function cmdConfig(env: CliEnv, args: ParsedArgs): Promise<void> {
  const target = args.positional[0] as ConfigTarget | ConfigWriteVerb | undefined;
  if (target && (CONFIG_WRITE_VERBS as readonly string[]).includes(target)) {
    return dispatchConfigWrite(env, target as ConfigWriteVerb, args);
  }
  if (!target || !(CONFIG_TARGETS as readonly string[]).includes(target)) {
    throw new UsageError(
      `用法：查询 workout-cli config <${CONFIG_TARGETS.join('|')}>；` +
      `写入 workout-cli config <${CONFIG_WRITE_VERBS.join('|')}>（详见 help）`
    );
  }
  const { config } = env;
  const json = args.flags.has('json');

  switch (target) {
    case 'exercises': {
      if (json) return printJson(config.exercises);
      const rows = config.exercises.map((e) => [
        e.id,
        getExerciseName(e),
        getTrainingTypeName(config.trainingTypes.find((t) => t.id === e.category)),
      ]);
      console.log(renderTable(['id', '名称', '训练类型'], rows));
      return;
    }
    case 'types': {
      if (json) return printJson(config.trainingTypes);
      const rows = config.trainingTypes.map((t) => [
        t.id,
        getTrainingTypeName(t),
        t.fields.map((f) => `${f.key}${f.required ? '*' : ''}`).join(',') || '(无字段)',
      ]);
      console.log(renderTable(['id', '名称', '字段(*=必填)'], rows));
      return;
    }
    case 'stats': {
      if (json) return printJson(config.statistics);
      const rows = config.statistics.map((s) => [
        s.id,
        s.name,
        s.enabled ? '启用' : '停用',
        s.formula.mode === 'builder' ? builderToExpr(s.formula.builder) : (s.formula.expression ?? ''),
        s.associatedTypes.join(','),
      ]);
      console.log(renderTable(['id', '名称', '状态', '公式', '关联类型'], rows));
      return;
    }
    case 'plans': {
      if (json) return printJson(config.plans ?? []);
      const plans = config.plans ?? [];
      if (plans.length === 0) {
        console.log('（暂无训练计划）');
        return;
      }
      const rows = plans.map((p) => {
        const total = p.items.filter((i) => i.enabled).reduce((n, i) => n + i.sets.length, 0);
        const done = Object.keys(p.completedSets ?? {}).length;
        return [p.id, p.name, `${done}/${total}`];
      });
      console.log(renderTable(['id', '名称', '完成组/总组'], rows));
      return;
    }
    case 'muscles': {
      if (json) return printJson(config.muscles);
      const rows = config.muscles.map((m) => [
        m.id,
        getMuscleName(m),
        m.contributesToCoverage ? '计入覆盖' : '不计入',
      ]);
      console.log(renderTable(['id', '名称', '覆盖统计'], rows));
      return;
    }
  }
}

/** resolve <name>：把训练项的 中文名/英文名/id 反查成稳定 id 与字段清单。 */
export async function cmdResolve(env: CliEnv, args: ParsedArgs): Promise<void> {
  const name = args.positional[0];
  if (!name) throw new UsageError('用法：workout-cli resolve <训练项名称或id> [--vault ...]');
  const exercise = resolveExerciseByName(env.config, name);
  if (!exercise) {
    const names = env.config.exercises.map((e) => getExerciseName(e)).join('、');
    throw new CliError(`找不到训练项 "${name}"。现有训练项：${names}`);
  }
  const type = env.config.trainingTypes.find((t) => t.id === exercise.category);
  if (args.flags.has('json')) {
    return printJson({ exercise, type });
  }
  console.log(`id         ${exercise.id}`);
  console.log(`名称       ${getExerciseName(exercise)}`);
  console.log(`训练类型   ${exercise.category}（${getTrainingTypeName(type)}）`);
  const fields = (type?.fields ?? [])
    .map((f) => `${f.key}${f.required ? '*' : ''}(${f.inputType}${f.mass ? ',质量' : ''})`)
    .join(' ');
  console.log(`字段       ${fields || '(无)'}`);
}
