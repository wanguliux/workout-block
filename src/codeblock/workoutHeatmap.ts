import { MarkdownPostProcessorContext, MarkdownRenderChild } from 'obsidian';
import { HeatmapLevel, LogRow, Muscle, StatDef, WorkoutConfig } from '../data/types';
import { buildExerciseMuscleMap, computeMuscleValue } from '../data/muscleStats';
import { GROWTH_SCALE, computeGrowthRatio } from '../data/muscleGrowth';
import { DEFAULT_RECOVERY_PARAMS, collectDoses, paramsForSubject, recoverySummary, toDayNum } from '../data/recovery';
import {
  formatSvgMuscleLabel,
  HIDDEN_SVG_GROUP_IDS,
  SvgMuscleEntry,
  SVG_MUSCLE_CATALOG,
} from '../data/svgMuscleCatalog';
import { registerRenderedBlock, unregisterRenderedBlock } from './registry';
import { getLocale, t } from '../i18n';
import frontSvg from '../assets/muscle_layer_front.svg';
import backSvg from '../assets/muscle_layer_back.svg';
import { DEFAULT_HEATMAP_SCALE, colorToCss } from '../data/heatmapDefaults';

/* workoutHeatmap.ts —— 把 ```workout-heatmap 代码块渲染成全身肌肉热力图。
 * 精细度自动跟随肌肉管理里的 svgRegionIds 配置；支持正/背切换、指标与时间窗参数。 */

interface HeatmapParams {
  metric?: string;
  range?: string;
  /** 视图：recovery＝练了多少/还有多久恢复；growth＝跟自己比练得够不够 */
  view?: 'recovery' | 'growth';
}

function parseParams(source: string): HeatmapParams {
  const params: HeatmapParams = {};
  for (const line of source.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (!key || !value) continue;
    if (key === 'metric') params.metric = value;
    if (key === 'range') params.range = value;
    if (key === 'view') params.view = value === 'growth' ? 'growth' : 'recovery';
  }
  return params;
}

// 静态 SVG 解析缓存：frontSvg / backSvg 是固定字符串（约 320KB），每次重渲染都 innerHTML 解析
// 会在主线程做昂贵的 HTML 词法分析。改为「模块内只解析一次、之后 cloneNode 复用」，重渲染代价
// 从「解析 640KB」降为「克隆已解析的 DOM」，对删除记录等高频数据变化意义极大（否则删除即卡顿）。
// 缓存的是 <svg> 元素本身，cloneNode 后直接挂到容器下，渲染出的 DOM 结构与原来一致。
let parsedFrontSvg: SVGElement | null = null;
let parsedBackSvg: SVGElement | null = null;
function parseSvgMarkup(markup: string): SVGElement {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  return doc.documentElement as unknown as SVGElement;
}
function getMuscleSvg(side: 'front' | 'back'): SVGElement {
  if (side === 'front') {
    if (!parsedFrontSvg) parsedFrontSvg = parseSvgMarkup(frontSvg);
    return parsedFrontSvg;
  }
  if (!parsedBackSvg) parsedBackSvg = parseSvgMarkup(backSvg);
  return parsedBackSvg;
}

// —— 肌肉悬停提示（自定义黑框气泡，即时显示）——
// 页面级单例气泡 + 事件委托到容器：进入肌肉即显示、跟随鼠标、移出即隐藏，零延迟。
// 背景硬编码深色（不依赖主题变量），避免某些主题下渲染成白框；同时不注入 SVG 原生
// <title>（Windows 下原生提示是白底系统框，会与黑框重复），由本气泡统一承担。
let heatmapTooltipEl: HTMLElement | null = null;
function ensureHeatmapTooltip(): HTMLElement {
  if (heatmapTooltipEl && document.body.contains(heatmapTooltipEl)) return heatmapTooltipEl;
  // 插件重载后模块级变量会重置，但旧的提示节点还挂在 body 上——不清掉就会累积多个同 id 气泡，
  // 而 document.getElementById 取第一个（已废弃的那个），表现为「鼠标悬停完全没反应」。
  document.querySelectorAll('.workout-heatmap-tooltip').forEach((n) => n.remove());
  const tip = document.body.createDiv();
  tip.id = 'workout-heatmap-tooltip';
  tip.addClass('workout-heatmap-tooltip');
  tip.setCssStyles({ display: 'none' });
  document.body.appendChild(tip);
  heatmapTooltipEl = tip;
  return tip;
}

function bindMuscleTooltips(wrap: HTMLElement, side: 'front' | 'back', extra?: Map<string, string>): void {
  const tip = ensureHeatmapTooltip();

  const entryFor = (target: EventTarget | null): SvgMuscleEntry | null => {
    let el: Element | null = target as Element | null;
    while (el && el !== wrap) {
      const id = el.getAttribute('id');
      if (id) {
        const entry = SVG_MUSCLE_CATALOG.find((e) => e.id === id && e.side === side);
        if (entry) return entry;
      }
      el = el.parentElement;
    }
    return null;
  };

  const locate = (me: MouseEvent) => {
    // 光标跟随定位：用 Obsidian 扩展的 setCssStyles 设置，避免 el.style.* 直接赋值
    // （obsidianmd/no-static-styles-assignment）。
    tip.setCssStyles({
      left: `${me.clientX + 12}px`,
      top: `${me.clientY + 12}px`,
    });
  };

  // 进入肌肉即时显示（无延迟）；在肌肉间移动直接换名；移出隐藏。
  wrap.addEventListener('mouseover', (ev: Event) => {
    const entry = entryFor(ev.target);
    if (!entry) return;
    const me = ev as MouseEvent;
    // 第一行肌肉名，第二行按当前视图追加（恢复：N 天 / 练度配比 X%）
    tip.textContent = formatSvgMuscleLabel(entry, getLocale());
    const extraText = extra?.get(side + ':' + entry.id);
    if (extraText) tip.createDiv({ text: extraText, cls: 'workout-heatmap-tooltip-sub' });
    tip.setCssStyles({ display: 'block' });
    locate(me);
  });
  wrap.addEventListener('mousemove', (ev: Event) => {
    if (tip.style.display === 'block') locate(ev as MouseEvent);
  });
  wrap.addEventListener('mouseleave', () => {
    tip.setCssStyles({ display: 'none' });
  });
}

/** 本地当天日期（YYYY-MM-DD）。 */
function todayDateStr(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function resolveDefaultMetric(config: WorkoutConfig): StatDef | undefined {
  return config.statistics.find((s) => s.heatmapDefault) ?? config.statistics.find((s) => s.id === 'count');
}

function resolveMetric(config: WorkoutConfig, nameOrId?: string): StatDef | undefined {
  if (!nameOrId) return resolveDefaultMetric(config);
  const lower = nameOrId.toLowerCase();
  return config.statistics.find((s) => s.id.toLowerCase() === lower || s.name.toLowerCase() === lower);
}

function resolveRange(muscle: Muscle, codeRange?: string): string {
  if (muscle.heatmapRange) return muscle.heatmapRange;
  if (codeRange) return codeRange;
  return '7d';
}

function resolveMetricId(config: WorkoutConfig, muscle: Muscle, codeMetric?: string): StatDef | undefined {
  if (muscle.heatmapMetric) return resolveMetric(config, muscle.heatmapMetric);
  if (codeMetric) return resolveMetric(config, codeMetric);
  return resolveDefaultMetric(config);
}

function colorForValue(value: number, scale?: HeatmapLevel[]): string {
  const levels = scale && scale.length > 0 ? scale : DEFAULT_HEATMAP_SCALE;
  // 按阈值升序：值 ≤ 某档阈值即取该色；超过所有阈值则取最高档（最重）。
  const sorted = [...levels].sort((a, b) => (a.max ?? Infinity) - (b.max ?? Infinity));
  for (const level of sorted) {
    if (value <= (level.max ?? Infinity)) return level.color;
  }
  return sorted[sorted.length - 1]?.color ?? '#ef4444';
}

const registeredComponents = new WeakMap<HTMLElement, boolean>();
// 记录每个热力图代码块对应的 IntersectionObserver，便于重渲染/卸载时断开，避免泄漏与重复计算。
const heatmapObservers = new WeakMap<HTMLElement, IntersectionObserver>();

export async function renderWorkoutHeatmap(
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  logs: LogRow[],
  config: WorkoutConfig
): Promise<void> {
  if (!registeredComponents.has(el)) {
    const child = new MarkdownRenderChild(el);
    child.onunload = () => {
      unregisterRenderedBlock(el);
      const ob = heatmapObservers.get(el);
      if (ob) ob.disconnect();
      heatmapObservers.delete(el);
      registeredComponents.delete(el);
    };
    ctx.addChild(child);
    registeredComponents.set(el, true);
    registerRenderedBlock(el, 'workout-heatmap', source, ctx);
  }

  const params = parseParams(source);
  const defaultMetric = resolveDefaultMetric(config);
  const metric = params.metric ? resolveMetric(config, params.metric) : defaultMetric;
  const codeRange = params.range;

  // 无映射兜底：所有肌肉都没有配置 svgRegionIds 时，渲染再多样也上不了色，
  // 直接给用户一条可操作的提示，避免「有数据但热力图一片空白」的困惑。
  const hasAnyMapping = config.muscles.some((m) => (m.svgRegionIds?.length ?? 0) > 0);
  if (!hasAnyMapping) {
    const container = el.createDiv({ cls: 'workout-heatmap-container' });
    container.createDiv({ text: t('codeblock.heatmap.noMapping'), cls: 'workout-heatmap-empty' });
    return;
  }

  const container = el.createDiv();
  container.addClass('workout-heatmap-container');

  // 头部：正/背切换 + 视图切换（恢复 / 发展）+ 图例
  const header = container.createDiv();
  header.addClass('workout-heatmap-header');

  const sideSwitch = header.createDiv();
  sideSwitch.addClass('workout-heatmap-switch');
  const frontBtn = sideSwitch.createEl('button', { text: t('modal.muscleManager.front') });
  const backBtn = sideSwitch.createEl('button', { text: t('modal.muscleManager.back') });
  frontBtn.addClass('mod-cta');

  // 恢复视图＝练了多少 + 还有多久恢复（绝对量，回答「现在能不能练」）
  // 发展视图＝近 4 周练度相对自己 12 周中位数的比值（相对量，回答「练得够不够 / 偏不偏」）
  const modeSwitch = header.createDiv();
  modeSwitch.addClass('workout-heatmap-switch');
  const recoveryBtn = modeSwitch.createEl('button', { text: t('codeblock.heatmap.viewRecovery') });
  const growthBtn = modeSwitch.createEl('button', { text: t('codeblock.heatmap.viewGrowth') });
  let mode: 'recovery' | 'growth' = params.view ?? 'recovery';

  const info = header.createDiv();
  info.addClass('workout-heatmap-info');
  const legend = header.createDiv();
  legend.addClass('workout-heatmap-legend');

  function renderInfo(): void {
    info.empty();
    if (mode === 'recovery') {
      const metricName = metric?.name ?? t('modal.muscleManager.followDefaultMetric');
      info.createSpan({ text: `${t('modal.muscleManager.heatmapMetric')}: ${metricName}` });
      info.createSpan({ text: `${t('modal.muscleManager.heatmapRange')}: ${codeRange ?? '7d'}` });
    }
    // 发展视图不显示说明行：图例已经用百分数标清了色义，再挂一行解释纯属噪音
    info.setCssStyles({ display: mode === 'recovery' ? '' : 'none' });
  }

  function renderLegend(): void {
    legend.empty();
    if (mode === 'recovery') {
      // 阈值逐肌可配，单一图例无法呈现各肌不同刻度，故图例仅展示 4 色由轻→重，
      // 具体阈值在各肌肉编辑页查看。
      legend.createSpan({ text: t('codeblock.heatmap.legendLow'), cls: 'workout-heatmap-legend-end' });
      const scale = [...DEFAULT_HEATMAP_SCALE].sort((a, b) => (a.max ?? Infinity) - (b.max ?? Infinity));
      for (const level of scale) {
        const item = legend.createDiv();
        item.addClass('workout-heatmap-legend-item');
        item.createSpan().setCssStyles({
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          background: colorToCss(level.color),
        });
      }
      legend.createSpan({ text: t('codeblock.heatmap.legendHigh'), cls: 'workout-heatmap-legend-end' });
      return;
    }
    // 发展视图：分档是比值，必须标百分数；色块用方块，与恢复视图的圆点在形状上也区分开
    legend.createSpan({ text: t('codeblock.heatmap.legendLess'), cls: 'workout-heatmap-legend-end' });
    GROWTH_SCALE.forEach((level, i) => {
      const lo = i === 0 ? 0 : GROWTH_SCALE[i - 1].max;
      const hi = level.max;
      const label = Number.isFinite(hi)
        ? i === 0
          ? `<${Math.round(hi * 100)}%`
          : `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`
        : `>${Math.round(lo * 100)}%`;
      const item = legend.createDiv();
      item.addClass('workout-heatmap-legend-item');
      item.createSpan().setCssStyles({
        width: '12px',
        height: '12px',
        borderRadius: '3px',
        background: colorToCss(level.color),
      });
      item.createSpan({ text: label, cls: 'workout-heatmap-legend-band' });
    });
    legend.createSpan({ text: t('codeblock.heatmap.legendMore'), cls: 'workout-heatmap-legend-end' });
  }

  const viewsWrap = container.createDiv();
  viewsWrap.addClass('workout-heatmap-views');

  const frontWrap = viewsWrap.createDiv();
  frontWrap.addClass('workout-heatmap-view');
  frontWrap.appendChild(getMuscleSvg('front').cloneNode(true));

  const backWrap = viewsWrap.createDiv();
  backWrap.addClass('workout-heatmap-view');
  backWrap.setCssStyles({ display: 'none' });
  backWrap.appendChild(getMuscleSvg('back').cloneNode(true));

  // 隐藏头部/面部轮廓（cloneNode 复用已解析 SVG，代价极低，骨架阶段即可完成）
  for (const wrap of [frontWrap, backWrap]) {
    for (const hid of HIDDEN_SVG_GROUP_IDS) {
      const el2 = wrap.querySelector<HTMLElement>(`[id="${hid}"]`);
      if (el2) el2.setCssStyles({ display: 'none' });
    }
  }

  // 悬停提示的追加信息（恢复天数 / 练度配比），键为 "side:svgRegionId"。
  // 提示在骨架阶段就绑好了，切视图只更新这张表，不必重绑事件。
  const extraTip = new Map<string, string>();

  try {
    bindMuscleTooltips(frontWrap, 'front', extraTip);
    bindMuscleTooltips(backWrap, 'back', extraTip);
  } catch (err) {
    console.warn('[workout-heatmap] 绑定悬停提示失败，已跳过（不影响上色与视图切换）', err);
  }

  // 懒渲染占位：未进入视口前只显示骨架 + 一句提示，真正的「逐肌肉计算 + 上色」
  // 延迟到代码块滚动进入视口时才执行（按需渲染）。
  const lazyTip = container.createDiv({ cls: 'workout-heatmap-lazy' });
  lazyTip.setText(t('codeblock.heatmap.lazy'));

  interface MuscleEntry {
    muscle: Muscle;
    value: number;
    scale: HeatmapLevel[];
    tip: string;
  }

  let recoveryEntries: MuscleEntry[] | null = null;
  let growthEntries: MuscleEntry[] | null = null;
  const todayDay = toDayNum(todayDateStr());

  /** 恢复视图：按所选指标算绝对量（练了多少），提示里补「还有多久恢复」。 */
  function buildRecoveryEntries(): MuscleEntry[] {
    const exerciseMuscleMap = buildExerciseMuscleMap(config);
    const out: MuscleEntry[] = [];
    for (const muscle of config.muscles) {
      const stat = resolveMetricId(config, muscle, params.metric);
      if (!stat) continue;
      const range = resolveRange(muscle, codeRange);
      const value = computeMuscleValue(muscle, stat, range, logs, exerciseMuscleMap, config);
      const scale = muscle.heatmapLevels ?? stat.heatmapScale ?? DEFAULT_HEATMAP_SCALE;
      let tip = t('codeblock.heatmap.metricValue', { name: stat.name, v: String(value) });
      const doses = collectDoses(logs, config.exercises, [muscle.id]);
      const sum = recoverySummary(paramsForSubject(config, [muscle.id], DEFAULT_RECOVERY_PARAMS), doses, todayDay);
      if (sum.hasData) {
        tip +=
          sum.etaDays === null
            ? ` · ${t('codeblock.heatmap.recovered')}`
            : ` · ${t('codeblock.heatmap.recoverIn', { n: sum.etaDays.toFixed(1) })}`;
      }
      out.push({ muscle, value, scale, tip });
    }
    return out;
  }

  /** 发展视图：近期窗口周均练度 ÷ 中位数窗口内周练度中位数（相对自己）。无基线时 value=NaN，不上色。 */
  function buildGrowthEntries(): MuscleEntry[] {
    const exerciseMuscleMap = buildExerciseMuscleMap(config);
    const out: MuscleEntry[] = [];
    for (const muscle of config.muscles) {
      // 两个时间窗逐肌可配（编辑肌肉 → 热力图设置 → 发展视图），留空跟随默认 28 / 84
      const g = computeGrowthRatio(muscle.id, logs, exerciseMuscleMap, todayDay, undefined, {
        recentDays: muscle.growthRecentDays,
        baselineDays: muscle.growthBaselineDays,
      });
      const tip =
        g.ratio === null
          ? t('codeblock.heatmap.growthNoBaseline')
          : t('codeblock.heatmap.growthTip', {
              rd: String(g.window.recentDays),
              bd: String(g.window.baselineDays),
              recent: g.recentWeekly.toFixed(1),
              base: (g.baselineWeekly ?? 0).toFixed(1),
              pct: String(Math.round(g.ratio * 100)),
            });
      // 逐肌可覆盖色标（编辑肌肉 → 发展视图设置），留空＝用内置那套
      const scale = muscle.growthLevels && muscle.growthLevels.length ? muscle.growthLevels : GROWTH_SCALE;
      out.push({ muscle, value: g.ratio === null ? NaN : g.ratio, scale, tip });
    }
    return out;
  }

  /** 把一组肌肉值画到一张 SVG 上（同一路径被多肌命中时值相加、按贡献最大者取刻度）。 */
  function applyColorToView(wrap: HTMLElement, side: 'front' | 'back', entries: MuscleEntry[]): void {
    const pathInfo = new Map<string, { value: number; scale: HeatmapLevel[]; winner: number }>();
    for (const { muscle, value, scale } of entries) {
      if (!Number.isFinite(value)) continue;
      const ids = (muscle.svgRegionIds ?? []).filter((id) =>
        SVG_MUSCLE_CATALOG.some((e) => e.id === id && e.side === side)
      );
      if (ids.length === 0) continue;
      for (const id of ids) {
        const ex = pathInfo.get(id);
        if (!ex) {
          pathInfo.set(id, { value, scale, winner: value });
        } else {
          ex.value += value;
          // 多肌命中同路径时，用「单次贡献最大」的肌肉的分档来着色
          if (value > ex.winner) {
            ex.winner = value;
            ex.scale = scale;
          }
        }
      }
    }

    for (const [id, info2] of pathInfo) {
      const pathEl = wrap.querySelector<SVGPathElement | SVGGElement>(`[id="${id}"]`);
      if (!pathEl) {
        console.warn(`[workout-heatmap] SVG path not found: ${id}`);
        continue;
      }
      const colorName = colorForValue(info2.value, info2.scale);
      pathEl.setCssStyles({ fill: colorToCss(colorName), opacity: '0.85' });
    }
  }

  /** 按当前视图重画：先清掉上一轮内联填充，再刷提示表与颜色。 */
  function paint(): void {
    for (const wrap of [frontWrap, backWrap]) {
      for (const node of Array.from(wrap.querySelectorAll<SVGElement>('[id]'))) {
        node.setCssStyles({ fill: '', opacity: '' });
      }
    }
    extraTip.clear();
    const entries = mode === 'recovery' ? recoveryEntries : growthEntries;
    if (!entries) return;
    // 发展视图不加第二行：配比说明太长，气泡里挂两行反而看不清肌肉名
    if (mode === 'recovery') {
      for (const item of entries) {
        for (const id of item.muscle.svgRegionIds ?? []) {
          const entry = SVG_MUSCLE_CATALOG.find((e) => e.id === id);
          if (entry) extraTip.set(`${entry.side}:${id}`, item.tip);
        }
      }
    }
    applyColorToView(frontWrap, 'front', entries);
    applyColorToView(backWrap, 'back', entries);
  }

  function setMode(next: 'recovery' | 'growth'): void {
    mode = next;
    recoveryBtn.toggleClass('mod-cta', mode === 'recovery');
    growthBtn.toggleClass('mod-cta', mode === 'growth');
    recoveryBtn.toggleClass('mod-muted', mode === 'growth');
    growthBtn.toggleClass('mod-muted', mode === 'recovery');
    renderInfo();
    renderLegend();
    paint();
  }

  // —— 以下为「重计算 + 上色」，仅当代码块可见时执行 ——
  function applyHeatmap(): void {
    if (lazyTip.isConnected) lazyTip.remove();
    recoveryEntries = buildRecoveryEntries();
    growthEntries = buildGrowthEntries();
    paint();

    const entries = mode === 'recovery' ? recoveryEntries : growthEntries;
    if (!entries.some((e) => Number.isFinite(e.value))) {
      const msg =
        mode === 'growth'
          ? t('codeblock.heatmap.growthNoHistory')
          : codeRange === 'all'
            ? t('codeblock.heatmap.emptyAll')
            : t('codeblock.heatmap.emptyRange', { range: codeRange ?? '7d' });
      container.createDiv({ text: msg, cls: 'workout-heatmap-empty' });
    }
  }

  renderInfo();
  renderLegend();
  recoveryBtn.toggleClass('mod-cta', mode === 'recovery');
  growthBtn.toggleClass('mod-cta', mode === 'growth');
  recoveryBtn.addEventListener('click', () => setMode('recovery'));
  growthBtn.addEventListener('click', () => setMode('growth'));


  // 视图切换按钮（骨架阶段就可点，不依赖计算完成）
  function showSide(side: 'front' | 'back'): void {
    // 正/背面视图切换：用 setCssStyles 设置 display，避免 el.style.* 直接赋值
    // （obsidianmd/no-static-styles-assignment）。
    frontWrap.setCssStyles({ display: side === 'front' ? 'block' : 'none' });
    backWrap.setCssStyles({ display: side === 'back' ? 'block' : 'none' });
    frontBtn.toggleClass('mod-cta', side === 'front');
    backBtn.toggleClass('mod-cta', side === 'back');
    frontBtn.toggleClass('mod-muted', side === 'back');
    backBtn.toggleClass('mod-muted', side === 'front');
  }
  frontBtn.addEventListener('click', () => showSide('front'));
  backBtn.addEventListener('click', () => showSide('back'));
  showSide('front');

  // 旧 observer（重渲染场景下可能仍存在）先断开，再建新的，避免泄漏/重复计算。
  const prevOb = heatmapObservers.get(el);
  if (prevOb) prevOb.disconnect();

  if (typeof IntersectionObserver !== 'undefined') {
    // 仅当热力图代码块进入视口（含 200px 预加载边距）时才执行 applyHeatmap 重计算 + 上色。
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          applyHeatmap();
          io.disconnect();
          heatmapObservers.delete(el);
          break;
        }
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    heatmapObservers.set(el, io);
  } else {
    // 环境不支持 IntersectionObserver（极罕见）：直接同步计算，行为回退为旧逻辑。
    applyHeatmap();
  }
}
