/*
 * dashboard.ts —— 总览页：今天的训练状态、计划进度、趋势与快速记录。
 * 所有数值都由真实记录计算，不在页面层写死示例数据。
 */

import { LogRow } from '../../data/types';
import { getExerciseNameById } from '../../data/display';
import { icon } from '../icons';
import { UiContext } from '../context';
import { state } from '../state';
import {
  bestStreak,
  compactSetText,
  dateSeries,
  logExerciseName,
  metricOfDay,
  planProgress,
  plansForDay,
  setDoneDate,
  todayPlan,
  volumeOfLogs,
} from '../calc';
import {
  L,
  esc,
  addDays,
  dateLong,
  dateOf,
  dayLabel,
  formatInt,
  formatNumber,
  spanMinutes,
  spanSeconds,
  streakDays,
  timeOf,
  todayStr,
} from '../format';
import { computeHeatmap, anatomyHTML, defaultHeatmapStat, legendHTML, ranking } from '../heatmap';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 11) return L('早上好', 'Good morning');
  if (hour < 18) return L('下午好', 'Good afternoon');
  return L('晚上好', 'Good evening');
}

function pctChange(current: number, previous: number): [string, string] {
  if (!Number.isFinite(previous) || previous <= 0) {
    return current > 0 ? ['delta-up', L('新增', 'New')] : ['faint', '—'];
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return ['faint', '0%'];
  return pct > 0 ? ['delta-up', `↑ ${pct}%`] : ['delta-down', `↓ ${Math.abs(pct)}%`];
}

function kpi(
  iconName: string,
  tone: string,
  label: string,
  value: string,
  unit: string,
  delta: [string, string],
  foot: string,
  hint?: string
): string {
  return (
    `<div class="card kpi"${hint ? ` title="${esc(hint)}"` : ''}>` +
    '<div class="kpi-top"><div>' +
    `<div class="kpi-label">${esc(label)}</div>` +
    `<div class="kpi-value">${value}${unit ? `<small>${esc(unit)}</small>` : ''}</div>` +
    `</div><div class="kpi-icon ${tone}">${icon(iconName)}</div></div>` +
    `<div class="kpi-foot"><span class="${delta[0]}">${esc(delta[1])}</span><span>${esc(foot)}</span></div>` +
    '</div>'
  );
}

function setPill(planId: string, exerciseId: string, setId: string, index: number, done: boolean, tip: string): string {
  return (
    `<button class="set-pill${done ? ' done' : ''}" ` +
    `data-action="toggle-plan-set" data-plan="${esc(planId)}" data-exercise="${esc(exerciseId)}" data-set="${esc(setId)}" ` +
    `title="${esc(tip)}">${done ? icon('check', 'ic-sm') : index + 1}</button>`
  );
}

function todayPlanCard(ctx: UiContext, today: string): string {
  const { config } = ctx.store;
  const unit = ctx.store.settings.unit;
  const plan = todayPlan(config, today);

  if (!plan) {
    const nextPlans = plansForDay(config, today);
    return (
      '<div class="card">' +
      '<div class="card-head"><div><div class="card-title">' +
      icon('target') +
      esc(L('今日安排', 'Today')) +
      '</div><div class="card-sub">' +
      esc(L('今天没有排期计划', 'No plan scheduled today')) +
      '</div></div>' +
      `<span class="pill">${esc(nextPlans.length ? L('待安排', 'Unscheduled') : L('休息日', 'Rest day'))}</span></div>` +
      `<div class="empty">${esc(L('可以自由训练，或去计划页安排一周节奏。', 'Train freely, or set up a weekly rhythm in Plans.'))}</div>` +
      `<div style="margin-top:12px"><button class="btn btn-outline" data-page="plans">${icon('calendar')}${esc(L('管理训练计划', 'Manage plans'))}</button></div>` +
      '</div>'
    );
  }

  const progress = planProgress(plan);
  const enabledItems = plan.items.filter((item) => item.enabled);
  const next = progress.next;
  const nextText = next
    ? `${getExerciseNameById(config.exercises, next.item.exerciseId) || next.item.exerciseId} · ${compactSetText(
        config,
        next.item.category,
        next.set.fields,
        unit
      )}`
    : L('全部完成', 'All sets complete');

  const rows = enabledItems
    .map((item) => {
      const exercise = getExerciseNameById(config.exercises, item.exerciseId) || item.exerciseId;
      const done = item.sets.filter((set) =>
        setDoneDate(plan, item.exerciseId, set.id)
      ).length;
      const pills = item.sets
        .map((set, index) =>
          setPill(
            plan.id,
            item.exerciseId,
            set.id,
            index,
            !!setDoneDate(plan, item.exerciseId, set.id),
            `${exercise} · ${compactSetText(config, item.category, set.fields, unit)}`
          )
        )
        .join('');
      return (
        '<div class="plan-item">' +
        `<span class="plan-item-name">${esc(exercise)}</span>` +
        `<span class="sets">${pills}</span>` +
        `<span class="plan-item-meta">${done}/${item.sets.length} ${esc(L('组', 'sets'))}</span>` +
        `<button class="mini-btn" data-action="quick-record" data-exercise="${esc(item.exerciseId)}" title="${esc(L('记录这一项', 'Record this'))}">${icon('plus', 'ic-sm')}</button>` +
        '</div>'
      );
    })
    .join('');

  return (
    '<div class="card">' +
    '<div class="card-head"><div><div class="card-title">' +
    icon('target') +
    esc(L('今日安排', 'Today')) +
    `</div><div class="card-sub">${esc(plan.name)} · ${esc(planRuleShort(plan))}</div></div>` +
    `<span class="pill ${progress.done === progress.total && progress.total > 0 ? 'pill-green' : 'pill-soft'}">${esc(
      progress.done === progress.total && progress.total > 0 ? L('已完成', 'Done') : L('进行中', 'In progress')
    )}</span></div>` +
    '<div class="plan-progress">' +
    `<div class="ring" style="--p:${progress.pct}"><b>${progress.pct}%</b></div>` +
    '<div>' +
    `<div style="font-size:13px;font-weight:700">${esc(L('已完成', 'Completed'))} ${progress.done} / ${progress.total} ${esc(L('组', 'sets'))}</div>` +
    `<div class="muted" style="margin-top:2px">${esc(L('下一个', 'Next'))}：${esc(nextText)}</div>` +
    `<div style="display:flex;gap:7px;margin-top:9px">` +
    `<button class="btn btn-primary btn-sm" data-page="record">${esc(L('继续训练', 'Continue'))}</button>` +
    `<button class="btn btn-ghost btn-sm" data-page="plans">${esc(L('查看计划', 'View plans'))}</button>` +
    '</div></div></div>' +
    `<div class="plan-items">${rows}</div>` +
    '</div>'
  );
}

function planRuleShort(plan: { timeRule: { type: 'date' | 'weekday'; date?: string; weekdays?: number[] } }): string {
  if (plan.timeRule.type === 'date') return plan.timeRule.date || '';
  const names = [L('一', 'Mon'), L('二', 'Tue'), L('三', 'Wed'), L('四', 'Thu'), L('五', 'Fri'), L('六', 'Sat'), L('日', 'Sun')];
  const days = [...new Set(plan.timeRule.weekdays ?? [])].sort((a, b) => a - b);
  return days.length ? L(`每周 ${days.map((d) => names[d - 1]).join(' / ')}`, days.map((d) => names[d - 1]).join(', ')) : '';
}

function quickRecordCard(ctx: UiContext, today: string): string {
  const { config, logs, settings } = ctx.store;
  const unit = settings.unit;
  const sorted = [...logs].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const recent: LogRow[] = [];
  const seen = new Set<string>();
  for (const log of sorted) {
    if (!log.exerciseId || seen.has(log.exerciseId)) continue;
    seen.add(log.exerciseId);
    recent.push(log);
    if (recent.length >= 5) break;
  }

  const chips = recent.length
    ? recent
        .map(
          (log) =>
            `<button class="quick-chip" data-action="quick-record" data-exercise="${esc(log.exerciseId ?? '')}">${esc(
              logExerciseName(config, log)
            )}</button>`
        )
        .join('')
    : `<button class="quick-chip" data-page="record">${esc(L('开始第一组', 'Start first set'))}</button>`;

  const last = sorted[0];
  const lastBlock = last
    ? '<div class="quick-record-main">' +
      `<div class="faint">${esc(L('上次', 'Last'))} · ${esc(dayLabel(dateOf(last.timestamp)))} ${esc(timeOf(last.timestamp))}</div>` +
      `<div class="big">${esc(logExerciseName(config, last))} ${esc(compactSetText(config, last.category, last.fields, unit))}</div>` +
      `<button class="btn btn-lime" data-action="repeat-last" data-log="${esc(last.id)}">${icon('plus')}${esc(L('沿用并记录', 'Repeat & record'))}</button>` +
      '</div>'
    : '';

  const todayDone = logs.filter((log) => dateOf(log.timestamp) === today).length;

  return (
    '<div class="card">' +
    '<div class="card-head"><div><div class="card-title">' +
    icon('zap') +
    esc(L('快速记录', 'Quick record')) +
    '</div><div class="card-sub">' +
    esc(L('沿用上次数值，点一下就开练', 'Reuse last values and start instantly')) +
    '</div></div></div>' +
    `<div class="quick-chips">${chips}</div>` +
    lastBlock +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:13px;border-top:1px solid var(--line)">' +
    `<span class="faint">${esc(L(`今天已完成 ${todayDone} 组`, `${todayDone} sets today`))}</span>` +
    `<button class="link-btn" data-page="history">${esc(L('查看日志', 'View log'))} ${icon('arrowRight', 'ic-sm')}</button>` +
    '</div></div>'
  );
}

function trendCard(ctx: UiContext): string {
  const { config, logs } = ctx.store;
  const days = dateSeries(7);
  const values = days.map((day) => {
    const dayLogs = logs.filter((log) => dateOf(log.timestamp) === day);
    return metricOfDay(config, dayLogs, state.trend);
  });
  const max = Math.max(1, ...values);
  const bars = days
    .map((day, index) => {
      const value = values[index];
      const height = Math.max(3, Math.round((value / max) * 100));
      const isToday = day === todayStr();
      const label = isToday ? L('今', 'T') : dayLabel(day).slice(-2);
      return (
        '<div class="bar-col" title="' +
        esc(`${dateLong(day)} · ${formatNumber(value)}`) +
        '">' +
        `<div class="bar${isToday ? ' top' : ''}" style="height:${height}%"></div>` +
        `<span class="bar-label">${esc(label)}</span></div>`
      );
    })
    .join('');

  const metricLabel =
    state.trend === 'sets' ? L('组数', 'Sets') : state.trend === 'volume' ? L('训练量', 'Volume') : L('跨度', 'Span');

  return (
    '<div class="card">' +
    '<div class="card-head"><div><div class="card-title">' +
    icon('chart') +
    esc(L('本周趋势', 'This week')) +
    `</div><div class="card-sub">${esc(L('每日', 'Daily'))} ${esc(metricLabel)} · ${esc(days[0].slice(5))} – ${esc(days[6].slice(5))}</div></div>` +
    '<div class="seg">' +
    ['sets', 'volume', 'time']
      .map(
        (metric) =>
          `<button class="${state.trend === metric ? 'on' : ''}" data-action="trend" data-trend="${metric}">${esc(
            metric === 'sets' ? L('组数', 'Sets') : metric === 'volume' ? L('训练量', 'Volume') : L('跨度', 'Span')
          )}</button>`
      )
      .join('') +
    '</div></div>' +
    `<div class="bars">${bars}</div>` +
    `<div style="display:flex;justify-content:space-between;margin-top:10px"><span class="faint">${esc(
      L('今日', 'Today')
    )} ${esc(formatNumber(values[6]))}</span><span class="pill pill-green">${esc(L('近 7 天', 'Last 7 days'))}</span></div>` +
    '</div>'
  );
}

function bodyLoadCard(ctx: UiContext): string {
  const { config, logs } = ctx.store;
  const stat = defaultHeatmapStat(config);
  const model = computeHeatmap(config, logs, stat, '7d');
  const top = ranking(model, 4);
  const max = Math.max(1, ...top.map((entry) => entry.value));

  const rows = top.length
    ? top
        .map(
          (entry) =>
            '<div class="muscle-row">' +
            `<span class="nm">${esc(entry.name)}</span>` +
            `<span class="track"><i style="width:${Math.round((entry.value / max) * 100)}%;background:${entry.color}"></i></span>` +
            `<span class="v">${esc(formatNumber(entry.value))}</span></div>`
        )
        .join('')
    : `<div class="faint">${esc(L('最近 7 天还没有记录', 'No training in the last 7 days'))}</div>`;

  return (
    '<div class="card">' +
    '<div class="card-head"><div><div class="card-title">' +
    icon('activity') +
    esc(L('身体负荷', 'Body load')) +
    `</div><div class="card-sub">${esc(L('最近 7 天', 'Last 7 days'))} · ${esc(stat?.name ?? '')}</div></div>` +
    `<button class="link-btn" data-page="analysis" data-tab="heatmap">${esc(L('完整热力图', 'Full heatmap'))} ${icon('arrowRight', 'ic-sm')}</button></div>` +
    '<div class="body-mini">' +
    anatomyHTML('front', model, 'body-svg anatomy') +
    '<div style="flex:1"><div class="muscle-list">' +
    rows +
    '</div>' +
    legendHTML(model, true) +
    '</div></div></div>'
  );
}

function recentCard(ctx: UiContext): string {
  const { config, logs, settings } = ctx.store;
  const today = todayStr();
  const sorted = [...logs].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, 6);
  const todayCount = logs.filter((log) => dateOf(log.timestamp) === today).length;
  const unit = settings.unit;

  const rows = sorted.length
    ? sorted
        .map((log) => {
          const time = dateOf(log.timestamp) === today ? timeOf(log.timestamp) : `${dayLabel(dateOf(log.timestamp))} ${timeOf(log.timestamp)}`;
          return (
            '<tr>' +
            `<td class="faint num" style="white-space:nowrap">${esc(time)}</td>` +
            `<td><b>${esc(logExerciseName(config, log))}</b></td>` +
            `<td>${esc(compactSetText(config, log.category, log.fields, unit))}</td>` +
            `<td>${log.plan ? `<span class="pill">${esc(log.plan)}</span>` : '<span class="faint">—</span>'}</td>` +
            `<td style="text-align:right"><button class="mini-btn" data-action="edit-log" data-log="${esc(log.id)}" title="${esc(L('编辑', 'Edit'))}">${icon('edit', 'ic-sm')}</button></td>` +
            '</tr>'
          );
        })
        .join('')
    : `<tr><td colspan="5"><div class="empty">${esc(L('还没有记录，先记下第一组吧。', 'No sets yet. Record your first one.'))}</div></td></tr>`;

  return (
    '<div class="card" style="margin-top:16px">' +
    '<div class="card-head"><div><div class="card-title">' +
    icon('list') +
    esc(L('最近记录', 'Recent sets')) +
    `</div><div class="card-sub">${esc(L(`今天已记录 ${todayCount} 组`, `${todayCount} sets today`))}</div></div>` +
    `<button class="link-btn" data-page="history">${esc(L('查看全部', 'View all'))} ${icon('arrowRight', 'ic-sm')}</button></div>` +
    '<div class="table-wrap"><table class="recent-table"><thead><tr>' +
    `<th>${esc(L('时间', 'Time'))}</th><th>${esc(L('动作', 'Exercise'))}</th><th>${esc(L('数据', 'Values'))}</th><th>${esc(L('计划', 'Plan'))}</th><th></th>` +
    `</tr></thead><tbody>${rows}</tbody></table></div></div>`
  );
}

export function renderDashboard(ctx: UiContext): string {
  const { config, logs, settings } = ctx.store;
  const today = todayStr();
  const yesterday = addDays(today, -1);
  const todayLogs = logs.filter((log) => dateOf(log.timestamp) === today);
  const yesterdayLogs = logs.filter((log) => dateOf(log.timestamp) === yesterday);

  const todayVolume = volumeOfLogs(config, todayLogs);
  const yesterdayVolume = volumeOfLogs(config, yesterdayLogs);
  const unit = settings.unit;
  const volumeDisplay = unit === 'lb' ? todayVolume * 2.2 : todayVolume;
  const streak = streakDays(logs);
  const best = bestStreak(logs);
  const span = spanSeconds(todayLogs);
  const spanYesterday = spanSeconds(yesterdayLogs);
  const weekCount = logs.filter((log) => dateOf(log.timestamp) >= dateSeries(7)[0]).length;
  const demoBanner = logs.length
    ? ''
    : '<div class="card demo-banner">' +
      `<div class="demo-banner-text"><b>${esc(L('第一次来？', 'First time here?'))}</b><span>${esc(
        L(
          '现在还没有训练记录，统计与热力图都是空的。可以载入两周演示数据，直接看到完整效果。',
          'There are no logs yet, so stats and the heatmap are empty. Load two weeks of demo data to see the full picture.'
        )
      )}</span></div>` +
      `<button class="btn btn-primary btn-sm" data-action="seed-demo">${icon('zap', 'ic-sm')}${esc(
        L('载入演示数据', 'Load demo data')
      )}</button>` +
      '</div>';

  return (
    '<section class="hero"><div>' +
    `<div class="eyebrow">${esc(dateLong(today))}</div>` +
    `<h2>${esc(greeting())}，<span class="hl">${esc(L('今天练点什么？', 'what are we training?'))}</span></h2>` +
    `<p>${esc(L('连续训练', 'Streak'))} <b>${streak}</b> ${esc(L('天', 'days'))} · ${esc(
      L('本周已完成', 'This week')
    )} <b>${formatInt(weekCount)}</b> ${esc(L('组', 'sets'))} · ${esc(L('最佳连续', 'Best streak'))} <b>${best}</b> ${esc(L('天', 'days'))}</p>` +
    '</div><div class="hero-actions">' +
    `<span class="pill ${todayLogs.length ? 'pill-green' : 'pill-lime'}"><span class="dot"></span>${esc(
      todayLogs.length ? L('今日已记录', 'Logged today') : L('今日未记录', 'Not logged yet')
    )}</span>` +
    `<button class="btn btn-primary" data-page="record">${icon('plus')}${esc(L('记录一组', 'Log a set'))}</button>` +
    '</div></section>' +
    demoBanner +
    '<div class="kpi-grid">' +
    kpi('layers', '', L('今日组数', 'Sets today'), formatInt(todayLogs.length), L('组', 'sets'), pctChange(todayLogs.length, yesterdayLogs.length), L(`昨日 ${yesterdayLogs.length} 组`, `Yesterday ${yesterdayLogs.length}`)) +
    kpi('dumbbell', 'green', L('今日训练量', 'Volume today'), formatInt(volumeDisplay), unit, pctChange(todayVolume, yesterdayVolume), L('次数 × 重量', 'Reps × weight'), L('训练量 = Σ(次数 × 重量)，只统计力量训练记录', 'Volume = Σ(reps × weight), strength logs only')) +
    kpi('timer', 'orange', L('训练跨度', 'Session span'), formatInt(spanMinutes(span)), L('分钟', 'min'), pctChange(span, spanYesterday), L('首组到最后记录', 'First to last'), L('当天最后一组时间 − 当天第一组时间；只有一条记录时取该条的时长字段', 'Last set time − first set time; a single log falls back to its duration field')) +
    kpi('flame', 'lime', L('连续训练', 'Streak'), formatInt(streak), L('天', 'days'), ['delta-up', best > 0 ? L(`最佳 ${best} 天`, `Best ${best}d`) : '—'], L('按自然日计算', 'Calendar days')) +
    '</div>' +
    '<div class="dash-grid">' +
    todayPlanCard(ctx, today) +
    quickRecordCard(ctx, today) +
    '</div>' +
    '<div class="dash-grid-2">' +
    trendCard(ctx) +
    bodyLoadCard(ctx) +
    '</div>' +
    recentCard(ctx)
  );
}
