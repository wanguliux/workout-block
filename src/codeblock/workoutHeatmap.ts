import { MarkdownPostProcessorContext, MarkdownRenderChild } from 'obsidian';
import { HeatmapLevel, LogRow, Muscle, StatDef, WorkoutConfig } from '../data/types';
import { computeStat } from '../data/statExpr';
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

const DEFAULT_HEATMAP_SCALE: HeatmapLevel[] = [
  { color: '#3b82f6', max: 5 },
  { color: '#22c55e', max: 10 },
  { color: '#f97316', max: 20 },
  { color: '#ef4444', max: 40 },
];

/* workoutHeatmap.ts —— 把 ```workout-heatmap 代码块渲染成全身肌肉热力图。
 * 精细度自动跟随肌肉管理里的 svgRegionIds 配置；支持正/背切换、指标与时间窗参数。 */

interface HeatmapParams {
  metric?: string;
  range?: string;
}

function parseParams(source: string): HeatmapParams {
  const params: HeatmapParams = {};
  for (const line of source.split('\n')) {
    const [key, value] = line.split(':').map((s) => s.trim());
    if (!key || value === undefined) continue;
    if (key === 'metric') params.metric = value;
    if (key === 'range') params.range = value;
  }
  return params;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateWithinRange(dateStr: string, range?: string): boolean {
  if (!range) return true;
  if (range === 'all') return true;
  if (RANGE_OPTIONS.includes(range)) {
    const days = parseInt(range);
    const today = new Date(`${todayStr()}T00:00:00`);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const d = new Date(`${dateStr}T00:00:00`);
    return d >= cutoff && d <= today;
  }
  if (range.includes('..')) {
    const [start, end] = range.split('..').map((s) => s.trim());
    return dateStr >= start && dateStr <= end;
  }
  return true;
}

const RANGE_OPTIONS = ['7d', '30d', '90d'];

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
  const tip = document.body.createDiv();
  tip.id = 'workout-heatmap-tooltip';
  tip.addClass('workout-heatmap-tooltip');
  tip.setCssStyles({ display: 'none' });
  document.body.appendChild(tip);
  heatmapTooltipEl = tip;
  return tip;
}

function bindMuscleTooltips(wrap: HTMLElement, side: 'front' | 'back'): void {
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
    tip.style.left = `${me.clientX + 12}px`;
    tip.style.top = `${me.clientY + 12}px`;
  };

  // 进入肌肉即时显示（无延迟）；在肌肉间移动直接换名；移出隐藏。
  wrap.addEventListener('mouseover', (ev: Event) => {
    const entry = entryFor(ev.target);
    if (!entry) return;
    const me = ev as MouseEvent;
    tip.textContent = formatSvgMuscleLabel(entry, getLocale());
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

function roleWeight(role: 'primary' | 'secondary'): number {
  return role === 'primary' ? 1.0 : 0.5;
}

function computeMuscleValue(
  muscle: Muscle,
  stat: StatDef,
  range: string,
  logs: LogRow[],
  exerciseMuscleMap: Map<string, { muscleId: string; role: 'primary' | 'secondary' }[]>
): number {
  let total = 0;
  for (const log of logs) {
    if (!log.timestamp || !log.exerciseId || !dateWithinRange(log.timestamp.split(' ')[0], range)) continue;
    // 用预构建的 map 做 O(1) 查找，代替原先 config.exercises.find（每次 O(exercises)），
    // 把整体复杂度从 O(muscles × logs × exercises) 降到 O(muscles × logs)。
    const em = exerciseMuscleMap.get(log.exerciseId);
    if (!em) continue;
    const hit = em.find((m) => m.muscleId === muscle.id);
    if (!hit) continue;
    const instanceValue = computeStat(stat, [log]);
    if (!Number.isFinite(instanceValue)) continue;
    total += instanceValue * roleWeight(hit.role);
  }
  return Math.round(total * 100) / 100;
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

function colorToCss(color: string): string {
  const map: Record<string, string> = {
    blue: '#3b82f6',
    green: '#22c55e',
    orange: '#f97316',
    red: '#ef4444',
  };
  if (color.startsWith('#')) return color; // 十六进制直接返回（自定义颜色）
  return map[color] ?? color;
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

  // 头部：视图切换 + 图例
  const header = container.createDiv();
  header.addClass('workout-heatmap-header');

  const viewSwitch = header.createDiv();
  viewSwitch.addClass('workout-heatmap-switch');
  const frontBtn = viewSwitch.createEl('button', { text: t('modal.muscleManager.front') });
  const backBtn = viewSwitch.createEl('button', { text: t('modal.muscleManager.back') });
  frontBtn.addClass('mod-cta');

  const info = header.createDiv();
  info.addClass('workout-heatmap-info');
  const metricName = metric?.name ?? t('modal.muscleManager.followDefaultMetric');
  const rangeText = codeRange ?? '7d';
  info.createSpan({ text: `${t('modal.muscleManager.heatmapMetric')}: ${metricName}` });
  info.createSpan({ text: `${t('modal.muscleManager.heatmapRange')}: ${rangeText}` });

  const legend = header.createDiv();
  legend.addClass('workout-heatmap-legend');
  // 阈值逐肌可配，单一图例无法呈现各肌不同刻度，故图例仅展示 4 色由轻→重，
  // 具体阈值在各肌肉编辑页查看。
  legend.createSpan({ text: t('codeblock.heatmap.legendLow'), cls: 'workout-heatmap-legend-end' });
  const legendScale = [...DEFAULT_HEATMAP_SCALE].sort((a, b) => (a.max ?? Infinity) - (b.max ?? Infinity));
  for (let i = 0; i < legendScale.length; i++) {
    const level = legendScale[i];
    const item = legend.createDiv();
    item.addClass('workout-heatmap-legend-item');
    const dot = item.createSpan();
    dot.setCssStyles({ width: '14px', height: '14px', borderRadius: '50%', background: colorToCss(level.color) });
  }
  legend.createSpan({ text: t('codeblock.heatmap.legendHigh'), cls: 'workout-heatmap-legend-end' });

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

  // 给每块肌肉路径绑定悬停提示（骨架阶段绑定一次即可，正/背切换只是显隐，路径元素不变）。
  // try/catch 兜底：提示气泡属增强体验，绝不应拖垮核心渲染（正/背切换、上色）。
  try {
    bindMuscleTooltips(frontWrap, 'front');
    bindMuscleTooltips(backWrap, 'back');
  } catch (err) {
    console.warn('[workout-heatmap] 绑定悬停提示失败，已跳过（不影响上色与视图切换）', err);
  }

  // 懒渲染占位：未进入视口前只显示骨架 + 一句提示，真正的「逐肌肉计算 + 上色」
  // 延迟到代码块滚动进入视口时才执行（按需渲染）。这样即使在有热力图的笔记里删记录，
  // 只要热力图不在视野内，就不会跟着每次数据变化做 O(muscles × logs) 的重计算，主线程更轻。
  const lazyTip = container.createDiv({ cls: 'workout-heatmap-lazy' });
  lazyTip.setText(t('codeblock.heatmap.lazy'));

  // —— 以下为「重计算 + 上色」，仅当代码块可见时执行 ——
  function applyHeatmap(): void {
    if (lazyTip.isConnected) lazyTip.remove();

    // 预构建 exerciseId → 训练项肌肉映射，供 computeMuscleValue 做 O(1) 查找（避免逐日志 O(exercises) 线性扫描）。
    const exerciseMuscleMap = new Map<string, { muscleId: string; role: 'primary' | 'secondary' }[]>();
    for (const ex of config.exercises) {
      if (ex.muscles && ex.muscles.length) {
        exerciseMuscleMap.set(ex.id, ex.muscles.map((m) => ({ muscleId: m.muscleId, role: m.role })));
      }
    }

    // 计算每块肌肉的标量值
    const muscleEntries: { muscle: Muscle; stat: StatDef; range: string; value: number; scale: HeatmapLevel[] }[] = [];
    for (const muscle of config.muscles) {
      const stat = resolveMetricId(config, muscle, params.metric);
      if (!stat) continue;
      const range = resolveRange(muscle, codeRange);
      const value = computeMuscleValue(muscle, stat, range, logs, exerciseMuscleMap);
      // 逐肌分档：优先用该肌自己的 heatmapLevels，否则用所选 StatDef 的默认分档
      const scale = muscle.heatmapLevels ?? stat.heatmapScale ?? DEFAULT_HEATMAP_SCALE;
      muscleEntries.push({ muscle, stat, range, value, scale });
    }

    const activeLogs = logs.filter((l) => l.timestamp && dateWithinRange(l.timestamp.split(' ')[0], codeRange ?? '7d'));
    const hasData = activeLogs.length > 0 && muscleEntries.length > 0 && muscleEntries.some((e) => e.value > 0);
    if (!hasData) {
      const emptyMsg = codeRange === 'all'
        ? t('codeblock.heatmap.emptyAll')
        : t('codeblock.heatmap.emptyRange', { range: rangeText });
      container.createDiv({ text: emptyMsg, cls: 'workout-heatmap-empty' });
    }

    function applyColorToView(wrap: HTMLElement, side: 'front' | 'back'): void {
      if (!hasData) return;
      // 先聚合每个 SVG 路径的累计值，并记下「贡献最大的肌肉」的分档作为该路径的着色刻度。
      // 注意：同一 id 可能在目录里同时存在 front 和 back 两条记录（同一肌群在正/背
      // 两个 SVG 文件里都画了同名路径）。这里用 some() 判断「该 id 是否在目标 side
      // 上存在」，避免 find() 命中第一条记录后误把另一侧的同名路径过滤掉。
      const pathInfo = new Map<string, { value: number; scale: HeatmapLevel[]; winner: number }>();
      for (const { muscle, value, scale } of muscleEntries) {
        if (value <= 0) continue;
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

      for (const [id, info] of pathInfo) {
        const pathEl = wrap.querySelector<SVGPathElement | SVGGElement>(`[id="${id}"]`);
        if (!pathEl) {
          console.warn(`[workout-heatmap] SVG path not found: ${id}`);
          continue;
        }
        const colorName = colorForValue(info.value, info.scale);
        pathEl.setCssStyles({ fill: colorToCss(colorName), opacity: '0.85' });
      }
    }

    applyColorToView(frontWrap, 'front');
    applyColorToView(backWrap, 'back');
  }

  // 视图切换按钮（骨架阶段就可点，不依赖计算完成）
  function showSide(side: 'front' | 'back'): void {
    frontWrap.style.display = side === 'front' ? 'block' : 'none';
    backWrap.style.display = side === 'back' ? 'block' : 'none';
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
