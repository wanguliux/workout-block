import { App, TFile } from 'obsidian';
import { WorkoutConfig } from './types';
import { resolveExerciseByName } from './display';

/*
 * planScanner.ts —— 训练方案（笔记）扫描工具
 * 「训练方案」= 含有 ≥2 个 ```workout-log 代码块的笔记（即「训练记录表」模板）。
 * 本文件提供两类能力：
 *   1) ensureSchemeIndex / getSchemeNotes / onSchemeIndexChanged：维护一个「方案笔记」索引。
 *      索引在首次打开「新增训练计划」弹窗时构建（ensureSchemeIndex），之后通过 vault 的
 *      create/modify/delete/rename 事件对「单个文件」增量更新，避免每次全库扫描；
 *      索引变化时通过 onSchemeIndexChanged 广播，弹窗可即时刷新下拉。
 *   2) extractSchemeExercises：从某方案笔记里提取所有 workout-log 代码块的 exercise，
 *      解析为训练项列表（去重），作为计划的初始训练项。
 */

export interface SchemeNote {
  path: string;
  name: string; // basename（去掉 .md），即方案名
}

// 进程内索引：所有「方案笔记」（含 ≥2 个 workout-log 代码块）。null = 尚未构建。
let schemeIndex: SchemeNote[] | null = null;

// 索引变化监听器集合（弹窗打开时订阅，关闭时退订）。
const listeners = new Set<() => void>();

// vault 事件钩子是否已注册（整会话只注册一次）。
let vaultHooked = false;

// 统计一段内容里 ```workout-log 代码块（起始围栏）的数量。
function countWorkoutLogBlocks(content: string): number {
  const re = /```\s*workout-log\b/g;
  let count = 0;
  while (re.exec(content) !== null) count++;
  return count;
}

// 广播索引变化（单个订阅者异常不影响其他订阅者）。
function emitChanged(): void {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* 忽略订阅者异常 */
    }
  }
}

// 重新评估单个文件是否仍属于方案笔记，并增量更新索引；状态变化则广播。
async function updateFileIndex(app: App, file: TFile): Promise<void> {
  if (schemeIndex === null) return; // 索引尚未构建，稍后全量构建会覆盖
  if (file.extension !== 'md') return;
  const idx = schemeIndex.findIndex((n) => n.path === file.path);
  let qualifies = false;
  try {
    const content = await app.vault.read(file);
    qualifies = countWorkoutLogBlocks(content) >= 2;
  } catch {
    qualifies = false;
  }
  if (qualifies && idx === -1) {
    schemeIndex.push({ path: file.path, name: file.basename });
    schemeIndex.sort((a, b) => a.name.localeCompare(b.name));
    emitChanged();
  } else if (!qualifies && idx !== -1) {
    schemeIndex.splice(idx, 1);
    emitChanged();
  }
}

// 全量构建索引（仅在首次 / 失效时调用，读取所有 markdown 文件一次）。
async function buildSchemeIndex(app: App): Promise<void> {
  const notes: SchemeNote[] = [];
  if (typeof app.vault.getMarkdownFiles === 'function') {
    for (const file of app.vault.getMarkdownFiles()) {
      if (file.extension !== 'md') continue;
      try {
        const content = await app.vault.cachedRead(file);
        if (countWorkoutLogBlocks(content) >= 2) {
          notes.push({ path: file.path, name: file.basename });
        }
      } catch {
        // 单文件读取失败不影响整体
      }
    }
  }
  notes.sort((a, b) => a.name.localeCompare(b.name));
  schemeIndex = notes;
}

// 注册 vault 事件钩子，做单文件增量更新（整会话只注册一次）。
function hookVault(app: App): void {
  if (vaultHooked) return;
  vaultHooked = true;
  const onFileChanged = (file: TFile) => {
    if (file.extension !== 'md') return;
    void updateFileIndex(app, file);
  };
  app.vault.on('create', onFileChanged);
  app.vault.on('modify', onFileChanged);
  app.vault.on('delete', (file) => {
    if (schemeIndex === null || !(file instanceof TFile)) return;
    const idx = schemeIndex.findIndex((n) => n.path === file.path);
    if (idx !== -1) {
      schemeIndex.splice(idx, 1);
      emitChanged();
    }
  });
  app.vault.on('rename', (file, oldPath) => {
    if (schemeIndex === null || !(file instanceof TFile)) return;
    const idx = schemeIndex.findIndex((n) => n.path === oldPath);
    if (idx !== -1) schemeIndex.splice(idx, 1);
    void updateFileIndex(app, file); // 以新路径重新评估是否仍属方案笔记
  });
}

// 确保索引已构建（首次会全量扫描并注册事件钩子）；返回当前索引。
export async function ensureSchemeIndex(app: App): Promise<SchemeNote[]> {
  if (schemeIndex === null) {
    await buildSchemeIndex(app);
    hookVault(app);
  }
  return schemeIndex!;
}

// 返回当前索引（若尚未构建则返回空数组，不会触发扫描）。
export function getSchemeNotes(): SchemeNote[] {
  return schemeIndex ?? [];
}

// 订阅索引变化，返回退订函数。
export function onSchemeIndexChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// 重置索引（强制下次重新全量构建）。保留订阅者集合。
export function invalidateSchemeCache(): void {
  schemeIndex = null;
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
