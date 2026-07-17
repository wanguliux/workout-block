import { App, MarkdownPostProcessorContext } from 'obsidian';
import { WorkoutConfig } from '../data/types';
import { resolveExerciseIdByName } from '../data/display';

/*
 * registry.ts —— 代码块（Code Block）渲染注册表
 * 背景：在 Obsidian 笔记里用 ```workout-log 这样的「围栏代码块」，
 * 插件会把它渲染成表格。Obsidian 管这种渲染叫 MarkdownPostProcessor。
 * 本文件用两个全局容器管理：
 *   1) registry：类型名(如 'workout-log') → 渲染函数 的映射，相当于「登记每种代码块怎么画」。
 *   2) renderedBlocks：记录笔记里「所有已渲染出来的代码块」，方便数据变化时统一重画。
 */

// 渲染函数类型：接收代码块原文 source、要往里塞内容的 DOM 容器 el、以及上下文 ctx
export type CodeBlockHandler = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void;

// 类型 → 渲染函数 的注册表（Map 像字典，key 是代码块类型名）
const registry = new Map<string, CodeBlockHandler>();
// 持有 Obsidian App 引用，用于重渲染后把焦点还给编辑器（修复「代码块按钮被重渲染移除导致光标丢失」）。
// 由 main.ts 在 onload 时注入。
let appRef: App | null = null;
export function setRegistryApp(app: App): void {
  appRef = app;
}
// 已渲染代码块清单：每个元素记下了它的 DOM 容器、类型、原文、上下文，便于之后整体重渲染
const renderedBlocks: Array<{ el: HTMLElement; type: string; source: string; ctx: MarkdownPostProcessorContext }> = [];

// 注册一种代码块类型及其渲染函数（插件启动时调用，例如把 'workout-log' 关联到对应渲染器）
export function registerCodeBlock(type: string, handler: CodeBlockHandler): void {
  registry.set(type, handler);
}

// 根据类型名取出对应的渲染函数；没有就返回 undefined
export function getCodeBlockHandler(type: string): CodeBlockHandler | undefined {
  return registry.get(type);
}

// 返回所有已注册的类型名列表（例如 ['workout-log']），用于初始化时告诉 Obsidian 要接管哪些代码块
export function getAllRegisteredTypes(): string[] {
  return Array.from(registry.keys());
}

// 登记一个「已经渲染完」的代码块，把它记进 renderedBlocks，供后续重渲染使用
// 注意：同一个 el 只允许存在一条记录，避免数据变化时重复渲染同一个 DOM。
export function registerRenderedBlock(el: HTMLElement, type: string, source: string, ctx: MarkdownPostProcessorContext): void {
  // 如果该 el 之前已经登记过，先移除旧条目，再 push 新条目（更新 source/ctx）。
  unregisterRenderedBlock(el);
  renderedBlocks.push({ el, type, source, ctx });
}

// 从清单里移除某个已渲染块（DOM 被销毁时调用，避免残留导致重复渲染）
export function unregisterRenderedBlock(el: HTMLElement): void {
  const index = renderedBlocks.findIndex((block) => block.el === el);
  if (index !== -1) {
    renderedBlocks.splice(index, 1);
  }
}

// 重渲染防抖：把短时间内的多次重渲染请求合并成一次，避免数据变化/语言切换时反复刷新。
// 关键点：用「待执行过滤器列表」累积多个请求，而非单一 shouldRender。
// 否则连续调用 rerenderBlocksByType('workout-day') 和 rerenderBlocksByType('workout-heatmap')
// 时，第二次会 clearTimeout 掉第一次的定时器，导致只有后者真正执行，前者被静默吞掉。
let rerenderTimer: number | null = null;
const RERENDER_DEBOUNCE_MS = 50;
const pendingRerenderFilters: Array<(source: string, type: string) => boolean> = [];

// 调度一次重渲染：shouldRender(source, type) 决定哪些代码块需要被重画。
// 多次调用会被合并：防抖窗口内任一过滤器命中即重渲染该代码块。
// 先复制 renderedBlocks 快照再遍历，防止 handler 内部修改数组导致遍历异常或漏渲染。
function scheduleRerender(shouldRender: (source: string, type: string) => boolean): void {
  pendingRerenderFilters.push(shouldRender);
  if (rerenderTimer !== null) {
    // 已有待执行定时器：仅累积过滤器，不重置定时器，保证先前请求不会被吞。
    return;
  }
  rerenderTimer = window.setTimeout(() => {
    const filters = pendingRerenderFilters.slice();
    pendingRerenderFilters.length = 0;
    rerenderTimer = null;
    const blocks = [...renderedBlocks];
    // 焦点修复（机制 A）：重渲染会 block.el.empty() 物理移除代码块内所有子节点，
    // 若用户刚点的删除/完成按钮正持有焦点，焦点会被带回 document.body，
    // 导致 Live Preview 下的 Obsidian 编辑器丢失光标、无法输入。
    // 故先标记「是否有待重渲染的块当前持有焦点」，重渲染后统一把焦点还给编辑器。
    // —— 光标修复（机制 A，稳健版）——
    // 现象复盘：上一版只在循环末尾调一次 ed.focus()，但 Obsidian 在代码块 DOM 变动后
    // 会「异步」再重渲染一次 markdown，把刚还回的焦点再次夺走，光标又丢
    // （用户只能靠切窗再切回、由 OS 窗口焦点事件在稳定后恢复）。本版三重保险：
    //   ① 预判抢先：若焦点在「即将被 empty() 移除的按钮」上，先把焦点交给编辑器本体，
    //      按钮被移除时焦点已在编辑器上，不再掉回 document.body（从源头消除「被夺」）。
    //   ② 容错：每个 handler 用 try/catch 包住，单块渲染异常不得中断焦点恢复。
    //   ③ 兜底：下一绘制帧(rAF)与短暂延时后再 focus 一次——与「切窗再切回」机制同源，
    //      且只在焦点仍「空」(body/null)时才抢回，不打扰用户已主动转移的焦点。
    // 注意：只在该块「确实会被重渲染」时才判定/抢先，避免误夺走别的代码块里
    // 用户仍在用的按钮焦点。
    let focusOwnerWillRerender = false;
    for (const block of blocks) {
      if (block.el.contains(document.activeElement)) {
        if (filters.some((f) => f(block.source, block.type))) {
          focusOwnerWillRerender = true;
          break;
        }
      }
    }

    // ① 抢先把焦点从按钮移到编辑器本体（仅当该块确会被重渲染）
    if (focusOwnerWillRerender && appRef) {
      const ed = appRef.workspace.activeEditor?.editor;
      if (ed) ed.focus();
    }

    for (const block of blocks) {
      // 安全检查：代码块所在视图可能已在 50ms 防抖窗口内被卸载（笔记切换/重载）。
      // 此时 el 已脱离文档，若仍去 empty()/重渲染会操作已销毁的 DOM，破坏 Obsidian
      // 内部(CodeMirror)状态，引发 RangeError 与卡死。故跳过并清理该登记。
      if (!block.el.isConnected) {
        unregisterRenderedBlock(block.el);
        continue;
      }
      // 任一过滤器命中即重渲染（多请求合并语义）
      const should = filters.some((f) => f(block.source, block.type));
      if (should) {
        const handler = registry.get(block.type);
        if (handler) {
          try {
            block.el.empty();
            handler(block.source, block.el, block.ctx);
          } catch (e) {
            console.error('[workout] 代码块重渲染失败，已跳过该块以避免中断焦点恢复:', e);
          }
        }
      }
    }

    // ③ 兜底：对抗 Obsidian 异步二次夺焦（与 OS 窗口焦点恢复同源）
    if (focusOwnerWillRerender && appRef) {
      const restore = () => {
        const ae = document.activeElement;
        // 只在焦点仍「空」(body/null) 时才抢回，不打扰用户已主动转移的焦点
        if (ae === document.body || ae === null) {
          const e2 = appRef?.workspace.activeEditor?.editor;
          if (e2) e2.focus();
        }
      };
      requestAnimationFrame(restore);
      window.setTimeout(restore, 80);
    }
  }, RERENDER_DEBOUNCE_MS);
}

// 重渲染「所有」已渲染的代码块：用于语言切换、外部改文件等需要全局刷新的场景。
export function rerenderAllBlocks(): void {
  scheduleRerender(() => true);
}

// 只重渲染「显示指定训练项」的代码块：添加/编辑/删除一条记录时调用，
// 避免无关表格也被重画（记录越多、代码块越多，全量重渲染越卡）。
// 通过把代码块里的 `exercise:` 参数解析成稳定的 exerciseId 做匹配；
// 无 config 或无法解析时，退化为按名字模糊匹配。
export function rerenderBlocksForExercise(config: WorkoutConfig | null, exerciseId: string | undefined, exerciseName: string): void {
  const name = (exerciseName || '').toLowerCase();
  scheduleRerender((source) => {
    const m = source.match(/^\s*exercise:\s*(.+)$/m);
    if (!m) return true;                  // 没有 exercise 参数，无法判断，保守重画
    const q = m[1].trim();
    if (!q) return true;

    // 优先用稳定的 exerciseId 匹配（跨语言可靠）。
    if (config && exerciseId) {
      const sourceExerciseId = resolveExerciseIdByName(config, q);
      if (sourceExerciseId) {
        return sourceExerciseId === exerciseId;
      }
    }

    // 兜底：按当前语言显示名做模糊匹配（兼容旧数据/自定义训练项）。
    const lowerQ = q.toLowerCase();
    return lowerQ === name || name.includes(lowerQ) || lowerQ.includes(name);
  });
}

// 只重渲染指定类型的代码块（保留以兼容旧调用，已并入 scheduleRerender）。
export function rerenderBlocksByType(type: string): void {
  scheduleRerender((_source, blockType) => blockType === type);
}