/*
 * recoveryPreview.ts —— 「恢复曲线设置」折叠区底部的迷你预览图。
 *
 * 目的只有一个：改参数时立刻看到形状怎么变，不必去笔记里插代码块试。
 * 所以它画的是**一次标准训练**（固定 8 练度）之后的状态曲线，与真实数据无关：
 *   掉多深（疲劳动力度/适应留存）→ 几天回本（疲劳消退）→ 峰值多高（适应消退）
 *   → 不练最终落到哪（运动前水平/消退记忆/维持量）。
 *
 * 纯 DOM 构建（document.createElementNS），不依赖 Obsidian 的 createEl/createSvg，
 * 也不引图表库——这样 jsdom 测试里能直接跑，插件里也零成本。
 */

import {
  RecoveryParams,
  fromDayNum,
  recoverySummary,
  sampleCurve,
  toDayNum,
} from '../data/recovery';
import { t } from '../i18n';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_W = 320;
const VIEW_H = 92;
const PAD = 10;

/**
 * 固定的绘图窗口：横轴恒为「训练后 0–60 天」，纵轴恒为 55–112 点。
 *
 * **坐标轴必须固定**：这图的用处是「改一个参数，看形状怎么变」。
 * 若坐标随数据自适应，把疲劳动力度调大只会把整条线重新缩放一遍、看着几乎一样，
 * 反而看不出「掉得更深」；固定之后，掉得深就是真的往下走、峰更高就是真的顶出画面。
 */
const PREVIEW_DAYS = 60;
const Y_MIN = 55;
const Y_MAX = 112;

export interface RecoveryPreviewOptions {
  /** 参考剂量（练度）：模拟「一次训练打多少」。默认 8 练度。 */
  dose?: number;
}

function svgNode<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function fmt(value: number): string {
  return value.toFixed(1);
}

/**
 * 在容器里画出「一次训练后的状态曲线」。
 * 每次参数变化整块重画（几十个节点，比做增量更新简单且不会漏状态）。
 */
export function renderRecoveryPreview(
  container: HTMLElement,
  params: RecoveryParams,
  options: RecoveryPreviewOptions = {}
): void {
  container.replaceChildren();

  const dose = options.dose ?? 8;
  // 一次训练记在第 0 天；横轴时长固定，不随 fitnessTau 变
  const doses = [{ day: fromDayNum(0), dose }];
  const summary = recoverySummary(params, doses, 0, PREVIEW_DAYS);
  const points = sampleCurve(params, doses, 0, PREVIEW_DAYS, 0.5);
  const floor = params.baseline - params.detrainDepth;

  const x = (day: number): number => PAD + (day / PREVIEW_DAYS) * (VIEW_W - PAD * 2);
  const y = (state: number): number => PAD + ((Y_MAX - state) / (Y_MAX - Y_MIN)) * (VIEW_H - PAD * 2);

  const svg = svgNode('svg', {
    viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
    class: 'workout-recovery-preview-chart',
    role: 'img',
    'aria-label': t('modal.muscleManager.recoveryPreviewAria'),
  });

  // 固定网格：横 15/30/45 天，纵 60/80/100 点。位置永不变化，用来当「尺子」比对形状。
  for (const day of [15, 30, 45]) {
    svg.appendChild(
      svgNode('line', {
        x1: x(day).toFixed(1),
        y1: PAD,
        x2: x(day).toFixed(1),
        y2: VIEW_H - PAD,
        stroke: 'currentColor',
        'stroke-opacity': 0.1,
        'stroke-width': 1,
      })
    );
  }
  for (const level of [60, 80, 100]) {
    svg.appendChild(
      svgNode('line', {
        x1: PAD,
        y1: y(level).toFixed(1),
        x2: VIEW_W - PAD,
        y2: y(level).toFixed(1),
        stroke: 'currentColor',
        'stroke-opacity': 0.1,
        'stroke-width': 1,
      })
    );
  }

  // 运动前水平：与主图一致的黄色虚线（全图唯一参考线）
  if (params.detrainDepth > 0) {
    svg.appendChild(
      svgNode('line', {
        x1: PAD,
        y1: y(floor).toFixed(1),
        x2: VIEW_W - PAD,
        y2: y(floor).toFixed(1),
        stroke: 'var(--color-yellow, #eab308)',
        'stroke-width': 1.4,
        'stroke-dasharray': '5 3',
        'stroke-opacity': 0.9,
      })
    );
  }

  // 曲线 + 面积
  const line = points
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.state).toFixed(1)}`)
    .join('');
  if (line) {
    svg.appendChild(
      svgNode('path', {
        d: `${line}L${x(PREVIEW_DAYS).toFixed(1)},${VIEW_H - PAD}L${x(0).toFixed(1)},${VIEW_H - PAD}Z`,
        fill: 'var(--interactive-accent)',
        'fill-opacity': 0.1,
      })
    );
    svg.appendChild(
      svgNode('path', {
        d: line,
        fill: 'none',
        stroke: 'var(--interactive-accent)',
        'stroke-width': 2,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      })
    );
  }

  // 峰值点：参数一变，它就左右挪 / 上下跳，很直观
  if (summary.peak) {
    const peakDay = toDayNum(summary.peak.day);
    const dot = svgNode('circle', {
      cx: x(peakDay).toFixed(1),
      cy: y(summary.peak.state).toFixed(1),
      r: 2.6,
      fill: 'var(--interactive-accent)',
    });
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = t('modal.muscleManager.recoveryPreviewPeak', {
      day: String(Math.round(peakDay)),
      v: fmt(summary.peak.state),
    });
    dot.appendChild(title);
    svg.appendChild(dot);
  }

  container.appendChild(svg);

  // 一行数字说明：图内不写字（与主图同口径），关键量全放这行
  const caption = document.createElement('div');
  caption.className = 'workout-recovery-preview-caption';
  const parts = [
    t('modal.muscleManager.recoveryPreviewDose', { n: String(dose) }),
    t('modal.muscleManager.recoveryPreviewDrop', { v: fmt(summary.state) }),
  ];
  // 距恢复天数只在真能算出来时报；算不出来且还在基线下方（曲线贴着基线爬不回去）就整段不写，
  // 免得把「回不去」说成「已恢复」。
  if (summary.etaDays !== null) {
    parts.push(t('modal.muscleManager.recoveryPreviewEta', { n: fmt(summary.etaDays) }));
  } else if (summary.state >= params.baseline) {
    parts.push(t('modal.muscleManager.recoveryPreviewNoEta'));
  }
  if (summary.peak) {
    parts.push(
      t('modal.muscleManager.recoveryPreviewPeak', {
        day: String(Math.round(toDayNum(summary.peak.day))),
        v: fmt(summary.peak.state),
      })
    );
  }
  if (params.detrainDepth > 0) {
    parts.push(t('modal.muscleManager.recoveryPreviewFloor', { v: String(Math.round(floor)) }));
  }
  caption.textContent = parts.join(' · ');
  container.appendChild(caption);
}
