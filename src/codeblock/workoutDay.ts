import { App, MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownView, Notice, TFile } from 'obsidian';
import { LogRow, WorkoutConfig } from '../data/types';
import { t } from '../i18n';
import { computeStat, formatStatValue } from '../data/statExpr';
import { getExerciseName, getMuscleName, resolveLogExerciseName, getTrainingTypeName } from '../data/display';
import { registerRenderedBlock, unregisterRenderedBlock } from './registry';

/*
 * workoutDay.ts —— 把 ```workout-day 代码块渲染成「当日训练总览表」。
 *
 * 用户在笔记里写：
 *     ```workout-day
 *     day: 2026-07-12
 *     ```
 * 或 day: today（显示当日，活数据）/ 不写 day（同样显示当日，但多出一个「固定为当日」按钮）。
 *
 * 表格列（5 列）：
 *   项目         —— 该日训练到的每个训练项（按训练先后排序）
 *   数据统计值   —— 该训练项所属类型下、已启用的数据统计条目（可多条，合并一格）
 *   主肌群       —— 该训练项配置的 primary 肌肉
 *   辅助肌群     —— 该训练项配置的 secondary 肌肉
 *   训练方案     —— 该训练项当日记录的 plan 字段（去重后合并展示）
 *
 * 「固定为当日」按钮：仅在「没有写 day 参数」时出现。点击后把当天的日期
 * 写进代码块的 day 参数（直接改笔记源码），按钮随即消失，表格固定为该日。
 * 注意：当 day=today 时，虽然显示的是当日数据，但因为 day 参数已存在，按钮同样不显示。
 */

// 代码块支持的参数
interface WorkoutDayParams {
  // day 的实际取值：'today' 或 'YYYY-MM-DD' 字面日期；缺省时 undefined
  dayValue?: string;
  // 是否显式写了 day 参数（写了 today 也算 true）
  hasDayParam: boolean;
}

// 解析代码块正文：找出 day 参数及其取值，并记录"是否显式写了 day"。
function parseParams(source: string): WorkoutDayParams {
  const params: WorkoutDayParams = { hasDayParam: false };
  for (const line of source.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    if (key === 'day') {
      params.hasDayParam = true;
      params.dayValue = value || undefined;
    }
  }
  return params;
}

// 把 Date 格式化为本地 'YYYY-MM-DD'（与 CSV 里 timestamp 的日期段同格式，便于直接比对）。
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 解析目标日期：返回 { target, live }
//   - target：用于过滤日志的日期字符串（同 CSV 日期段格式）
//   - live：true 表示"随真实日期滚动"（无 day 参数 / day=today），重渲染时会重新取今天
function resolveTargetDate(params: WorkoutDayParams): { target: string; live: boolean } {
  if (!params.hasDayParam) {
    return { target: formatLocalDate(new Date()), live: true };
  }
  if (params.dayValue === 'today') {
    return { target: formatLocalDate(new Date()), live: true };
  }
  // 字面日期：无论格式是否合法，都作为 target 用于比对（非法格式下不会命中任何记录）
  return { target: params.dayValue ?? '', live: false };
}

// 用于追踪已经为哪些 el 注册过 Obsidian Component，防止重渲染时重复 ctx.addChild。
const registeredComponents = new WeakMap<HTMLElement, boolean>();

// 主渲染函数：把代码块渲染成「当日训练总览表」。
export async function renderWorkoutDay(
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  app: App,
  logs: LogRow[],
  config: WorkoutConfig
): Promise<void> {
  // 首次渲染时：注册 Obsidian 子组件，在代码块所在视图卸载时自动从 registry 移除。
  if (!registeredComponents.has(el)) {
    const child = new MarkdownRenderChild(el);
    child.onunload = () => {
      unregisterRenderedBlock(el);
      registeredComponents.delete(el);
    };
    ctx.addChild(child);
    registeredComponents.set(el, true);
    registerRenderedBlock(el, 'workout-day', source, ctx);
  }

  const params = parseParams(source);
  const { target } = resolveTargetDate(params);

  // 点击「固定为当日」：把今天的日期写进代码块源码的 day 参数，使表格固定为该日。
  // 写回机制（与 workoutPlan.writePlanToCodeBlock 同一套「修复机制 B」）：
  // 若当前文件正在 Markdown 编辑器（Live Preview/源码）中打开，优先用 editor.replaceRange
  // 做局部替换——编辑器内部事务，不触发整文件 reload，焦点/光标/撤销栈得以保留；
  // 只有拿不到编辑器（阅读模式/在别的文件里）时才退回 vault.modify 兜底（该场景无光标可丢）。
  async function pinDayToToday(): Promise<void> {
    const file = ctx.sourcePath ? app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
    if (!file || !(file instanceof TFile)) {
      new Notice(t('codeblock.day.pinFailed'));
      return;
    }
    const info = ctx.getSectionInfo(el);
    if (!info) {
      new Notice(t('codeblock.day.pinFailed'));
      return;
    }
    const today = formatLocalDate(new Date());
    // 固定当日：无 day 参数（按钮仅在此时显示），在闭围栏前插入 `day: today` 行即可。
    // 用整块替换实现（原块 body 只有可选的 day 行，此刻不存在），行号计算最简单且不会越界。
    const newBlock = '```workout-day\nday: ' + today + '\n```';

    // 优先：正在编辑该文件的 Markdown 视图 → 编辑器局部替换
    const mdView = app.workspace
      .getLeavesOfType('markdown')
      .map((leaf) => leaf.view)
      .find((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === ctx.sourcePath);
    if (mdView && mdView.editor) {
      const editor = mdView.editor;
      const from = { line: info.lineStart, ch: 0 };
      const to = { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length };
      editor.replaceRange(newBlock, from, to);
      return;
    }

    // 兜底：笔记未在可编辑视图打开（如阅读模式），整文件改写；此场景不存在可丢失的光标。
    const content = await app.vault.read(file);
    const lines = content.split('\n');
    lines.splice(info.lineStart, info.lineEnd - info.lineStart + 1, newBlock);
    await app.vault.modify(file, lines.join('\n'));
  }

  // 过滤出目标日期当天的全部记录（timestamp 形如 "2026-07-12 18:30"，取空格前的日期段比对）。
  // 防御：timestamp 缺失的记录直接忽略，避免脏数据导致 split(undefined) 崩溃。
  const dayLogs = logs.filter((log) => log.timestamp && log.timestamp.split(' ')[0] === target);

  // 容器与头部
  const container = el.createDiv();
  container.addClass('workout-day-container');

  const header = container.createDiv();
  header.addClass('workout-day-header');
  header.createSpan({ text: t('codeblock.day.viewing', { date: target }), cls: 'workout-day-date' });
  // 「固定为当日」按钮：仅当「没写 day 参数」时显示（day=today 视为已固定，不显示）。
  if (!params.hasDayParam) {
    const pinBtn = header.createEl('button', { text: t('codeblock.day.pinToday') });
    pinBtn.addClass('mod-cta');
    pinBtn.addEventListener('click', () => {
      void pinDayToToday();
    });
  }

  // 空状态：该日没有任何训练记录
  if (dayLogs.length === 0) {
    container.createDiv({ text: t('codeblock.day.empty', { date: target }), cls: 'workout-empty' });
    return;
  }

  // 按训练项（exercise）聚合：以 exerciseId 为稳定 key，无 id 的旧数据回退到显示名。
  interface DayGroup {
    key: string;
    exerciseId?: string;
    category: string;
    logs: LogRow[];
    firstTs: string;
  }
  const groups = new Map<string, DayGroup>();
  for (const log of dayLogs) {
    const nameFallback = resolveLogExerciseName(config, log);
    const key = log.exerciseId || nameFallback || '(unknown)';
    let group = groups.get(key);
    if (!group) {
      group = { key, exerciseId: log.exerciseId, category: log.category, logs: [], firstTs: log.timestamp || '' };
      groups.set(key, group);
    }
    group.logs.push(log);
    if (log.timestamp && log.timestamp < group.firstTs) group.firstTs = log.timestamp;
  }

  // 按当日首次训练时间排序（训练先后），更符合"今天练了啥"的阅读顺序。
  const sortedGroups = Array.from(groups.values()).sort((a, b) => a.firstTs.localeCompare(b.firstTs));

  // 训练项卡片网格（对应原型 day-grid / ex-card，替代旧表格）
  const grid = container.createDiv();
  grid.addClass('workout-day-grid');

  for (const group of sortedGroups) {
    const card = grid.createDiv();
    card.addClass('workout-day-card');

    // 卡片头：训练项名 + 训练类型圆角标签（左），方案徽章（右）
    const cardHead = card.createDiv();
    cardHead.addClass('workout-day-card-head');
    const nameWrap = cardHead.createDiv();
    nameWrap.addClass('workout-day-name-wrap');
    const exercise = group.exerciseId ? config.exercises.find((e) => e.id === group.exerciseId) : undefined;
    const name = exercise
      ? getExerciseName(exercise)
      : (resolveLogExerciseName(config, group.logs[0]) || t('codeblock.day.unknown'));
    nameWrap.createEl('h3', { text: name, cls: 'workout-day-name' });
    const typeDef = config.trainingTypes.find((tt) => tt.id === group.category);
    if (typeDef) {
      nameWrap.createSpan({ text: getTrainingTypeName(typeDef), cls: 'workout-cat-label' });
    }
    // 方案徽章：取自该训练项当日记录的 plan 字段（去重合并；多方案时合并显示）
    const plans = Array.from(
      new Set(group.logs.map((l) => l.plan).filter((p): p is string => typeof p === 'string' && p.length > 0))
    );
    if (plans.length) {
      cardHead.createSpan({ text: plans.join('、'), cls: 'workout-day-plan-badge' });
    }

    // 统计值（带单位，逐条分行展示，对应原型「训练总量 3,600 kg / 1RM 估算 95 kg」）
    const matchedStats = (config.statistics ?? []).filter(
      (s) => s.enabled && s.associatedTypes.includes(group.category)
    );
    const statBlock = card.createDiv();
    statBlock.addClass('workout-day-stat');
    if (matchedStats.length) {
      for (const s of matchedStats) {
        const line = statBlock.createDiv();
        line.addClass('workout-day-stat-line');
        line.createSpan({ text: s.name, cls: 'workout-day-stat-label' });
        line.createSpan({ text: formatStatValue(computeStat(s, group.logs), s.unit), cls: 'workout-day-stat-value' });
      }
    } else {
      statBlock.createSpan({ text: '—' });
    }

    // 主肌群 / 辅助肌群：取自训练项配置的 muscles（primary / secondary），渲染为标签
    const muscles = card.createDiv();
    muscles.addClass('workout-day-muscles');
    const primary = exercise ? muscleNames(config, exercise, 'primary') : '—';
    const secondary = exercise ? muscleNames(config, exercise, 'secondary') : '—';
    if (primary !== '—') {
      for (const m of primary.split('、')) muscles.createSpan({ text: m, cls: 'workout-tag workout-tag-primary' });
    }
    if (secondary !== '—') {
      for (const m of secondary.split('、')) muscles.createSpan({ text: m, cls: 'workout-tag workout-tag-secondary' });
    }
  }
}

// 取出某训练项在指定角色（primary/secondary）下配置的肌肉显示名，用"、"连接；无则 "—"。
function muscleNames(
  config: WorkoutConfig,
  exercise: { muscles?: { muscleId: string; role: 'primary' | 'secondary' }[] } | undefined,
  role: 'primary' | 'secondary'
): string {
  if (!exercise?.muscles || exercise.muscles.length === 0) return '—';
  const names = exercise.muscles
    .filter((m) => m.role === role)
    .map((m) => {
      const muscle = config.muscles.find((mm) => mm.id === m.muscleId);
      return muscle ? getMuscleName(muscle) : m.muscleId;
    });
  return names.length ? names.join('、') : '—';
}
