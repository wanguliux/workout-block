import { resolveExerciseByName } from '../../data/display';
import { computeStat, formatStatValue } from '../../data/statExpr';
import { LogRow, StatDef } from '../../data/types';
import { ParsedArgs, UsageError } from '../args';
import { CliEnv } from '../context';
import { assertDate, groupKey, inDateRange, resolveStat } from '../core';
import { printJson, renderTable } from '../output';
import { CliError } from '../vault';

/*
 * statsCmd.ts —— 数据统计：对记录按 date/week 分组（或不分组），
 * 用配置里的 StatDef（与插件完全同一套 computeStat）计算聚合值。
 *
 * 口径与插件 workout-log 代码块一致：
 *  - 统计只落在「训练项 category ∈ stat.associatedTypes」的记录上；
 *  - 基于筛选后的完整记录计算，不做显示裁剪。
 */

export async function cmdStats(env: CliEnv, args: ParsedArgs): Promise<void> {
  // 选定统计项：--stat 指定 id/名称；缺省 = 全部启用的统计
  let stats: StatDef[];
  if (args.options['stat']) {
    const stat = resolveStat(env.config, args.options['stat']);
    if (!stat) {
      const names = env.config.statistics.map((s) => `${s.name}(${s.id})`).join('、');
      throw new CliError(`找不到统计项 "${args.options['stat']}"。现有统计：${names || '（无）'}`);
    }
    stats = [stat];
  } else {
    stats = env.config.statistics.filter((s) => s.enabled);
    if (stats.length === 0) throw new CliError('配置中没有启用的统计项，请先在插件「数据统计」里配置');
  }

  // 公共筛选：训练项 + 日期区间
  let logs = env.logs;
  if (args.options['exercise']) {
    const exercise = resolveExerciseByName(env.config, args.options['exercise']);
    if (!exercise) throw new CliError(`找不到训练项 "${args.options['exercise']}"`);
    logs = logs.filter((l) => l.exerciseId === exercise.id);
  }
  const from = args.options['from'] ? assertDate(args.options['from']) : undefined;
  const to = args.options['to'] ? assertDate(args.options['to']) : undefined;
  if (from || to) {
    logs = logs.filter((l) => inDateRange(l.timestamp, from, to));
  }

  const groupBy = (args.options['group'] ?? 'none') as 'date' | 'week' | 'none';
  if (!['date', 'week', 'none'].includes(groupBy)) {
    throw new UsageError('--group 只支持 date / week / none');
  }

  interface StatResult { statId: string; statName: string; groups: { key: string; value: string; raw: number }[] }
  const results: StatResult[] = [];

  for (const stat of stats) {
    // 作用范围 = category ∈ associatedTypes（与代码块渲染口径一致）
    const scoped = logs.filter((l) => stat.associatedTypes.includes(l.category));

    let buckets: Map<string, LogRow[]>;
    if (groupBy === 'none') {
      buckets = new Map([['全部', scoped]]);
    } else {
      buckets = new Map();
      for (const log of scoped) {
        const key = groupKey(log.timestamp, groupBy);
        const arr = buckets.get(key);
        if (arr) arr.push(log);
        else buckets.set(key, [log]);
      }
    }

    const keys = Array.from(buckets.keys()).sort().reverse();
    results.push({
      statId: stat.id,
      statName: stat.name,
      groups: keys.map((key) => {
        const raw = computeStat(stat, buckets.get(key) ?? []);
        return { key, value: formatStatValue(raw, stat.unit), raw };
      }),
    });
  }

  if (args.flags.has('json')) {
    return printJson({ results });
  }
  for (const r of results) {
    console.log(`■ ${r.statName}（${r.statId}）`);
    if (r.groups.length === 0) {
      console.log('  （无匹配记录）');
      continue;
    }
    console.log(
      renderTable(
        ['分组', '统计值'],
        r.groups.map((g) => [g.key, g.value])
      )
        .split('\n')
        .map((line) => '  ' + line)
        .join('\n')
    );
  }
}
