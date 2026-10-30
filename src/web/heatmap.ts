/*
 * heatmap.ts —— 肌肉热力图的网页渲染（真实 SVG + 逐路径着色）。
 *
 * 计算口径复用 src/data/muscleStats：主练 1.0 / 辅练 0.5 角色加权。
 * 颜色三级回退：肌肉 heatmapLevels → 统计指标 heatmapScale → 全局默认四档。
 * SVG 采用「字符串注入」而不是 DOM 克隆：给命中的路径追加内联 fill 与 <title>，
 * 既保留原始矢量细节，也让浏览器原生 tooltip 直接可用。
 */

import frontSvgRaw from '../assets/muscle_layer_front.svg';
import backSvgRaw from '../assets/muscle_layer_back.svg';
import { HeatmapLevel, LogRow, Muscle, StatDef, TrainingType, WorkoutConfig } from '../data/types';
import {
  buildExerciseMuscleMap,
  computeMuscleRestDays,
  computeMuscleValue,
} from '../data/muscleStats';
import { SVG_MUSCLE_CATALOG } from '../data/svgMuscleCatalog';
import { DEFAULT_HEATMAP_SCALE, colorToCss } from '../data/heatmapDefaults';
import { getMuscleName } from '../data/display';
import { L, esc, formatNumber } from './format';

export interface MuscleHeat {
  muscle: Muscle;
  name: string;
  value: number;
  scale: HeatmapLevel[];
  color: string;
  restDays: number;
}

export interface PathHeat {
  value: number;
  color: string;
  tip: string;
}

export interface HeatmapModel {
  entries: MuscleHeat[];
  front: Map<string, PathHeat>;
  back: Map<string, PathHeat>;
  hasData: boolean;
  maxValue: number;
  stat: StatDef | undefined;
  unit: string;
}

export function heatmapStats(config: WorkoutConfig): StatDef[] {
  return config.statistics.filter((s) => s.enabled);
}

export function defaultHeatmapStat(config: WorkoutConfig): StatDef | undefined {
  const enabled = heatmapStats(config);
  const pool = enabled.length > 0 ? enabled : config.statistics;
  return pool.find((s) => s.heatmapDefault) ?? pool[0];
}

export function scaleFor(muscle: Muscle, stat: StatDef | undefined): HeatmapLevel[] {
  if (muscle.heatmapLevels && muscle.heatmapLevels.length > 0) return muscle.heatmapLevels;
  if (stat?.heatmapScale && stat.heatmapScale.length > 0) return stat.heatmapScale;
  return DEFAULT_HEATMAP_SCALE;
}

export function colorForValue(value: number, scale?: HeatmapLevel[]): string {
  const levels = scale && scale.length > 0 ? scale : DEFAULT_HEATMAP_SCALE;
  const sorted = [...levels].sort((a, b) => (a.max ?? Infinity) - (b.max ?? Infinity));
  for (const level of sorted) {
    if (value <= (level.max ?? Infinity)) return colorToCss(level.color);
  }
  return colorToCss(sorted[sorted.length - 1]?.color ?? '#ef4444');
}

function untrainedText(): string {
  return L('未训练', 'No training');
}

export function computeHeatmap(
  config: WorkoutConfig,
  logs: LogRow[],
  stat: StatDef | undefined,
  range: string
): HeatmapModel {
  const exerciseMap = buildExerciseMuscleMap(config);
  const entries: MuscleHeat[] = [];
  const unit = stat?.unit?.trim() ?? '';

  for (const muscle of config.muscles) {
    const value = stat ? computeMuscleValue(muscle, stat, range, logs, exerciseMap, config) : 0;
    const scale = scaleFor(muscle, stat);
    entries.push({
      muscle,
      name: getMuscleName(muscle) || muscle.id,
      value: Number.isFinite(value) ? value : 0,
      scale,
      color: value > 0 ? colorForValue(value, scale) : colorToCss(scale[0]?.color ?? '#c9c7bf'),
      restDays: computeMuscleRestDays(muscle.id, logs, exerciseMap),
    });
  }

  type Accum = { value: number; winner: MuscleHeat; names: Set<string> };
  const accum: Record<'front' | 'back', Map<string, Accum>> = {
    front: new Map(),
    back: new Map(),
  };

  for (const entry of entries) {
    for (const regionId of entry.muscle.svgRegionIds ?? []) {
      const sides: ('front' | 'back')[] = [];
      if (SVG_MUSCLE_CATALOG.some((e) => e.id === regionId && e.side === 'front')) sides.push('front');
      if (SVG_MUSCLE_CATALOG.some((e) => e.id === regionId && e.side === 'back')) sides.push('back');
      for (const side of sides) {
        const map = accum[side];
        const existing = map.get(regionId);
        if (!existing) {
          map.set(regionId, { value: entry.value, winner: entry, names: new Set([entry.name]) });
        } else {
          existing.value += entry.value;
          existing.names.add(entry.name);
          if (entry.value > existing.winner.value) existing.winner = entry;
        }
      }
    }
  }

  const finalize = (map: Map<string, Accum>): Map<string, PathHeat> => {
    const out = new Map<string, PathHeat>();
    for (const [id, acc] of map) {
      const value = Math.round(acc.value * 100) / 100;
      const tip =
        value > 0
          ? `${acc.winner.name} · ${formatNumber(value)}${unit ? ' ' + unit : ''}`
          : `${acc.winner.name} · ${untrainedText()}`;
      out.set(id, {
        value,
        color: value > 0 ? colorForValue(value, acc.winner.scale) : '',
        tip,
      });
    }
    return out;
  };

  const maxValue = entries.reduce((max, e) => Math.max(max, e.value), 0);
  return {
    entries,
    front: finalize(accum.front),
    back: finalize(accum.back),
    hasData: entries.some((e) => e.value > 0),
    maxValue,
    stat,
    unit,
  };
}

function decorateSvg(raw: string, paths: Map<string, PathHeat>): string {
  return raw.replace(/<path\b([^>]*?)id="([^"]+)"([^>]*?)(\/?)>/g, (match, before, id, after, slash) => {
    const info = paths.get(id);
    if (!info) return match;
    const style = info.color ? ` style="fill:${info.color};opacity:.88"` : '';
    const title = `<title>${esc(info.tip)}</title>`;
    return `<path${before}id="${id}"${after}${style} data-tip="${esc(info.tip)}">${title}</path>`;
  });
}

export function anatomyHTML(side: 'front' | 'back', model: HeatmapModel, cls = 'anatomy'): string {
  const raw = side === 'front' ? frontSvgRaw : backSvgRaw;
  const paths = side === 'front' ? model.front : model.back;
  return (
    `<div class="body-figure ${cls}" role="img" aria-label="${side === 'front' ? 'front' : 'back'} anatomy">` +
    decorateSvg(raw, paths) +
    '</div>'
  );
}

export function legendHTML(model: HeatmapModel, compact = false): string {
  const scale = [...(model.stat?.heatmapScale?.length ? model.stat.heatmapScale : DEFAULT_HEATMAP_SCALE)].sort(
    (a, b) => (a.max ?? Infinity) - (b.max ?? Infinity)
  );
  const dots = scale
    .map((level) => `<i style="background:${colorToCss(level.color)}"></i>`)
    .join('');
  return (
    `<div class="legend${compact ? ' legend-compact' : ''}">` +
    `<span>${esc(L('低', 'Low'))}</span>${dots}<span>${esc(L('高', 'High'))}</span>` +
    '</div>'
  );
}

export function ranking(model: HeatmapModel, limit = 5): MuscleHeat[] {
  return [...model.entries]
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export function restText(days: number): string {
  if (days < 0) return L('从未训练', 'Never');
  if (days === 0) return L('今天练过', 'Trained today');
  return L(`${days} 天前`, `${days}d ago`);
}

export function restTone(days: number, threshold = 7): string {
  if (days < 0) return 'pill';
  if (days <= 1) return 'pill pill-green';
  if (days >= threshold) return 'pill pill-red';
  return 'pill pill-orange';
}

const TYPE_ICON: Record<string, string> = {
  strength: 'dumbbell',
  aerobic: 'wind',
  bodyweight: 'target',
};

export function typeIcon(type: TrainingType | undefined): string {
  return (type?.id && TYPE_ICON[type.id]) || 'activity';
}
