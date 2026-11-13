import { MarkdownPostProcessorContext, MarkdownRenderChild } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { Muscle, WorkoutConfig } from '../data/types';
import { t } from '../i18n';
import { getMuscleName } from '../data/display';
import {
  DEFAULT_RECOVERY_PARAMS,
  DoseEntry,
  RecoveryParams,
  RecoverySummary,
  collectDoses,
  fromDayNum,
  paramsForSubject,
  recoverySummary,
  resolveSubject,
  sampleCurve,
  stateAt,
  toDayNum,
} from '../data/recovery';

/*
 * workoutRecovery.ts —— 把 ```workout-recovery 代码块渲染成「渐进恢复曲线」。
 *
 * 两种形态（可同时开）：
 *   - 折线图：横轴时间、纵轴肌肉状态（100 = 完全恢复）；训练日打点，今天画竖线 + 实心点；
 *   - 表格：肌肉 / 当前状态 / 状态 / 距恢复完成——直接回答「我现在能不能练」。
 *
 * 主体（muscle:）可以是单块肌肉名/ID，也可以是健身群名（胸部/腿…）。不写 muscle 且 view: table
 * 时列出全部肌肉，按状态从低到高排（最该歇的排最前）。
 *
 * 数据全部来自现成的 workout_logs.csv，不需要额外存储；曲线每次现算（纯函数），不落库。
 */

interface ParsedParams {
  muscle?: string;
  days?: number;
  view: 'chart' | 'table' | 'both';
  /** 曲线参数临时覆盖（试算用，不写回配置）：kf/tf/ka/ta */
  overrides: Partial<RecoveryParams>;
}

function parseParams(source: string): ParsedParams {
  const out: ParsedParams = { view: 'chart', overrides: {} };
  // 参数覆盖的取值范围：超界直接忽略（宁可当没写，也不让一个手滑把曲线算成直线）
  const limits: Record<string, [number, number, keyof RecoveryParams]> = {
    kf: [0.1, 20, 'fatiguePerSet'],
    tf: [0.5, 14, 'fatigueTau'],
    ka: [0, 10, 'fitnessPerSet'],
    ta: [3, 90, 'fitnessTau'],
  };
  for (const line of source.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!value) continue;
    if (key === 'muscle') out.muscle = value;
    else if (key === 'days') {
      const n = parseInt(value, 10);
      if (Number.isFinite(n) && n >= 7 && n <= 365) out.days = n;
    } else if (key === 'view') {
      out.view = value === 'table' ? 'table' : value === 'both' ? 'both' : 'chart';
    } else if (key in limits) {
      const [min, max, field] = limits[key];
      const n = parseFloat(value);
      if (Number.isFinite(n) && n >= min && n <= max) {
        (out.overrides as Record<string, number>)[field] = n;
      }
    }
  }
  return out;
}

/** 渲染过的代码块：靠它挂 MarkdownRenderChild，块被卸载时能干净回收。 */
const registeredComponents = new WeakMap<HTMLElement, boolean>();

export async function renderWorkoutRecovery(
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  dataManager: DataManager
): Promise<void> {
  if (!registeredComponents.has(el)) {
    const child = new MarkdownRenderChild(el);
    child.onunload = () => registeredComponents.delete(el);
    ctx.addChild(child);
    registeredComponents.set(el, true);
  }

  const params = parseParams(source);
  const config = await dataManager.getConfig();
  const logs = dataManager.getLogs();
  const container = el.createDiv();
  container.addClass('workout-recovery');
  const today = toDayNum(todayStr());

  // 没写 muscle：只有 table 视图有意义（列全部肌肉），否则提示补参数
  if (!params.muscle) {
    if (params.view === 'table') {
      renderAllMusclesTable(container, config, logs, today);
    } else {
      container.createDiv({ text: t('codeblock.recovery.needMuscle'), cls: 'workout-hint' });
    }
    return;
  }

  const subject = resolveSubject(config, params.muscle);
  if (subject.muscleIds.length === 0) {
    container.createDiv({ text: t('codeblock.recovery.unknownMuscle', { name: params.muscle }), cls: 'workout-hint' });
    return;
  }

  const doses = collectDoses(logs, config.exercises, subject.muscleIds);
  const p = { ...paramsForSubject(config, subject.muscleIds, DEFAULT_RECOVERY_PARAMS), ...params.overrides };
  const summary = recoverySummary(p, doses, today);

  if (params.view !== 'table') {
    renderHeader(container, subject.label);
    if (!summary.hasData) {
      container.createDiv({ text: t('codeblock.recovery.noData'), cls: 'workout-hint' });
    } else {
      renderChart(container, subject.label, p, doses, params.days ?? 28, today, summary);
    }
  }
  if (params.view === 'table' || params.view === 'both') {
    renderTable(container, [
      { label: subject.label, muscleIds: subject.muscleIds, doses, params: p, summary },
    ]);
  }
}

// ─────────────────────────── 折线图 ───────────────────────────

const VIEW_W = 690;
const VIEW_H = 250;
const PAD_L = 44;
const PAD_R = 14;
const PAD_T = 16;
const PAD_B = 34;
const FORECAST_DAYS = 7; // 未来段只是把已发生的账往后算，不是预测

function renderHeader(container: HTMLElement, label: string): void {
  const header = container.createDiv();
  header.addClass('workout-recovery-header');
  header.createSpan({ text: label, cls: 'workout-recovery-title' });
  void label;
}

function renderChart(
  container: HTMLElement,
  label: string,
  p: RecoveryParams,
  doses: DoseEntry[],
  days: number,
  today: number,
  summary: RecoverySummary
): void {
  const from = today - days;
  const to = today + FORECAST_DAYS;
  const pts = sampleCurve(p, doses, from, to, 0.25);

  // 纵轴：数据极值 + 基线，各留 2 点余量，避免曲线贴边
  const states = pts.map((q) => q.state).concat([p.baseline]);
  const lo = Math.floor(Math.min(...states)) - 2;
  const hi = Math.ceil(Math.max(...states)) + 2;
  const x = (day: number) => PAD_L + ((day - from) / Math.max(1, to - from)) * (VIEW_W - PAD_L - PAD_R);
  const y = (s: number) => VIEW_H - PAD_B - ((s - lo) / Math.max(1, hi - lo)) * (VIEW_H - PAD_T - PAD_B);

  const line = pts
    .map((q, i) => `${i ? 'L' : 'M'}${x(toDayNum(q.day)).toFixed(1)},${y(q.state).toFixed(1)}`)
    .join('');
  const area = `${line}L${x(to).toFixed(1)},${y(lo).toFixed(1)}L${x(from).toFixed(1)},${y(lo).toFixed(1)}Z`;

  const parts: string[] = [];
  // 纵轴网格 + 刻度
  for (const v of [lo, p.baseline, hi]) {
    parts.push(
      `<line x1="${PAD_L}" y1="${y(v).toFixed(1)}" x2="${VIEW_W - PAD_R}" y2="${y(v).toFixed(1)}" stroke="currentColor" stroke-opacity="0.12"/>` +
        `<text x="${PAD_L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="workout-recovery-axis">${v}</text>`
    );
  }
  // 横轴：每 7 天一个刻度
  for (let d = Math.ceil(from); d <= to; d += 7) {
    parts.push(
      `<text x="${x(d).toFixed(1)}" y="${VIEW_H - PAD_B + 18}" text-anchor="middle" class="workout-recovery-axis">${fromDayNum(d).slice(5)}</text>`
    );
  }
  // 面积 + 基线 + 曲线
  parts.push(`<path d="${area}" fill="var(--interactive-accent)" fill-opacity="0.08"/>`);
  parts.push(
    `<line x1="${PAD_L}" y1="${y(p.baseline).toFixed(1)}" x2="${VIEW_W - PAD_R}" y2="${y(p.baseline).toFixed(1)}" stroke="currentColor" stroke-opacity="0.35" stroke-dasharray="6 4"/>`
  );
  parts.push(
    `<path d="${line}" fill="none" stroke="var(--interactive-accent)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`
  );

  // 训练日：曲线上的点 + 原生 <title> 提示（桌面悬停、移动端长按都能看）
  for (const d of doses) {
    const day = toDayNum(d.day);
    if (day < from || day > to) continue;
    const s = stateAt(p, doses, day);
    parts.push(
      `<circle cx="${x(day).toFixed(1)}" cy="${y(s).toFixed(1)}" r="3.2" fill="var(--background-primary)" stroke="var(--interactive-accent)" stroke-width="2">` +
        `<title>${t('codeblock.recovery.trainingDay', { day: d.day, n: String(d.dose), v: s.toFixed(1) })}</title></circle>`
    );
  }

  // 今天：竖线 + 实心点 + 数值——用户要的就是「我现在在哪个点位」
  parts.push(
    `<line x1="${x(today).toFixed(1)}" y1="${PAD_T}" x2="${x(today).toFixed(1)}" y2="${VIEW_H - PAD_B}" stroke="currentColor" stroke-opacity="0.4" stroke-dasharray="4 3"/>`
  );
  parts.push(
    `<circle cx="${x(today).toFixed(1)}" cy="${y(summary.state).toFixed(1)}" r="4.6" fill="var(--interactive-accent)">` +
      `<title>${t('codeblock.recovery.todayState', { v: summary.state.toFixed(1) })}</title></circle>`
  );
  parts.push(
    `<text x="${x(today).toFixed(1)}" y="${(y(summary.state) - 10).toFixed(1)}" text-anchor="middle" class="workout-recovery-today-label">${Math.round(summary.state)}</text>`
  );

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
  svg.setAttribute('class', 'workout-recovery-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.innerHTML = parts.join('');
  container.appendChild(svg);

  const legend = container.createDiv();
  legend.addClass('workout-recovery-legend');
  legend.createSpan({ text: t('codeblock.recovery.legendCurve'), cls: 'workout-recovery-legend-item' });
  legend.createSpan({ text: t('codeblock.recovery.legendBaseline'), cls: 'workout-recovery-legend-item is-dashed' });
  legend.createSpan({ text: t('codeblock.recovery.legendToday'), cls: 'workout-recovery-legend-item is-today' });
}

// ─────────────────────────── 表格 ───────────────────────────

interface TableRow {
  label: string;
  muscleIds: string[];
  doses: DoseEntry[];
  params: RecoveryParams;
  summary: RecoverySummary;
}

function renderTable(container: HTMLElement, rows: TableRow[]): void {
  const wrap = container.createDiv();
  wrap.addClass('workout-recovery-table-wrap');
  const table = wrap.createEl('table');
  table.addClass('workout-recovery-table');

  const hr = table.createEl('thead').createEl('tr');
  for (const key of ['muscle', 'state', 'status', 'eta'] as const) {
    hr.createEl('th', { text: t(`codeblock.recovery.col.${key}`) });
  }

  const tbody = table.createEl('tbody');
  for (const row of rows) {
    const tr = tbody.createEl('tr');
    tr.createEl('td', { text: row.label });
    tr.createEl('td', { text: row.summary.hasData ? String(Math.round(row.summary.state)) : '—', cls: 'is-num' });
    const statusCell = tr.createEl('td');
    statusCell.createSpan({
      text: statusLabel(row.summary),
      cls: `workout-recovery-status ${statusClass(row.summary)}`,
    });
    tr.createEl('td', {
      text: row.summary.etaDays === null ? '—' : t('codeblock.recovery.etaDays', { n: row.summary.etaDays.toFixed(1) }),
      cls: 'is-num',
    });
  }
}

/** 没写 muscle 的表格视图：列全部肌肉，最该歇的排最前。 */
function renderAllMusclesTable(container: HTMLElement, config: WorkoutConfig, logs: ReturnType<DataManager['getLogs']>, today: number): void {
  const rows: TableRow[] = config.muscles.map((m: Muscle) => {
    const label = getMuscleName(m);
    const doses = collectDoses(logs, config.exercises, [m.id]);
    const p = paramsForSubject(config, [m.id], DEFAULT_RECOVERY_PARAMS);
    return { label, muscleIds: [m.id], doses, params: p, summary: recoverySummary(p, doses, today) };
  });
  // 有数据的排前面，状态从低到高（谁最需要休息谁在最上）
  rows.sort((a, b) => {
    if (a.summary.hasData !== b.summary.hasData) return a.summary.hasData ? -1 : 1;
    return a.summary.state - b.summary.state;
  });
  renderTable(container, rows);
}

// ─────────────────────────── 文案 ───────────────────────────

function statusLabel(sum: RecoverySummary): string {
  if (!sum.hasData) return t('codeblock.recovery.statusNoData');
  if (sum.state < 94) return t('codeblock.recovery.statusFatigue');
  if (sum.state < 100) return t('codeblock.recovery.statusRecovering');
  return t('codeblock.recovery.statusSurplus');
}

function statusClass(sum: RecoverySummary): string {
  if (!sum.hasData) return 'is-na';
  if (sum.state < 94) return 'is-fatigue';
  if (sum.state < 100) return 'is-recovering';
  return 'is-surplus';
}

function todayStr(): string {
  const n = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}
