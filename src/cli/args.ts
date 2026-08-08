/*
 * args.ts —— CLI 的极简参数解析器（零依赖）。
 *
 * 支持三种形态：
 *  - 位置参数：  workout-cli resolve 深蹲
 *  - 键值选项：  --exercise 深蹲  或  --exercise=深蹲（同名取最后一个）
 *  - 布尔开关：  --json（在 spec.flags 中声明者，无值）
 *  - 可重复项：  --field weight=100 --field reps=5（在 spec.repeated 中声明者，全部保留）
 *
 * 解析器本身不做业务校验（哪些选项合法、是否必填由各命令负责），
 * 但会原样暴露未识别的 -- 选项，供命令层报错，避免拼错参数被静默忽略。
 */

export interface ArgSpec {
  /** 布尔开关（出现即为 true，不吃值） */
  flags?: string[];
  /** 可重复选项（收集为数组） */
  repeated?: string[];
}

export interface ParsedArgs {
  positional: string[];
  options: Record<string, string>;
  flags: Set<string>;
  repeated: Record<string, string[]>;
  /** 未在任何已知清单里、但也没被命令显式声明的选项名（供命令层兜底报错用） */
  seenOptionNames: string[];
}

export function parseArgs(argv: string[], spec: ArgSpec = {}): ParsedArgs {
  const flags = new Set(spec.flags ?? []);
  const repeatedNames = new Set(spec.repeated ?? []);
  const result: ParsedArgs = {
    positional: [],
    options: {},
    flags: new Set(),
    repeated: {},
    seenOptionNames: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      result.positional.push(token);
      continue;
    }
    const body = token.slice(2);
    if (body === '') {
      // 裸 `--` 之后全部按位置参数处理（shell 惯例）
      result.positional.push(...argv.slice(i + 1));
      break;
    }
    const eq = body.indexOf('=');
    const name = eq >= 0 ? body.slice(0, eq) : body;
    result.seenOptionNames.push(name);

    if (flags.has(name) && eq < 0) {
      result.flags.add(name);
      continue;
    }

    let value: string;
    if (eq >= 0) {
      value = body.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        // 没有值：按布尔开关处理（即使未在 flags 声明，也允许当开关用，命令层可报错）
        result.flags.add(name);
        continue;
      }
      value = next;
      i++;
    }

    if (repeatedNames.has(name)) {
      (result.repeated[name] ??= []).push(value);
    } else {
      result.options[name] = value;
    }
  }
  return result;
}

/** 取值或抛错（用于必填选项）。 */
export function requireOption(args: ParsedArgs, name: string, usage: string): string {
  const v = args.options[name];
  if (v === undefined || v === '') {
    throw new UsageError(`缺少必填选项 --${name}。用法：${usage}`);
  }
  return v;
}

/** 命令用法错误（退出码 2，与运行时错误区分）。 */
export class UsageError extends Error {}
