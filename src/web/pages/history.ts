/*
 * history.ts —— 训练日志：搜索、类型/范围筛选、按日期分组、编辑与删除。
 * 输入搜索时只替换表体，保持输入框焦点。
 */

import { LogRow, TrainingType } from '../../data/types';
import { getTrainingTypeName } from '../../data/display';
import { icon } from '../icons';
import { UiContext } from '../context';
import { state } from '../state';
import {
  logChips,
  logExerciseName,
  logsInRange,
  sortLogsDesc,
  typeName,
} from '../calc';
import { L, esc, dateLong, dateOf, timeOf } from '../format';

export interface HistoryResult {
  rows: string;
  count: number;
  days: number;
}

function matchesSearch(ctx: UiContext, log: LogRow): boolean {
  const term = state.history.search.trim().toLowerCase();
  if (!term) return true;
  const name = logExerciseName(ctx.store.config, log).toLowerCase();
  const note = (log.note ?? '').toLowerCase();
  const plan = (log.plan ?? '').toLowerCase();
  const values = logChips(ctx.store.config, log, ctx.store.settings.unit)
    .map((chip) => `${chip.label} ${chip.value}`)
    .join(' ')
    .toLowerCase();
  return name.includes(term) || note.includes(term) || plan.includes(term) || values.includes(term);
}

export function historyResults(ctx: UiContext): HistoryResult {
  const { config, settings } = ctx.store;
  let logs = sortLogsDesc(logsInRange(ctx.store.logs, state.history.range));
  if (state.history.typeId) logs = logs.filter((log) => log.category === state.history.typeId);
  logs = logs.filter((log) => matchesSearch(ctx, log));

  // count / days 报的是「筛选后全量」，rows 只渲染前 limit 条，避免几千行一次铺满 DOM
  const total = logs.length;
  const days = new Set(logs.map((log) => dateOf(log.timestamp))).size;
  const visible = total > state.history.limit ? logs.slice(0, state.history.limit) : logs;

  const grouped = new Map<string, typeof logs>();
  for (const log of visible) {
    const day = dateOf(log.timestamp);
    const list = grouped.get(day);
    if (list) list.push(log);
    else grouped.set(day, [log]);
  }

  const rows = [...grouped.entries()]
    .map(([day, dayLogs]) => {
      const dateRow =
        `<tr class="date-row"><td colspan="6">` +
        `<span>${esc(dateLong(day))}</span>` +
        `<span class="date-count">${dayLogs.length} ${esc(L('组', 'sets'))}</span>` +
        '</td></tr>';
      const logRows = dayLogs
        .map((log) => {
          const chips = logChips(config, log, settings.unit)
            .slice(0, 6)
            .map((chip) => `<span class="chip"><b>${esc(chip.label)}</b> ${esc(chip.value)}</span>`)
            .join('');
          return (
            '<tr data-log-row="' +
            esc(log.id) +
            '">' +
            `<td class="num faint" style="white-space:nowrap">${esc(timeOf(log.timestamp))}</td>` +
            `<td><span class="pill pill-soft">${esc(typeName(config, log.category))}</span></td>` +
            `<td><b>${esc(logExerciseName(config, log))}</b></td>` +
            `<td><div class="chips">${chips || '<span class="faint">—</span>'}</div></td>` +
            `<td class="muted">${esc(log.note ?? '')}${log.plan ? `<div class="faint">${esc(log.plan)}</div>` : ''}</td>` +
            '<td><div class="row-actions">' +
            `<button class="mini-btn" data-action="edit-log" data-log="${esc(log.id)}" title="${esc(L('编辑', 'Edit'))}">${icon('edit', 'ic-sm')}</button>` +
            `<button class="mini-btn danger" data-action="delete-log" data-log="${esc(log.id)}" title="${esc(L('删除', 'Delete'))}">${icon('trash', 'ic-sm')}</button>` +
            '</div></td></tr>'
          );
        })
        .join('');
      return dateRow + logRows;
    })
    .join('');

  return { rows, count: total, days };
}

function filterOptions(ctx: UiContext): string {
  return (
    `<option value="">${esc(L('全部类型', 'All types'))}</option>` +
    ctx.store.config.trainingTypes
      .map(
        (type: TrainingType) =>
          `<option value="${esc(type.id)}"${state.history.typeId === type.id ? ' selected' : ''}>${esc(
            getTrainingTypeName(type)
          )}</option>`
      )
      .join('')
  );
}

export function renderHistory(ctx: UiContext): string {
  const result = historyResults(ctx);
  return (
    '<div class="page-head"><div><h2>' +
    esc(L('训练日志', 'Training log')) +
    '</h2><p>' +
    esc(L('按时间回看每一组，支持编辑与再次记录', 'Review every set, edit or repeat')) +
    '</p></div><div class="head-actions">' +
    `<button class="btn btn-outline" data-action="export-csv">${icon('download')}${esc(L('导出 CSV', 'Export CSV'))}</button>` +
    `<button class="btn btn-primary" data-page="record">${icon('plus')}${esc(L('记录一组', 'Log a set'))}</button>` +
    '</div></div>' +
    '<div class="card">' +
    '<div class="filter-bar">' +
    '<div class="search-inline">' +
    icon('search') +
    `<input class="input" type="search" data-history-search value="${esc(state.history.search)}" placeholder="${esc(L('搜索动作、备注、数值…', 'Search exercise, note, values…'))}" />` +
    '</div>' +
    `<select class="select" data-history-type>${filterOptions(ctx)}</select>` +
    `<select class="select" data-history-range>` +
    [
      ['all', L('全部时间', 'All time')],
      ['7d', L('最近 7 天', 'Last 7 days')],
      ['30d', L('最近 30 天', 'Last 30 days')],
      ['90d', L('最近 90 天', 'Last 90 days')],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}"${state.history.range === value ? ' selected' : ''}>${esc(label)}</option>`
      )
      .join('') +
    '</select>' +
    `<span class="faint" style="margin-left:auto" id="historyCount">${esc(
      L(`${result.count} 组 · ${result.days} 天`, `${result.count} sets · ${result.days} days`)
    )}</span>` +
    '</div>' +
    '<div class="table-wrap"><table class="data-table"><thead><tr>' +
    `<th>${esc(L('时间', 'Time'))}</th><th>${esc(L('类型', 'Type'))}</th><th>${esc(L('动作', 'Exercise'))}</th><th>${esc(L('数据', 'Values'))}</th><th>${esc(L('备注', 'Note'))}</th><th></th>` +
    `</tr></thead><tbody id="historyBody">${result.rows}</tbody></table></div>` +
    (result.count > state.history.limit
      ? '<div class="load-more">' +
        `<button class="btn btn-outline" data-action="history-more">${icon('chevron')}${esc(
          L(
            `显示更多（还有 ${result.count - state.history.limit} 组）`,
            `Show more (${result.count - state.history.limit} left)`
          )
        )}</button>` +
        '</div>'
      : '') +
    '</div>'
  );
}

export function renderHistoryBody(ctx: UiContext): { html: string; countText: string } {
  const result = historyResults(ctx);
  return {
    html: result.rows || `<tr><td colspan="6"><div class="empty">${esc(L('没有匹配的记录', 'No matching records'))}</div></td></tr>`,
    countText: L(`${result.count} 组 · ${result.days} 天`, `${result.count} sets · ${result.days} days`),
  };
}
