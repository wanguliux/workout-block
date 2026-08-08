import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getExerciseNameById, renderFieldValue, formatTimeRule, resolveExerciseByName } from '../../data/display';
import { TrainingPlanInstance } from '../../data/types';
import { generateId } from '../../util/id';
import { logRowToCsvLine } from '../../data/csvFormat';
import { countWorkoutLogBlocks, extractSchemeExercisesFromContent } from '../../data/schemeRules';
import { ParsedArgs, requireOption, UsageError } from '../args';
import { CliEnv, takenIds } from '../context';
import { assertDate, formatTimestamp, todayStr, uniqueId } from '../core';
import {
  applyPlanDelete, applyPlanUpdate, buildPlan, buildPlanItems, buildTimeRule,
  itemsFromScheme, parseItemsJson, rewritePlanReferences,
} from '../planOps';
import { logSummary, printJson, renderTable } from '../output';
import { CliError } from '../vault';

/*
 * planCmd.ts —— 训练计划：plan list / show / complete / add / update / delete。
 *
 * plan complete 与插件 workout-plan 面板「完成」按钮逐条对齐（双写）：
 *  1) 持久化完成态：plan.completedSets[`${exerciseId}#${setId}`] = 完成日期
 *     （独立于训练记录，删除记录不回退完成态）；
 *  2) 同时追加一条训练记录：fields = 组预设 + _planSet 标记，
 *     plan 字段 = plan.sourceNote || plan.id（稳定方案标识，不是可改的计划名）。
 *
 * plan add/update/delete 对齐 NewPlanModal.save / upsertPlan / deletePlan：
 * 名称唯一、至少一个启用项、改名级联改写 vault 内 workout-plan 代码块（不动 CSV）。
 */

function findPlan(env: CliEnv, nameOrId: string): TrainingPlanInstance {
  const plans = env.config.plans ?? [];
  const hit = plans.find((p) => p.name === nameOrId || p.id === nameOrId);
  if (!hit) {
    const names = plans.map((p) => p.name).join('、');
    throw new CliError(`找不到训练计划 "${nameOrId}"。现有计划：${names || '（无）'}`);
  }
  return hit;
}

export async function cmdPlan(env: CliEnv, args: ParsedArgs): Promise<void> {
  const sub = args.positional[0];
  if (sub === 'list' || sub === undefined) return planList(env, args);
  if (sub === 'show') return planShow(env, args);
  if (sub === 'complete') return planComplete(env, args);
  if (sub === 'add') return planAdd(env, args);
  if (sub === 'update') return planUpdate(env, args);
  if (sub === 'delete') return planDelete(env, args);
  throw new UsageError('用法：workout-cli plan <list|show|complete|add|update|delete> ...');
}

async function planList(env: CliEnv, args: ParsedArgs): Promise<void> {
  const plans = env.config.plans ?? [];
  if (args.flags.has('json')) return printJson(plans);
  if (plans.length === 0) {
    console.log('（暂无训练计划）');
    return;
  }
  const rows = plans.map((p) => {
    const total = p.items.filter((i) => i.enabled).reduce((n, i) => n + i.sets.length, 0);
    const done = Object.keys(p.completedSets ?? {}).length;
    return [p.name, p.id, formatTimeRule(p.timeRule), `${done}/${total}`];
  });
  console.log(renderTable(['名称', 'id', '时间', '完成组/总组'], rows));
}

async function planShow(env: CliEnv, args: ParsedArgs): Promise<void> {
  const plan = findPlan(env, requireOption(args, 'plan', 'workout-cli plan show --plan <名称或id>'));
  if (args.flags.has('json')) return printJson(plan);

  console.log(`计划       ${plan.name}（id=${plan.id}）`);
  console.log(`时间       ${formatTimeRule(plan.timeRule)}`);
  if (plan.sourceNote) console.log(`来源方案   ${plan.sourceNote}`);
  const completed = new Set(Object.keys(plan.completedSets ?? {}));
  for (const item of plan.items) {
    const name = getExerciseNameById(env.config.exercises, item.exerciseId) || item.exerciseId;
    console.log(`\n${item.enabled ? '✓' : '✗'} ${name}（${item.category}）`);
    item.sets.forEach((set, idx) => {
      const doneAt = completed.has(`${item.exerciseId}#${set.id}`)
        ? plan.completedSets?.[`${item.exerciseId}#${set.id}`]
        : undefined;
      const type = env.config.trainingTypes.find((t) => t.id === item.category);
      const fieldText = (type?.fields ?? [])
        .map((f) => {
          const v = set.fields[f.key];
          return v === undefined || v === null ? null : `${f.key}=${renderFieldValue(v, f, env.settings.unit)}`;
        })
        .filter((x): x is string => x !== null)
        .join(' ');
      console.log(
        `    组${idx + 1} [set:${set.id}] ${fieldText || '(无预设字段)'}${doneAt ? `  已完成(${doneAt})` : ''}`
      );
    });
  }
}

async function planComplete(env: CliEnv, args: ParsedArgs): Promise<void> {
  const plan = findPlan(env, requireOption(args, 'plan', 'workout-cli plan complete --plan <名称或id> --exercise <训练项> --set <组id>'));
  const exerciseArg = requireOption(args, 'exercise', 'workout-cli plan complete --plan <名称或id> --exercise <训练项> --set <组id>');
  const setId = requireOption(args, 'set', 'workout-cli plan complete --plan <名称或id> --exercise <训练项> --set <组id>');

  // 训练项：先按名称/id 反查配置，再看计划里有没有这一项
  const exercise = resolveExerciseByName(env.config, exerciseArg);
  if (!exercise) throw new CliError(`找不到训练项 "${exerciseArg}"`);
  const item = plan.items.find((i) => i.exerciseId === exercise.id);
  if (!item) {
    throw new CliError(`计划 "${plan.name}" 里没有训练项 ${getExerciseNameById(env.config.exercises, exercise.id)}`);
  }
  const set = item.sets.find((s) => s.id === setId);
  if (!set) {
    throw new CliError(`训练项 ${exercise.id} 下没有 set id 为 "${setId}" 的组，请用 plan show --plan 查看`);
  }

  const completedKey = `${exercise.id}#${set.id}`;
  const date = args.options['date'] ? assertDate(args.options['date']) : todayStr();
  const already = plan.completedSets?.[completedKey];

  // 1) 完成态写配置（completedSets 持久化）
  if (!plan.completedSets) plan.completedSets = {};
  plan.completedSets[completedKey] = date;
  await env.vault.writeAtomic(
    env.vault.configPath(env.settings),
    JSON.stringify(env.config, null, 2)
  );

  // 2) 追加训练记录（与插件「完成」按钮同构：_planSet 标记 + 稳定方案标识）
  const row = {
    id: uniqueId(takenIds(env), generateId),
    timestamp: formatTimestamp(),
    exerciseId: item.exerciseId,
    category: item.category,
    fields: { ...set.fields, _planSet: set.id },
    plan: plan.sourceNote || plan.id,
  };
  await env.vault.appendCsvLines(env.vault.csvPath(env.settings), logRowToCsvLine(row));

  if (args.flags.has('json')) {
    return printJson({ plan: plan.name, completedKey, date, alreadyCompleted: already ?? null, record: row });
  }
  if (already) console.log(`该组此前已于 ${already} 标记完成，本次更新为 ${date}。`);
  console.log(`已标记完成：${plan.name} / ${getExerciseNameById(env.config.exercises, exercise.id)} / 组 ${setId}`);
  console.log(`已记录 [${row.id}] ${logSummary(row, env.config, env.settings.unit)}`);
}

// ===== 计划写入（add / update / delete） =====

const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

/** 递归收集 vault 内所有 .md 文件（跳过 .obsidian/.trash 等目录）。 */
async function walkMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(full);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

/** 按 basename 定位方案笔记；多个同名时报错避免歧义。 */
async function findSourceNoteFile(env: CliEnv, basename: string): Promise<string> {
  const files = await walkMarkdownFiles(env.vault.vaultPath);
  const hits = files.filter((f) => path.basename(f, '.md') === basename);
  if (hits.length === 0) throw new CliError(`vault 里找不到名为 "${basename}.md" 的笔记`);
  if (hits.length > 1) {
    throw new CliError(`存在多个同名笔记 "${basename}.md"（${hits.join(' ; ')}），请先重命名消歧`);
  }
  return hits[0];
}

async function planAdd(env: CliEnv, args: ParsedArgs): Promise<void> {
  const name = requireOption(args, 'name', 'workout-cli plan add --name <计划名> [--date YYYY-MM-DD | --weekdays 1,3,5] [--source-note <笔记名> | --items-json JSON]');
  const timeRule = buildTimeRule(args.options['date'], args.options['weekdays']);

  let items;
  let sourceNote: string | undefined;
  if (args.options['items-json']) {
    items = buildPlanItems(env.config, parseItemsJson(args.options['items-json'], env.config));
  } else if (args.options['source-note']) {
    sourceNote = args.options['source-note'];
    const file = await findSourceNoteFile(env, sourceNote);
    const content = await fs.readFile(file, 'utf8');
    // 与插件一致的方案笔记判定：≥2 个 workout-log 代码块
    if (countWorkoutLogBlocks(content) < 2) {
      throw new CliError(`"${sourceNote}" 不是有效方案笔记（需要至少 2 个 workout-log 代码块）`);
    }
    const extracted = extractSchemeExercisesFromContent(content, env.config);
    if (extracted.length === 0) throw new CliError(`方案笔记 "${sourceNote}" 的代码块里没有可解析的 exercise 参数`);
    items = buildPlanItems(env.config, itemsFromScheme(extracted));
  } else {
    throw new UsageError('plan add 需要 --items-json（手动指定训练项）或 --source-note（从方案笔记提取）');
  }

  const plan = buildPlan(env.config, { name, timeRule, sourceNote, items });
  if (!env.config.plans) env.config.plans = [];
  env.config.plans.push(plan);
  await env.vault.writeAtomic(env.vault.configPath(env.settings), JSON.stringify(env.config, null, 2));

  if (args.flags.has('json')) return printJson(plan);
  console.log(`已创建计划：${plan.name}（id=${plan.id}，${plan.items.length} 个训练项，时间 ${formatTimeRule(plan.timeRule)}${sourceNote ? `，来源 ${sourceNote}` : ''}）`);
}

async function planUpdate(env: CliEnv, args: ParsedArgs): Promise<void> {
  const planRef = requireOption(args, 'plan', 'workout-cli plan update --plan <名称或id> [--new-name ...] [--date ... | --weekdays ...] [--items-json ...]');
  const patch: Parameters<typeof applyPlanUpdate>[1] = { plan: planRef };
  if (args.options['new-name']) patch.newName = args.options['new-name'];
  if (args.options['date'] !== undefined || args.options['weekdays'] !== undefined) {
    patch.timeRule = buildTimeRule(args.options['date'], args.options['weekdays']);
  }
  if (args.options['items-json']) {
    patch.items = buildPlanItems(env.config, parseItemsJson(args.options['items-json'], env.config));
  }

  const { plan, oldName, nameChanged } = applyPlanUpdate(env.config, patch);
  await env.vault.writeAtomic(env.vault.configPath(env.settings), JSON.stringify(env.config, null, 2));

  // 改名级联：改写 vault 内 workout-plan 代码块的 plan: 参数（不动 CSV，镜像 upsertPlan）
  let blocksUpdated = 0;
  let filesUpdated = 0;
  if (nameChanged) {
    for (const file of await walkMarkdownFiles(env.vault.vaultPath)) {
      const content = await fs.readFile(file, 'utf8');
      const { content: next, updated } = rewritePlanReferences(content, oldName, plan.name);
      if (updated > 0) {
        await env.vault.writeAtomic(file, next);
        blocksUpdated += updated;
        filesUpdated++;
      }
    }
  }

  if (args.flags.has('json')) return printJson({ plan, nameChanged, blocksUpdated, filesUpdated });
  console.log(`已更新计划：${plan.name}${nameChanged ? `（原名 ${oldName}，级联改写 ${filesUpdated} 个笔记里的 ${blocksUpdated} 处代码块）` : ''}`);
}

async function planDelete(env: CliEnv, args: ParsedArgs): Promise<void> {
  const planRef = requireOption(args, 'plan', 'workout-cli plan delete --plan <名称或id> --yes');
  const target = findPlan(env, planRef);
  const completedCount = Object.keys(target.completedSets ?? {}).length;
  if (!args.flags.has('yes')) {
    throw new CliError(
      `危险操作：将删除计划 "${target.name}"（${target.items.length} 个训练项${completedCount > 0 ? `，${completedCount} 组完成态将一并移除` : ''}）。不影响已有训练记录。确认执行请加 --yes`
    );
  }
  applyPlanDelete(env.config, target.id);
  await env.vault.writeAtomic(env.vault.configPath(env.settings), JSON.stringify(env.config, null, 2));
  if (args.flags.has('json')) return printJson({ deletedPlan: target.name });
  console.log(`已删除计划 ${target.name}（已有训练记录不受影响）。`);
}
