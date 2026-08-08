import { WorkoutConfig } from './types';
import { resolveExerciseByName } from './display';

/*
 * schemeRules.ts —— 「方案笔记」判定与提取的纯规则（零 Obsidian 依赖）。
 *
 * 方案笔记 = 含 ≥2 个 ```workout-log 代码块的笔记。此判定与 exercise 参数提取
 * 是插件（planScanner 的索引/弹窗）与 workout-block CLI 共用的领域规则，
 * 独立成本模块避免两侧正则漂移。
 */

// 统计一段内容里 ```workout-log 代码块（起始围栏）的数量。
export function countWorkoutLogBlocks(content: string): number {
  const re = /```\s*workout-log\b/g;
  let count = 0;
  while (re.exec(content) !== null) count++;
  return count;
}

// 从方案笔记【文本】提取训练项：遍历所有 ```workout-log 代码块，解析 exercise 参数 → 训练项 id。
export function extractSchemeExercisesFromContent(
  content: string,
  config: WorkoutConfig
): { exerciseId: string; category: string }[] {
  const result: { exerciseId: string; category: string }[] = [];
  const seen = new Set<string>();
  const re = /```\s*workout-log[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const block = m[0];
    const exLine = block.match(/^\s*exercise:\s*(.+)$/m);
    if (!exLine) continue;
    const ex = resolveExerciseByName(config, exLine[1].trim());
    if (ex && !seen.has(ex.id)) {
      seen.add(ex.id);
      result.push({ exerciseId: ex.id, category: ex.category });
    }
  }
  return result;
}
