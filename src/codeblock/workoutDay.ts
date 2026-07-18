import { App, MarkdownPostProcessorContext, MarkdownRenderChild, Notice, TFile } from 'obsidian';
import { LogRow, WorkoutConfig } from '../data/types';
import { t } from '../i18n';
import { computeStat, formatStatValue } from '../data/statExpr';
import { getExerciseName, getMuscleName, resolveLogExerciseName } from '../data/display';
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
    const [key, value] = line.split(':').map((s) => s.trim());
    if (!key || value === undefined) continue;
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
    const content = await app.vault.read(file);
    const lines = content.split('\n');
    let found = false;
    // 在代码块体内（开围栏之后、闭围栏之前）查找是否已有 day: 行
    for (let i = info.lineStart + 1; i < info.lineEnd; i++) {
      if (/^\s*day\s*:/.test(lines[i])) {
        lines[i] = `day: ${today}`;
        found = true;
        break;
      }
    }
    // 没有就插在闭围栏之前
    if (!found) {
      lines.splice(info.lineEnd, 0, `day: ${today}`);
    }
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

  // 画表格
  const table = container.createEl('table');
  table.addClass('workout-day-table');

  const thead = table.createEl('thead');
  const headerRow = thead.createEl('tr');
  headerRow.createEl('th', { text: t('codeblock.day.project') });
  headerRow.createEl('th', { text: t('codeblock.day.statValue') });
  headerRow.createEl('th', { text: t('codeblock.day.primaryMuscles') });
  headerRow.createEl('th', { text: t('codeblock.day.secondaryMuscles') });
  headerRow.createEl('th', { text: t('codeblock.day.plan') });

  const tbody = table.createEl('tbody');
  for (const group of sortedGroups) {
    const row = tbody.createEl('tr');

    // 1) 项目名：优先用配置里的训练项对象拿显示名，否则回退到日志解析名
    const exercise = group.exerciseId ? config.exercises.find((e) => e.id === group.exerciseId) : undefined;
    const name = exercise
      ? getExerciseName(exercise)
      : (resolveLogExerciseName(config, group.logs[0]) || t('codeblock.day.unknown'));
    row.createEl('td', { text: name });

    // 2) 数据统计值：该训练项所属类型下、已启用的统计条目（多条合并一格）。
    const matchedStats = (config.statistics ?? []).filter(
      (s) => s.enabled && s.associatedTypes.includes(group.category)
    );
    const statText = matchedStats.length
      ? matchedStats.map((s) => `${s.name}: ${formatStatValue(computeStat(s, group.logs))}`).join('　|　')
      : '—';
    row.createEl('td', { text: statText });

    // 3) 主肌群 / 4) 辅助肌群：取自训练项配置的 muscles（primary / secondary）
    row.createEl('td', { text: muscleNames(config, exercise, 'primary') });
    row.createEl('td', { text: muscleNames(config, exercise, 'secondary') });

    // 5) 训练方案：该训练项当日记录的 plan 字段（去重合并；无则显示占位）
    const plans = Array.from(
      new Set(group.logs.map((l) => l.plan).filter((p): p is string => typeof p === 'string' && p.length > 0))
    );
    row.createEl('td', { text: plans.length ? plans.join('、') : '—' });
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
