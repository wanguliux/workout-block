/*
 * editorHost.ts —— 编辑器弹窗的公共生命周期。
 * 每次打开编辑器都会先中止上一个编辑器的监听，避免多次打开后事件重复触发。
 */

import { closeModal } from '../ui';

let current: AbortController | null = null;

export function editorSignal(): AbortSignal {
  current?.abort();
  current = new AbortController();
  return current.signal;
}

export function closeEditor(): void {
  current?.abort();
  current = null;
  closeModal();
}
