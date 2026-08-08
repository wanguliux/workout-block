import { CODE_BLOCK_DEFS, buildCodeBlock } from '../../codeBlockDefs';
import { getExerciseName, resolveExerciseByName } from '../../data/display';
import { ParsedArgs, UsageError } from '../args';
import { CliEnv } from '../context';
import { CliError } from '../vault';

/*
 * blockCmd.ts —— 代码块文本生成：唯一出口走 codeBlockDefs 的 buildCodeBlock，
 * 保证参数 key 与解析器逐字符一致（下划线风格），并拒绝未知参数——
 * 把「参数写了等于没写」的静默失效坑挡在生成之前。
 */

export async function cmdBlock(env: CliEnv, args: ParsedArgs): Promise<void> {
  const defId = args.positional[0];
  if (!defId) {
    throw new UsageError(
      `用法：workout-cli block <${CODE_BLOCK_DEFS.map((d) => d.id).join('|')}> [--param key=value ...]`
    );
  }
  const def = CODE_BLOCK_DEFS.find((d) => d.id === defId);
  if (!def) {
    throw new CliError(`未知代码块 "${defId}"。可选：${CODE_BLOCK_DEFS.map((d) => d.id).join('、')}`);
  }

  const values: Record<string, string> = {};
  const validKeys = new Set(def.params.map((p) => p.key));
  for (const kv of args.repeated['param'] ?? []) {
    const eq = kv.indexOf('=');
    if (eq <= 0) throw new UsageError(`--param 需要 key=value 形式，收到："${kv}"`);
    const key = kv.slice(0, eq);
    if (!validKeys.has(key)) {
      throw new CliError(
        `代码块 ${def.id} 没有参数 "${key}"（写错的参数会被解析器静默忽略）。可用参数：${Array.from(validKeys).join(', ')}`
      );
    }
    values[key] = kv.slice(eq + 1);
  }

  // 训练项参数允许填中文名：统一解析成显示名再写入（解析器本身支持任意语言名反查）
  if (values['exercise']) {
    const exercise = resolveExerciseByName(env.config, values['exercise']);
    if (exercise) values['exercise'] = getExerciseName(exercise);
  }

  // buildCodeBlock 输出即最终代码块文本，直接打印供 agent 原样粘进笔记
  process.stdout.write(buildCodeBlock(def, values));
}
