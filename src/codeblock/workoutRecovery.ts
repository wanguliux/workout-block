import { MarkdownPostProcessorContext, MarkdownRenderChild } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { Muscle, WorkoutConfig } from '../data/types';
import { t } from '../i18n';
import { getMuscleName } from '../data/display';
import {
  CurvePoint,
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
  type RecoveryStatus,
} from '../data/recovery';

/*
 * workoutRecovery.ts —— 把 ```workout-recovery 代码块渲染成「渐进恢复曲线」。
 *
 * 两种形态（可同时开）：
 *   - 折线图：横轴时间、纵轴肌肉状态（100 = 练到位时的完全恢复水平，下面那条点线是「运动前水平」）；
 *     训练日打点，今天画竖线 + 实心点；
 *   - 表格：肌肉 / 当前状态 / 状态 / 距上次训练 / 距恢复完成——直接回答「我现在练没练到位」。
 *
 * 状态分档（六个）：疲劳 → 恢复中 → 超量恢复（短窗口）→ 维持 → 消退 → 数据不足。
 * 「消退」＝太久没练，底子在下滑；这是长期账，靠 detrain* 三个参数控制，与急性疲劳/适应无关。
 *
 * 主体（muscle:）可以是单块肌肉名/ID，也可以是健身群名（胸部/腿…）。不写 muscle 且 view: table
 * 时列出全部肌肉，按状态从低到高排（最该歇的排最前）。
 *
 * 数据全部来自现成的 workout_logs.csv，不需要额外存储；曲线每次现算（纯函数），不落库。
 */

interface ParsedParams {
  muscle?: string;
  days?: number;
  /** 未来趋势天数：从今天起假设不再练，曲线往后推多少天（默认 15，0 = 不画） */
  forecast: number;
  view: 'chart' | 'table' | 'both';
  /** 曲线参数临时覆盖（试算用，不写回配置）：kf/tf/ka/ta */
  overrides: Partial<RecoveryParams>;
}

function parseParams(source: string): ParsedParams {
  const out: ParsedParams = { view: 'chart', overrides: {}, forecast: DEFAULT_FORECAST_DAYS };
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
    } else if (key === 'forecast') {
      const n = parseInt(value, 10);
      // 0 允许（= 不画未来段）；上限 180 免得把横轴拉成一条线
      if (Number.isFinite(n) && n >= 0 && n <= 180) out.forecast = n;
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
    renderHeader(container, subject.label, summary);
    if (!summary.hasData) {
      container.createDiv({ text: t('codeblock.recovery.noData'), cls: 'workout-hint' });
    } else {
      renderChart(container, subject.label, p, doses, params.days ?? 28, params.forecast, today, summary);
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
const PAD_L = 44; // 左侧留给纵轴刻度数字
const PAD_R = 14;
const PAD_T = 16;
const PAD_B = 34;
/** 未来趋势默认天数：把已经发生的账往后算（含「不练则底子继续消退」），不是预测你会怎么做 */
const DEFAULT_FORECAST_DAYS = 15;

function renderHeader(container: HTMLElement, label: string, summary: RecoverySummary): void {
  const header = container.createDiv();
  header.addClass('workout-recovery-header');
  header.createSpan({ text: label, cls: 'workout-recovery-title' });
  // 状态徽章直接摆在标题旁：不用读表格就知道这块肌肉现在处在哪个阶段
  header.createSpan({
    text: statusLabel(summary.status),
    cls: `workout-recovery-status ${statusClass(summary.status)}`,
  });
}

function renderChart(
  container: HTMLElement,
  label: string,
  p: RecoveryParams,
  doses: DoseEntry[],
  days: number,
  forecast: number,
  today: number,
  summary: RecoverySummary
): void {
  const from = today - days;
  const to = today + forecast;
  const pts = sampleCurve(p, doses, from, to, 0.25);

  // 纵轴：数据极值 + 练到位水平 + 运动前水平；上下各留余量，且刻度取整到步长，
  // 否则轴上会出现 85 / 100 / 107 这种「不成规律」的数，看着像错位。
  const states = pts.map((q) => q.state).concat([p.baseline, summary.floor]);
  const step = niceStep(Math.max(...states) - Math.min(...states));
  const lo = Math.floor((Math.min(...states) - 2) / step) * step;
  const hi = Math.ceil((Math.max(...states) + 2) / step) * step;
  const x = (t: number) => PAD_L + ((t - from) / Math.max(1e-6, to - from)) * (VIEW_W - PAD_L - PAD_R);
  const y = (s: number) => VIEW_H - PAD_B - ((s - lo) / Math.max(1, hi - lo)) * (VIEW_H - PAD_T - PAD_B);

  // 历史段（实线 + 面积）与未来段（虚线）分开画：未来那段是「假设从今天起不练」的推算，
  // 不能和已经发生的事实长得一样，否则看图的人分不清哪截是记录、哪截是推演。
  const toPath = (list: typeof pts): string =>
    list.map((q, i) => `${i ? 'L' : 'M'}${x(q.t).toFixed(1)},${y(q.state).toFixed(1)}`).join('');
  const past = pts.filter((q) => q.t <= today);
  const future = forecast > 0 ? pts.filter((q) => q.t >= today) : [];
  const linePast = toPath(past);
  const lineFuture = toPath(future);
  const area = past.length
    ? `${linePast}L${x(today).toFixed(1)},${y(lo).toFixed(1)}L${x(from).toFixed(1)},${y(lo).toFixed(1)}Z`
    : '';

  const parts: string[] = [];
  // 纵轴保留网格与刻度数字（用户要的是「曲线上不标数值」，不是「不要坐标轴」）。
  // 刻度按整齐步长分布，不再用数据极值，避免出现 85/107 这种读不出规律的数。
  for (let v = lo; v <= hi + 1e-9; v += step) {
    parts.push(
      `<line x1="${PAD_L}" y1="${y(v).toFixed(1)}" x2="${VIEW_W - PAD_R}" y2="${y(v).toFixed(1)}" stroke="currentColor" stroke-opacity="0.12"/>` +
        `<text x="${PAD_L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="workout-recovery-axis">${v}</text>`
    );
  }
  // 横轴：刻度间隔随窗口自适应（窗口越长间隔越大），否则拉长到 200 天时日期会糊成一团。
  // 以「每个标签至少 70 个 viewBox 单位」为下限挑步长，候选值取整周/整月，读起来才顺。
  const plotW = VIEW_W - PAD_L - PAD_R;
  const maxTicks = Math.max(2, Math.floor(plotW / 70));
  const rawStep = (to - from) / maxTicks;
  const dayStep = [7, 14, 30, 60, 90, 120, 180].find((v) => v >= rawStep) ?? Math.ceil(rawStep / 60) * 60;
  for (let d = Math.ceil(from / dayStep) * dayStep; d <= to; d += dayStep) {
    if (d < from) continue;
    parts.push(
      `<text x="${x(d).toFixed(1)}" y="${VIEW_H - PAD_B + 18}" text-anchor="middle" class="workout-recovery-axis">${fromDayNum(d).slice(5)}</text>`
    );
  }
  // 面积（只覆盖历史段）+ 运动前水平（黄色虚线，唯一参考线）+ 曲线
  if (area) parts.push(`<path d="${area}" fill="var(--interactive-accent)" fill-opacity="0.08"/>`);
  if (p.detrainDepth > 0) {
    parts.push(
      `<line x1="${PAD_L}" y1="${y(summary.floor).toFixed(1)}" x2="${VIEW_W - PAD_R}" y2="${y(summary.floor).toFixed(1)}" stroke="var(--color-yellow, #eab308)" stroke-opacity="0.85" stroke-width="1.6" stroke-dasharray="7 5"/>`
    );
  }
  if (linePast) {
    parts.push(
      `<path d="${linePast}" fill="none" stroke="var(--interactive-accent)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`
    );
  }
  if (lineFuture) {
    parts.push(
      `<path d="${lineFuture}" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-opacity="0.75" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round"/>`
    );
  }

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
    `<line x1="${x(today).toFixed(1)}" y1="${PAD_T}" x2="${x(today).toFixed(1)}" y2="${VIEW_H - PAD_B}" stroke="currentColor" stroke-opacity="0.4" stroke-dasharray="4 3">` +
      `<title>${t('codeblock.recovery.todayLine', { n: String(forecast) })}</title></line>`
  );
  parts.push(
    `<circle cx="${x(today).toFixed(1)}" cy="${y(summary.state).toFixed(1)}" r="4.6" fill="var(--interactive-accent)">` +
      `<title>${t('codeblock.recovery.todayState', { v: summary.state.toFixed(1) })}</title></circle>`
  );

  // 十字准线（默认隐藏）：最近采样点为十字中心，旁边浮一个日期气泡。
  // 放在最后画，保证压在曲线之上。
  parts.push(
    `<g class="workout-recovery-crosshair" style="display:none">` +
      `<line class="ch-v" stroke="currentColor" stroke-opacity="0.45" stroke-dasharray="3 3" y1="${PAD_T}" y2="${VIEW_H - PAD_B}"/>` +
      `<line class="ch-h" stroke="currentColor" stroke-opacity="0.45" stroke-dasharray="3 3" x1="${PAD_L}" x2="${VIEW_W - PAD_R}"/>` +
      `<circle class="ch-dot" r="4" fill="var(--interactive-accent)" stroke="var(--background-primary)" stroke-width="1.5"/>` +
      `<g class="ch-tip">` +
      `<rect class="ch-tip-bg" rx="4" ry="4" height="18" fill="rgba(0,0,0,0.82)"/>` +
      `<text class="ch-tip-text" font-size="11" fill="#fff" dominant-baseline="middle"></text>` +
      `</g>` +
      `</g>`
  );

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
  svg.setAttribute('class', 'workout-recovery-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.innerHTML = parts.join('');
  container.appendChild(svg);

  bindCrosshair(svg, pts, { from, to, today, x, y });

  const legend = container.createDiv();
  legend.addClass('workout-recovery-legend');
  legend.createSpan({ text: t('codeblock.recovery.legendCurve'), cls: 'workout-recovery-legend-item' });
  if (p.detrainDepth > 0) {
    legend.createSpan({ text: t('codeblock.recovery.legendFloor'), cls: 'workout-recovery-legend-item is-floor' });
  }
  legend.createSpan({ text: t('codeblock.recovery.legendToday'), cls: 'workout-recovery-legend-item is-today' });
  if (forecast > 0) {
    legend.createSpan({
      text: t('codeblock.recovery.legendForecast', { n: String(forecast) }),
      cls: 'workout-recovery-legend-item is-forecast',
    });
  }
}

/** 纵轴刻度步长：按跨度取 2 / 5 / 10，保证刻度是整数且数量不过密。 */
function niceStep(span: number): number {
  // 250px 高的图最多放 6~7 条网格线；再密就变成条纹背景，读不出曲线
  if (span <= 10) return 2;
  if (span <= 25) return 5;
  if (span <= 60) return 10;
  if (span <= 150) return 20;
  return 50;
}

interface CrosshairGeom {
  from: number;
  to: number;
  today: number;
  x: (t: number) => number;
  y: (s: number) => number;
}

/**
 * 十字准线：鼠标移动时吸附到最近的采样点，画横竖两条虚线 + 中心点，
 * 并在中心旁浮一个日期气泡。移动端按 pointer 事件同样可用（手指按住拖动）。
 */
function bindCrosshair(svg: SVGSVGElement, pts: CurvePoint[], geom: CrosshairGeom): void {
  const group = svg.querySelector<SVGGElement>('.workout-recovery-crosshair');
  if (!group) return;
  const vLine = group.querySelector<SVGLineElement>('.ch-v')!;
  const hLine = group.querySelector<SVGLineElement>('.ch-h')!;
  const dot = group.querySelector<SVGCircleElement>('.ch-dot')!;
  const tip = group.querySelector<SVGGElement>('.ch-tip')!;
  const tipBg = group.querySelector<SVGRectElement>('.ch-tip-bg')!;
  const tipText = group.querySelector<SVGTextElement>('.ch-tip-text')!;

  const hide = (): void => {
    group.setCssStyles({ display: 'none' });
  };

  const show = (ev: PointerEvent): void => {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    // 屏幕坐标 → viewBox 坐标（SVG 用 viewBox 等比缩放，必须按宽度换算）
    const vx = ((ev.clientX - rect.left) / rect.width) * VIEW_W;
    if (vx < PAD_L || vx > VIEW_W - PAD_R) {
      hide();
      return;
    }
    const t = geom.from + ((vx - PAD_L) / (VIEW_W - PAD_L - PAD_R)) * (geom.to - geom.from);
    // 吸附到最近采样点：十字永远落在曲线上，而不是悬在空白处
    let best = pts[0];
    let bestD = Infinity;
    for (const q of pts) {
      const d = Math.abs(q.t - t);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    const cx = geom.x(best.t);
    const cy = geom.y(best.state);

    vLine.setAttribute('x1', String(cx));
    vLine.setAttribute('x2', String(cx));
    hLine.setAttribute('y1', String(cy));
    hLine.setAttribute('y2', String(cy));
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', String(cy));

    // 气泡：默认放在中心右上，靠右边界时翻到左侧，避免被裁掉
    const text = fromDayNum(best.t);
    tipText.textContent = text;
    const padX = 6;
    const textW = text.length * 6.2 + padX * 2;
    const flip = cx + textW + 10 > VIEW_W - PAD_R;
    const bx = flip ? cx - textW - 8 : cx + 8;
    const by = Math.max(PAD_T, cy - 26);
    tipBg.setAttribute('x', String(bx));
    tipBg.setAttribute('y', String(by));
    tipBg.setAttribute('width', String(textW));
    tipText.setAttribute('x', String(bx + padX));
    tipText.setAttribute('y', String(by + 9));
    void tip;

    group.setCssStyles({ display: '' });
  };

  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
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
  for (const key of ['muscle', 'state', 'status', 'gap', 'eta'] as const) {
    hr.createEl('th', { text: t(`codeblock.recovery.col.${key}`) });
  }

  const tbody = table.createEl('tbody');
  for (const row of rows) {
    const tr = tbody.createEl('tr');
    tr.createEl('td', { text: row.label });
    tr.createEl('td', { text: row.summary.hasData ? String(Math.round(row.summary.state)) : '—', cls: 'is-num' });
    const statusCell = tr.createEl('td');
    statusCell.createSpan({
      text: statusLabel(row.summary.status),
      cls: `workout-recovery-status ${statusClass(row.summary.status)}`,
    });
    tr.createEl('td', {
      text:
        row.summary.gapDays === null
          ? '—'
          : t('codeblock.recovery.gapDays', { n: String(Math.round(row.summary.gapDays)) }),
      cls: 'is-num',
    });
    // 横线（—）原来不解释就没人懂：已恢复 / 正在消退 / 没有记录，三种情况分别写清楚
    let etaText: string;
    if (!row.summary.hasData) etaText = '—';
    else if (row.summary.etaDays !== null) etaText = t('codeblock.recovery.etaDays', { n: row.summary.etaDays.toFixed(1) });
    else if (row.summary.status === 'declining') etaText = t('codeblock.recovery.etaDeclining');
    else etaText = t('codeblock.recovery.etaDone');
    tr.createEl('td', { text: etaText, cls: 'is-num' });
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

/** 六个状态的中文/英文标签（分档逻辑在 data/recovery.ts 的 statusAt，这里只负责翻译）。 */
const STATUS_LABEL_KEY: Record<RecoveryStatus, string> = {
  noData: 'codeblock.recovery.statusNoData',
  fatigue: 'codeblock.recovery.statusFatigue',
  recovering: 'codeblock.recovery.statusRecovering',
  supercomp: 'codeblock.recovery.statusSurplus',
  maintain: 'codeblock.recovery.statusMaintain',
  declining: 'codeblock.recovery.statusDeclining',
};

/** 状态 → 样式类（is-na / is-fatigue / is-recovering / is-surplus / is-maintain / is-declining）。 */
const STATUS_CLASS: Record<RecoveryStatus, string> = {
  noData: 'is-na',
  fatigue: 'is-fatigue',
  recovering: 'is-recovering',
  supercomp: 'is-surplus',
  maintain: 'is-maintain',
  declining: 'is-declining',
};

function statusLabel(status: RecoveryStatus): string {
  return t(STATUS_LABEL_KEY[status]);
}

function statusClass(status: RecoveryStatus): string {
  return STATUS_CLASS[status];
}

function todayStr(): string {
  const n = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}
