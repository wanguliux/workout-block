import { resolveExerciseByName, getFieldLabel } from '../../data/display';
import { FieldDef, LogRow } from '../../data/types';
import { generateId } from '../../util/id';
import { logRowToCsvLine, logsToCsv, tombstoneLine } from '../../data/csvFormat';
import { ParsedArgs, requireOption, UsageError } from '../args';
import { CliEnv, takenIds } from '../context';
import * as readline from 'readline';
import {
  buildFields,
  formatTimestamp,
  inDateRange,
  normalizeTimestamp,
  sortLogsDesc,
  uniqueId,
} from '../core';
import { logSummary, printJson } from '../output';
import { CliError } from '../vault';

/*
 * recordCmd.ts —— 训练记录的增查删：add / list / delete / compact。
 *
 * 写语义与插件逐条对齐：
 *  - add   ≈ DataManager.addLog：生成唯一 id（避开已删 id）、默认当前时间戳、
 *            O(1) 追加 CSV 行（不整文件重写）；
 *  - delete≈ DataManager.deleteLog：软删除——只追加墓碑行，不改既有数据行；
 *  - compact≈ DataManager.compactLogs：以存活记录整体重写，清掉墓碑与残留行。
 */

/** 从 --field k=v（可重复）与位置参数 k=v 收集字段输入。 */
function collectFieldInput(args: ParsedArgs, positionalsFrom: number): Record<string, string> {
  const input: Record<string, string> = {};
  const eat = (kv: string): void => {
    const eq = kv.indexOf('=');
    if (eq <= 0) {
      throw new UsageError(`字段参数应为 key=value 形式，收到："${kv}"`);
    }
    input[kv.slice(0, eq)] = kv.slice(eq + 1);
  };
  for (const kv of args.repeated['field'] ?? []) eat(kv);
  for (const p of args.positional.slice(positionalsFrom)) eat(p);
  return input;
}

/** 交互式问答函数：抛出问题，返回用户输入（便于注入测试，默认走 readline）。 */
export type PromptFn = (question: string) => Promise<string>;

/**
 * 交互式补全缺失的必填字段——应对「用户说攀岩了一次却没给任何参数」这类场景。
 * 仅对 typeFields 中 `required` 且当前 input 缺失（undefined/空）的字段询问；选填字段不询问。
 * select 字段会循环提示直到命中可选项或用户留空（留空则保持缺失，交由 buildFields 后续校验）。
 * 返回补齐后的 input 副本，不修改入参。
 */
export async function askMissingFields(
  typeFields: FieldDef[],
  input: Record<string, string>,
  prompt: PromptFn,
  out: (message: string) => void = console.log
): Promise<Record<string, string>> {
  const result: Record<string, string> = { ...input };
  const missing = typeFields.filter(
    (f) => f.required && (result[f.key] === undefined || result[f.key] === '')
  );
  if (missing.length === 0) return result;

  out(`检测到 ${missing.length} 个必填参数未提供，将逐个询问：`);
  for (const f of missing) {
    const label = getFieldLabel(f);

    // select：循环提示直到命中可选项或留空（最多 3 次，避免误输入陷死循环）
    if (f.inputType === 'select' && (f.options?.length ?? 0) > 0) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const ans = (await prompt(`${label}（可选：${f.options!.join(' / ')}）：`)).trim();
        if (!ans) break;
        if (f.options!.includes(ans)) {
          result[f.key] = ans;
          break;
        }
        out(`  「${ans}」不在可选范围内，请重新输入（或留空跳过）。`);
      }
      continue;
    }

    let hint = '';
    if (f.inputType === 'duration') hint = '（示例：90m / 1分30秒 / 1h30m）';
    else if (f.inputType === 'number') hint = f.unitLabel ? `（单位：${f.unitLabel}）` : '（输入数字）';
    else hint = '（输入文本）';
    const ans = (await prompt(`${label}${hint}：`)).trim();
    if (ans) result[f.key] = ans;
  }
  return result;
}

/** add：记一笔（或多组）训练。 */
export async function cmdAdd(env: CliEnv, args: ParsedArgs): Promise<void> {
  const exerciseArg = requireOption(args, 'exercise', 'workout-cli add --exercise 深蹲 weight=100 reps=5 [--sets 3]');
  const exercise = resolveExerciseByName(env.config, exerciseArg);
  if (!exercise) {
    throw new CliError(`找不到训练项 "${exerciseArg}"，请先用 resolve 命令确认可用名称`);
  }
  const type = env.config.trainingTypes.find((t) => t.id === exercise.category);
  if (!type) {
    throw new CliError(`训练项 ${exercise.id} 引用的训练类型 ${exercise.category} 不存在于配置中`);
  }

  let fieldInput = collectFieldInput(args, 0);

  // 交互式补全缺失的必填字段：仅在交互终端(TTY)且未带 --no-ask 时；
  // 脚本/管道场景不询问，缺失必填直接交给 buildFields 报错（保持脚本兼容性）。
  if (process.stdin.isTTY && !args.flags.has('no-ask')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      fieldInput = await askMissingFields(type.fields, fieldInput, (q) =>
        new Promise<string>((resolve) => rl.question(q, resolve))
      );
    } finally {
      rl.close();
    }
  }

  const fields = buildFields(type.fields, fieldInput, env.settings.unit);

  const sets = Math.max(1, parseInt(args.options['sets'] ?? '1', 10) || 1);
  const baseTime = args.options['time'] ? normalizeTimestamp(args.options['time']) : formatTimestamp();

  // plan：与 RecordModal 一致，存计划的显示名（计划完成动作才存 sourceNote||id）
  let planValue: string | undefined;
  if (args.options['plan']) {
    const wanted = args.options['plan'];
    const plan = (env.config.plans ?? []).find((p) => p.name === wanted || p.id === wanted);
    if (!plan) {
      throw new CliError(`找不到训练计划 "${wanted}"，可用 plan list 查看`);
    }
    planValue = plan.name;
  }

  // 多组：时间戳逐组 +1 分钟（与 DataManager.addPlanLogs 的间隔策略一致）
  const base = new Date(baseTime.replace(' ', 'T'));
  const taken = takenIds(env);
  const newRows: LogRow[] = [];
  for (let i = 0; i < sets; i++) {
    const id = uniqueId(taken, generateId);
    taken.add(id);
    const ts = i === 0 ? baseTime : formatTimestamp(new Date(base.getTime() + i * 60000));
    newRows.push({
      id,
      timestamp: ts,
      exerciseId: exercise.id,
      category: exercise.category,
      fields,
      note: args.options['note'] || undefined,
      plan: planValue,
    });
  }

  await env.vault.appendCsvLines(
    env.vault.csvPath(env.settings),
    newRows.map((r) => logRowToCsvLine(r)).join('\n')
  );

  if (args.flags.has('json')) {
    return printJson({ added: newRows });
  }
  for (const row of newRows) {
    console.log(`已记录 [${row.id}] ${logSummary(row, env.config, env.settings.unit)}`);
  }
}

/** list：按训练项/日期区间查询记录（默认最新在前，最多 50 条）。 */
export async function cmdList(env: CliEnv, args: ParsedArgs): Promise<void> {
  let logs = env.logs;

  if (args.options['exercise']) {
    const exercise = resolveExerciseByName(env.config, args.options['exercise']);
    if (!exercise) throw new CliError(`找不到训练项 "${args.options['exercise']}"`);
    logs = logs.filter((l) => l.exerciseId === exercise.id);
  }
  const from = args.options['from'];
  const to = args.options['to'];
  if (from || to) {
    logs = logs.filter((l) => inDateRange(l.timestamp, from, to));
  }

  logs = sortLogsDesc(logs);
  const total = logs.length;

  // --last N（最新 N 条）优先于 --limit，与 workout-log 的 number > limit 语义一致
  if (args.options['last']) {
    const n = parseInt(args.options['last'], 10);
    if (Number.isFinite(n) && n > 0) logs = logs.slice(0, n);
  } else if (!args.flags.has('all')) {
    const limit = args.options['limit'] ? parseInt(args.options['limit'], 10) : 50;
    if (Number.isFinite(limit) && limit > 0) logs = logs.slice(0, limit);
  }

  if (args.flags.has('json')) {
    return printJson({ total, shown: logs.length, logs });
  }
  if (logs.length === 0) {
    console.log('没有匹配的训练记录。');
    return;
  }
  for (const row of logs) {
    console.log(`[${row.id}] ${logSummary(row, env.config, env.settings.unit)}`);
  }
  if (total > logs.length) {
    console.log(`（共 ${total} 条，显示 ${logs.length} 条；用 --last / --limit / --all 调整）`);
  }
}

/** delete：按 id 软删除一条记录（追加墓碑，与插件删除语义一致）。 */
export async function cmdDelete(env: CliEnv, args: ParsedArgs): Promise<void> {
  const id = requireOption(args, 'id', 'workout-cli delete --id <记录id> [--vault ...]');
  const target = env.logs.find((l) => l.id === id);
  if (!target) {
    throw new CliError(`找不到 id 为 "${id}" 的存活记录（可能已删除；用 list 查看现有记录）`);
  }
  await env.vault.appendCsvLines(env.vault.csvPath(env.settings), tombstoneLine(id));
  if (args.flags.has('json')) {
    return printJson({ deleted: target });
  }
  console.log(`已删除 [${id}] ${logSummary(target, env.config, env.settings.unit)}`);
}

/** compact：压缩清理——以存活记录整体重写 CSV，移除墓碑与被删行残留。 */
export async function cmdCompact(env: CliEnv, args: ParsedArgs): Promise<void> {
  const removed = env.deletedIds.length;
  await env.vault.writeAtomic(env.vault.csvPath(env.settings), logsToCsv(env.logs) + '\n');
  if (args.flags.has('json')) {
    return printJson({ removedTombstones: removed, aliveRows: env.logs.length });
  }
  console.log(`压缩完成：清理 ${removed} 条已删除记录，保留 ${env.logs.length} 条存活记录。`);
}
