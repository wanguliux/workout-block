import { isStaleHeader, parseCsvContent, CSV_HEADER } from '../../data/csvFormat';
import { ParsedArgs } from '../args';
import { CliEnv } from '../context';
import { printJson } from '../output';
import { WorkoutConfig } from '../../data/types';
import { allowedStatFields, builderToExpr, validateExpression } from '../../data/statExpr';

/*
 * doctorCmd.ts —— 数据体检（只读，不改任何文件）：
 * 报告设置/配置/CSV 的存在性与健康度，帮 agent 与用户定位问题。
 * 修复动作由其他命令承担（compact 清墓碑；插件本体会在加载时做种子迁移与表头自愈）。
 */

export async function cmdDoctor(env: CliEnv, args: ParsedArgs): Promise<void> {
  const csvPath = env.vault.csvPath(env.settings);
  const configPath = env.vault.configPath(env.settings);

  // 统计公式引用失效检测：字段 key 改名/删除后公式静默失效（sum 空值）。
  // 逐个启用统计，用其「关联类型的字段交集」静态校验公式，列出引用非法字段的统计项。
  const statisticsBroken = findBrokenStatistics(env.config);

  // 重复 id 检测：基于原始解析结果里「解析出的存活行」做统计（墓碑过滤后的重复才是真重复）
  const idCount = new Map<string, number>();
  for (const row of env.logs) {
    idCount.set(row.id, (idCount.get(row.id) ?? 0) + 1);
  }
  const duplicateIds = Array.from(idCount.entries())
    .filter(([, n]) => n > 1)
    .map(([id]) => id);

  const csvText = await env.vault.readTextIfExists(csvPath);
  const headerStale = csvText !== null && isStaleHeader(csvText);
  // 原始行数（含墓碑）：用于核对体积
  const rawLineCount = csvText === null ? 0 : Math.max(0, csvText.split('\n').filter((l) => l.trim() !== '').length - 1);

  const report = {
    vault: env.vault.vaultPath,
    settings: {
      file: env.vault.settingsPath,
      found: env.settingsFound,
      unit: env.settings.unit,
      language: env.settings.language,
      csvDirectory: env.settings.csvDirectory || '(根目录)',
      configDirectory: env.settings.configDirectory || '(根目录)',
    },
    config: {
      file: configPath,
      found: env.configFound,
      exercises: env.config.exercises.length,
      trainingTypes: env.config.trainingTypes.length,
      statistics: env.config.statistics.length,
      brokenStatistics: statisticsBroken,
      plans: env.config.plans?.length ?? 0,
    },
    csv: {
      file: csvPath,
      found: env.csvFound,
      headerStale,
      aliveRows: env.logs.length,
      tombstones: env.deletedIds.length,
      droppedDirtyRows: env.droppedRows,
      duplicateIds,
      rawLineCount,
    },
  };

  if (args.flags.has('json')) {
    return printJson(report);
  }

  const ok = (v: boolean) => (v ? '✓' : '✗');
  console.log('设置');
  console.log(`  ${ok(env.settingsFound)} ${report.settings.file}${env.settingsFound ? '' : '（不存在，按默认设置处理）'}`);
  console.log(`  单位=${env.settings.unit} 语言=${env.settings.language} CSV目录=${report.settings.csvDirectory} 配置目录=${report.settings.configDirectory}`);
  console.log('配置');
  console.log(`  ${ok(env.configFound)} ${configPath}${env.configFound ? '' : '（不存在，按默认配置处理）'}`);
  console.log(`  训练项 ${report.config.exercises} / 训练类型 ${report.config.trainingTypes} / 统计 ${report.config.statistics} / 计划 ${report.config.plans}`);
  if (statisticsBroken.length > 0) {
    for (const s of statisticsBroken) {
      console.log(`  ✗ 统计「${s.name}」公式引用失效：${s.errors.join('；')}（请用 stats 编辑该统计修正公式）`);
    }
  } else {
    console.log('  ✓ 统计公式字段引用均有效');
  }
  console.log('训练记录 CSV');
  console.log(`  ${ok(env.csvFound)} ${csvPath}${env.csvFound ? '' : '（不存在，视为空库）'}`);
  if (env.csvFound) {
    console.log(`  ${ok(!headerStale)} 表头${headerStale ? `已过时（应为：${CSV_HEADER}）——在 Obsidian 中打开插件可自愈` : '正常'}`);
    console.log(`  存活记录 ${report.csv.aliveRows} 条 / 墓碑 ${report.csv.tombstones} 条 / 丢弃脏行 ${report.csv.droppedDirtyRows} 条 / 原始数据行 ${report.csv.rawLineCount} 行`);
    if (duplicateIds.length > 0) {
      console.log(`  ✗ 发现重复 id：${duplicateIds.join(', ')}（建议 compact 前先在 Obsidian 中核对）`);
    }
    if (report.csv.tombstones > 0) {
      console.log(`  提示：可用 compact 命令清理墓碑、释放体积`);
    }
  }

  // 额外做一次「原始解析」对照：dropped>0 说明文件里有被容错规则丢弃的脏行
  if (env.csvFound && csvText !== null) {
    const reparsed = parseCsvContent(csvText);
    if (reparsed.dropped > 0) {
      console.log(`  ⚠ 有 ${reparsed.dropped} 行因缺少关键字段/超长 fields 被丢弃（历史脏数据，属预期容错行为）`);
    }
  }
}

// 逐个启用统计做公式字段引用静态校验。
// 用「关联类型的字段交集」作为合法字段集（allowedStatFields），
// 公式引用到不在交集内的字段即判定失效（字段 key 改名/删除会触发）。
function findBrokenStatistics(config: WorkoutConfig): Array<{ id: string; name: string; errors: string[] }> {
  const broken: Array<{ id: string; name: string; errors: string[] }> = [];
  for (const stat of config.statistics) {
    if (!stat.enabled) continue;
    const expr = stat.formula.mode === 'builder'
      ? builderToExpr(stat.formula.builder)
      : (stat.formula.expression ?? '');
    if (!expr.trim()) continue;
    try {
      validateExpression(expr, allowedStatFields(stat, config));
    } catch (e) {
      broken.push({ id: stat.id, name: stat.name, errors: [(e as Error).message] });
    }
  }
  return broken;
}
