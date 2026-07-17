import { App, TFile } from 'obsidian';
import { WorkoutConfig } from './types';
import { resolveExerciseByName } from './display';

/*
 * planScanner.ts —— 训练方案（笔记）扫描工具
 * 「训练方案」= 含有 ```workout-plan 代码块的笔记。本文件提供两个能力：
 *   1) findSchemeNotes：扫描 vault，找出所有训练方案笔记（供「新增训练计划」下拉选择）。
 *   2) extractSchemeExercises：从某方案笔记里提取所有 workout-log 代码块的 exercise，
 *      解析为训练项列表（去重），作为计划的初始训练项。
 * 两者都用 cachedRead（Obsidian 缓存层），避免反复读盘；结果做进程内缓存。
 */

export interface SchemeNote {
  path: string;
  name: string; // basename（去掉 .md），即方案名
}

// 进程内缓存：扫描结果在本次会话内复用，避免每次打开弹窗都全量扫描。
let schemeCache: SchemeNote[] | null = null;

// 重置缓存（配置/笔记变化后可调用，强制下次重新扫描）。
export function invalidateSchemeCache(): void {
  schemeCache = null;
}

// 找出所有含 ```workout-plan 代码块的笔记。
export async function findSchemeNotes(app: App): Promise<SchemeNote[]> {
  if (schemeCache) return schemeCache;
  const notes: SchemeNote[] = [];
  if (typeof app.vault.getMarkdownFiles !== 'function') return notes;
  const files = app.vault.getMarkdownFiles();
  for (const file of files) {
    try {
      const content = await app.vault.cachedRead(file);
      if (/```\s*workout-plan\b/.test(content)) {
        notes.push({ path: file.path, name: file.basename });
      }
    } catch {
      // 单文件读取失败不影响整体
    }
  }
  notes.sort((a, b) => a.name.localeCompare(b.name));
  schemeCache = notes;
  return notes;
}

// 从方案笔记提取训练项：遍历所有 ```workout-log 代码块，解析 exercise 参数 → 训练项 id。
export async function extractSchemeExercises(
  app: App,
  notePath: string,
  config: WorkoutConfig
): Promise<{ exerciseId: string; category: string }[]> {
  if (typeof app.vault.getAbstractFileByPath !== 'function') return [];
  const file = app.vault.getAbstractFileByPath(notePath);
  if (!(file instanceof TFile)) return [];
  const content = await app.vault.cachedRead(file);

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
