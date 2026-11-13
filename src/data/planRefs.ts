/*
 * planRefs.ts —— 改写 markdown 笔记里 ```workout-plan 代码块的 plan: 参数（纯函数，零依赖）。
 *
 * 使用场景：计划改名后级联更新引用它的代码块。插件（DataManager，经 vault.process 写回）
 * 与 CLI（planOps，经 fs 写回）共用这一份实现——两侧改写规则必须逐字一致，
 * 否则同一份笔记在插件里改一次、在 CLI 里改一次，结果会不一样。
 *
 * 规则：
 *  - 只认围栏内第一处 `plan:` 参数行，值严格等于 oldName 才替换（不做模糊匹配，避免误伤同名子串）；
 *  - 未命中则原样返回（updated === 0），调用方可据此跳过写盘。
 */

export function rewritePlanRefInContent(
  content: string,
  oldName: string,
  newName: string
): { content: string; updated: number } {
  const lines = content.split('\n');
  let updated = 0;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim().startsWith('```workout-plan')) {
      let j = i + 1;
      let closing = -1;
      while (j < lines.length) {
        if (lines[j].trim().startsWith('```')) { closing = j; break; }
        const trimmed = lines[j].trim();
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
          const key = trimmed.slice(0, colonIdx).trim();
          if (key === 'plan') {
            const val = trimmed.slice(colonIdx + 1).trim();
            if (val === oldName) {
              lines[j] = 'plan: ' + newName;
              updated++;
            }
            break; // 只处理第一个 plan: 参数
          }
        }
        j++;
      }
      i = closing >= 0 ? closing + 1 : lines.length;
    } else {
      i++;
    }
  }
  return { content: updated > 0 ? lines.join('\n') : content, updated };
}
