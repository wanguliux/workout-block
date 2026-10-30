/*
 * analysis.ts —— 训练分析：数据统计 / 肌肉热力图 / 当日总览。
 * 统计与热力图都直接调用 src/data 的纯计算模块，保证与插件同口径。
 */

import { StatDef } from '../../data/types';
import { computeStat } from '../../data/statExpr';
import { icon } from '../icons';
import { UiContext } from '../context';
import { state } from '../state';
import type { AnalysisTab } from '../state';
import {
  dateSeries,
  exerciseSummary,
  logChips,
  logExerciseName,
  materializedLog,
  resolveMetric,
  sortLogsDesc,
  statAssocText,
  statDelta,
  statFormulaText,
  statValue,
  volumeOfLogs,
} from '../calc';
import {
  L,
  esc,
  addDays,
  dateLong,
  dateOf,
  formatNumber,
  isoWeekday,
  spanMinutes,
  spanSeconds,
  todayStr,
  weekdayLabel,
} from '../format';
import {
  anatomyHTML,
  computeHeatmap,
  defaultHeatmapStat,
  heatmapStats,
  legendHTML,
  restText,
  restTone,
} from '../heatmap';

// —— 统计值单位换算（配置里标了 kg/lb 或质量类统计时跟随用户单位） ——
function massStat(stat: StatDef): boolean {
  const unit = stat.unit?.trim().toLowerCase();
  return unit === 'kg' || unit === 'lb' || /volume|1rm|onerepmax/i.test(stat.id);
}

function statDisplay(
  stat: StatDef,
  value: number,
  unit: 'kg' | 'lb',
  decimals: number
): { text: string; unit: string } {
  if (!Number.isFinite(value)) return { text: '—', unit: '' };
  let valueOut = value;
  let unitOut = stat.unit?.trim() || (massStat(stat) ? unit : '');
  if (massStat(stat)) {
    if (unit === 'lb' && (unitOut === '' || unitOut.toLowerCase() === 'kg')) {
      valueOut = value * 2.2;
      unitOut = 'lb';
    } else if (unit === 'kg' && unitOut.toLowerCase() === 'lb') {
      valueOut = value / 2.2;
      unitOut = 'kg';
    }
  }
  return { text: formatNumber(valueOut, decimals), unit: unitOut };
}

function statBetween(ctx: UiContext, stat: StatDef, start: string, end: string): number {
  const records = ctx.store.logs
    .filter((log) => {
      const day = dateOf(log.timestamp);
      return day >= start && day <= end && stat.associatedTypes.includes(log.category);
    })
    .map((log) => materializedLog(ctx.store.config, log));
  return computeStat(stat, records);
}

function previousWindow(range: string): { start: string; end: string } {
  const span = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 30;
  const end = addDays(todayStr(), -span);
  return { start: addDays(end, -(span - 1)), end };
}

function sparkline(ctx: UiContext, stat: StatDef): string {
  const days = dateSeries(7);
  const values = days.map((day) => {
    const logs = ctx.store.logs.filter((log) => dateOf(log.timestamp) === day);
    return statValue(ctx.store.config, stat, logs, undefined, day);
  });
  const max = Math.max(1, ...values);
  return (
    '<div class="spark">' +
    values
      .map((value, index) => {
        const height = Math.max(3, Math.round((value / max) * 100));
        return `<i class="${value > 0 ? 'on' : ''}" style="height:${height}%" title="${esc(
          `${weekdayLabel(isoWeekday(days[index]), true)} · ${formatNumber(
            value,
            ctx.store.settings.decimals
          )}`
        )}"></i>`;
      })
      .join('') +
    '</div>'
  );
}

function statCard(ctx: UiContext, stat: StatDef, range: string): string {
  const { config, logs, settings } = ctx.store;
  const current = statValue(config, stat, logs, range);
  const prevWindow = previousWindow(range);
  const previous = range === 'all' ? 0 : statBetween(ctx, stat, prevWindow.start, prevWindow.end);
  const display = statDisplay(stat, current, settings.unit, settings.decimals);
  const delta = range === 'all' ? { text: '—', tone: 'faint' } : statDelta(current, previous);

  return (
    '<div class="card stat-card">' +
    '<div class="stat-top"><div><div class="stat-name">' +
    esc(stat.name) +
    '</div><div class="faint">' +
    esc(statAssocText(config, stat)) +
    '</div></div>' +
    `<span class="${delta.tone === 'faint' ? 'pill' : delta.tone === 'delta-up' ? 'pill pill-green' : 'pill pill-red'}">${esc(
      delta.text
    )}</span></div>` +
    `<div class="stat-value">${esc(display.text)}${display.unit ? `<small>${esc(display.unit)}</small>` : ''}</div>` +
    sparkline(ctx, stat) +
    '<div class="stat-foot"><span class="mono">' +
    esc(statFormulaText(stat)) +
    '</span><span>' +
    esc(L('近 7 天', '7 days')) +
    '</span></div></div>'
  );
}

function statsTab(ctx: UiContext): string {
  const stats = ctx.store.config.statistics.filter((stat) => stat.enabled);
  if (stats.length === 0) {
    return `<div class="card"><div class="empty">${esc(
      L('还没有启用的统计指标，去「自定义 → 统计」添加。', 'No enabled statistics. Add some in Customize → Statistics.')
    )}<div style="margin-top:12px"><button class="btn btn-primary" data-page="customize" data-tab="stats">${icon(
      'sliders'
    )}${esc(L('去添加', 'Add'))}</button></div></div></div>`;
  }
  return (
    '<div class="stat-toolbar">' +
    rangeControl() +
    `<span class="faint">${esc(L('统计口径基于完整记录，不受显示条数限制', 'Computed from all records, not limited by display count'))}</span>` +
    '</div>' +
    '<div class="stat-grid">' +
    stats.map((stat) => statCard(ctx, stat, state.analysis.range)).join('') +
    '</div>'
  );
}

function rangeControl(): string {
  return (
    '<div class="seg">' +
    [
      ['7d', L('7 天', '7d')],
      ['30d', L('30 天', '30d')],
      ['90d', L('90 天', '90d')],
      ['all', L('全部', 'All')],
    ]
      .map(
        ([value, label]) =>
          `<button class="${state.analysis.range === value ? 'on' : ''}" data-action="analysis-range" data-range="${value}">${esc(
            label
          )}</button>`
      )
      .join('') +
    '</div>'
  );
}

function heatmapTab(ctx: UiContext): string {
  const { config, logs } = ctx.store;
  const mapped = config.muscles.some((muscle) => (muscle.svgRegionIds ?? []).length > 0);

  if (config.statistics.length === 0) {
    return `<div class="card"><div class="empty">${esc(
      L('先创建至少一个统计指标，热力图需要用它计算训练负荷。', 'Create a statistic first; the heatmap uses it to compute load.')
    )}<div style="margin-top:12px"><button class="btn btn-primary" data-page="customize" data-tab="stats">${icon(
      'sliders'
    )}${esc(L('添加统计', 'Add statistic'))}</button></div></div></div>`;
  }

  const stat = resolveMetric(config, state.analysis.metricId) ?? defaultHeatmapStat(config);
  const model = computeHeatmap(config, logs, stat, state.analysis.range);
  const options = (heatmapStats(config).length ? heatmapStats(config) : config.statistics)
    .map(
      (item) =>
        `<option value="${esc(item.id)}"${item.id === stat?.id ? ' selected' : ''}>${esc(item.name)}</option>`
    )
    .join('');

  const rankings = [...model.entries].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...rankings.map((entry) => entry.value));
  const rows = rankings
    .map(
      (entry) =>
        '<tr>' +
        `<td><b>${esc(entry.name)}</b></td>` +
        `<td><div class="breakdown-row"><span class="bar-mini" style="width:90px"><i style="width:${Math.round(
          (entry.value / max) * 100
        )}%;background:${entry.value > 0 ? entry.color : 'var(--line-strong)'}"></i></span><span class="num">${esc(
          formatNumber(entry.value, ctx.store.settings.decimals)
        )}</span></div></td>` +
        `<td><span class="${restTone(entry.restDays, entry.muscle.restThresholdDays ?? 7)}">${esc(
          restText(entry.restDays)
        )}</span></td>` +
        '</tr>'
    )
    .join('');

  const noMapping = !mapped
    ? `<div class="empty">${esc(
        L('还没有肌肉映射。去「自定义 → 肌肉」套用默认映射。', 'No muscle mapping yet. Apply a default mapping in Customize → Muscles.')
      )}<div style="margin-top:12px"><button class="btn btn-primary" data-page="customize" data-tab="muscles">${icon(
        'sliders'
      )}${esc(L('去映射', 'Map muscles'))}</button></div></div>`
    : '';

  return (
    '<div class="card">' +
    '<div class="card-head"><div><div class="card-title">' +
    icon('activity') +
    esc(L('肌肉热力图', 'Muscle heatmap')) +
    `</div><div class="card-sub">${esc(L('主练 1.0 / 辅练 0.5 加权；颜色按肌肉分档', 'Primary 1.0 / secondary 0.5; colors use per-muscle bands'))}</div></div></div>` +
    '<div class="heat-controls">' +
    `<select class="select" data-analysis-metric>${options}</select>` +
    rangeControl() +
    '<div class="seg">' +
    `<button class="${state.analysis.side === 'front' ? 'on' : ''}" data-action="analysis-side" data-side="front">${esc(L('正面', 'Front'))}</button>` +
    `<button class="${state.analysis.side === 'back' ? 'on' : ''}" data-action="analysis-side" data-side="back">${esc(L('背面', 'Back'))}</button>` +
    '</div>' +
    `<button class="btn btn-outline btn-sm" data-action="export-heatmap">${icon('download')}${esc(L('导出图片', 'Export PNG'))}</button>` +
    '</div>' +
    (noMapping ||
      '<div class="heatmap-layout">' +
        '<div class="heatmap-canvas">' +
        anatomyHTML(state.analysis.side, model) +
        (!model.hasData
          ? `<div class="heatmap-empty">${esc(
              L('该时间窗内没有可计入的数据', 'No eligible data in this window')
            )}</div>`
          : '') +
        '</div>' +
        '<div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
        `<div class="card-title">${esc(stat?.name ?? '')}</div>` +
        `<span class="pill pill-soft">${esc(model.unit || L('数值', 'Value'))}</span>` +
        '</div>' +
        '<div class="table-wrap"><table class="detail-table"><thead><tr>' +
        `<th>${esc(L('肌肉', 'Muscle'))}</th><th>${esc(L('负荷', 'Load'))}</th><th>${esc(L('距上次', 'Rest'))}</th>` +
        `</tr></thead><tbody>${rows}</tbody></table></div>` +
        '<div style="margin-top:12px">' +
        legendHTML(model) +
        '</div>' +
        `<div class="faint" style="margin-top:8px">${esc(L('悬停身体路径可查看肌肉与数值', 'Hover a body path to see muscle and value'))}</div>` +
        `<div class="faint" style="margin-top:4px">${esc(
          L(
            '人体图：Figma Muscle Atlas by Ryan Graves，CC BY 4.0',
            'Body art: Figma Muscle Atlas by Ryan Graves, CC BY 4.0'
          )
        )}</div>` +
        '</div></div>') +
    '</div>'
  );
}

function dayTab(ctx: UiContext): string {
  const { config, logs, settings } = ctx.store;
  const day = state.analysis.day || todayStr();
  const dayLogs = sortLogsDesc(logs.filter((log) => dateOf(log.timestamp) === day));
  const volume = volumeOfLogs(config, dayLogs);
  const volumeDisplay = settings.unit === 'lb' ? volume * 2.2 : volume;
  const exerciseCount = new Set(dayLogs.map((log) => log.exerciseId || log.category)).size;
  const summary = exerciseSummary(config, dayLogs, settings.unit);

  const breakdown = summary
    .map(
      (row) =>
        '<tr>' +
        `<td><b>${esc(row.name)}</b><div class="faint">${esc(row.typeName)}</div></td>` +
        `<td class="num">${row.sets}</td>` +
        `<td class="num">${esc(formatNumber(row.volume, settings.decimals))}</td>` +
        `<td>${esc(row.best)}</td>` +
        '</tr>'
    )
    .join('');

  const records = dayLogs
    .map((log) => {
      const chips = logChips(config, log, settings.unit)
        .map((chip) => `<span class="chip"><b>${esc(chip.label)}</b> ${esc(chip.value)}</span>`)
        .join('');
      return (
        '<div class="mini-item" style="padding:10px 11px">' +
        `<span class="time">${esc(log.timestamp.slice(11, 16))}</span>` +
        `<span><b>${esc(logExerciseName(config, log))}</b></span>` +
        `<span class="chips" style="margin-left:auto">${chips}</span>` +
        `<button class="mini-btn" data-action="edit-log" data-log="${esc(log.id)}">${icon('edit', 'ic-sm')}</button>` +
        '</div>'
      );
    })
    .join('');

  return (
    '<div class="card">' +
    '<div class="card-head"><div><div class="card-title">' +
    icon('table') +
    esc(L('当日总览', 'Day overview')) +
    '</div><div class="card-sub">' +
    esc(dateLong(day)) +
    '</div></div>' +
    '<div class="head-actions day-nav">' +
    `<button class="icon-btn" data-action="day-step" data-step="-1" title="${esc(L('前一天', 'Previous day'))}">${icon('arrowLeft')}</button>` +
    `<input class="input" type="date" data-analysis-day value="${esc(day)}" style="max-width:160px" />` +
    `<button class="icon-btn" data-action="day-step" data-step="1" title="${esc(L('后一天', 'Next day'))}">${icon('arrowRight')}</button>` +
    '</div></div>' +
    '<div class="day-summary">' +
    `<div class="mini-stat"><div class="k">${esc(L('组数', 'Sets'))}</div><div class="v">${dayLogs.length}</div></div>` +
    `<div class="mini-stat"><div class="k">${esc(L('训练量', 'Volume'))}</div><div class="v">${esc(
      formatNumber(volumeDisplay, settings.decimals)
    )}<small>${esc(settings.unit)}</small></div></div>` +
    `<div class="mini-stat"><div class="k">${esc(L('跨度', 'Span'))}</div><div class="v">${formatNumber(
      spanMinutes(spanSeconds(dayLogs))
    )}<small>${esc(L('分', 'min'))}</small></div></div>` +
    `<div class="mini-stat"><div class="k">${esc(L('动作数', 'Exercises'))}</div><div class="v">${exerciseCount}</div></div>` +
    '</div>' +
    '<div class="grid-2"><div>' +
    '<div class="card-title" style="margin-bottom:8px">' +
    esc(L('按动作汇总', 'By exercise')) +
    '</div>' +
    '<div class="table-wrap"><table class="data-table"><thead><tr>' +
    `<th>${esc(L('动作', 'Exercise'))}</th><th>${esc(L('组数', 'Sets'))}</th><th>${esc(L('训练量', 'Volume'))}</th><th>${esc(L('最佳组', 'Best'))}</th>` +
    `</tr></thead><tbody>${
      breakdown || `<tr><td colspan="4"><div class="empty">${esc(L('当天没有记录', 'No records on this day'))}</div></td></tr>`
    }</tbody></table></div>` +
    '</div><div>' +
    '<div class="card-title" style="margin-bottom:8px">' +
    esc(L('逐组记录', 'Set by set')) +
    '</div>' +
    `<div class="mini-list">${records || `<div class="empty">${esc(L('当天没有记录', 'No records on this day'))}</div>`}</div>` +
    '</div></div></div>'
  );
}

const TABS: { id: AnalysisTab; label: [string, string] }[] = [
  { id: 'stats', label: ['数据统计', 'Statistics'] },
  { id: 'heatmap', label: ['肌肉热力图', 'Heatmap'] },
  { id: 'day', label: ['当日总览', 'Day'] },
];

export function renderAnalysis(ctx: UiContext): string {
  const tab = state.analysis.tab;
  return (
    '<div class="page-head"><div><h2>' +
    esc(L('训练分析', 'Analysis')) +
    '</h2><p>' +
    esc(L('统计、肌肉热力图与当日总览', 'Statistics, muscle heatmap and daily overview')) +
    '</p></div></div>' +
    '<div class="subtabs">' +
    TABS.map(
      (item) =>
        `<button class="subtab${tab === item.id ? ' on' : ''}" data-page="analysis" data-tab="${item.id}">${esc(
          L(item.label[0], item.label[1])
        )}</button>`
    ).join('') +
    '</div>' +
    (tab === 'heatmap' ? heatmapTab(ctx) : tab === 'day' ? dayTab(ctx) : statsTab(ctx))
  );
}
