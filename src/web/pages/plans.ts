/*
 * plans.ts —— 训练计划：今日排期、逐组完成、计划编辑入口。
 * 完成状态按 `${exerciseId}#${setId}` 独立持久化，删记录也不会回退。
 */

import { TrainingPlanInstance } from '../../data/types';
import { getExerciseNameById } from '../../data/display';
import { icon } from '../icons';
import { UiContext } from '../context';
import {
  compactSetText,
  itemProgress,
  planProgress,
  planRuleText,
  plansForDay,
  setDoneDate,
} from '../calc';
import { L, esc, todayStr } from '../format';

function setPills(ctx: UiContext, plan: TrainingPlanInstance, item: TrainingPlanInstance['items'][number]): string {
  const unit = ctx.store.settings.unit;
  return item.sets
    .map((set, index) => {
      const done = !!setDoneDate(plan, item.exerciseId, set.id);
      const tip = compactSetText(ctx.store.config, item.category, set.fields, unit);
      return (
        `<button class="set-pill${done ? ' done' : ''}" ` +
        `data-action="toggle-plan-set" data-plan="${esc(plan.id)}" data-exercise="${esc(item.exerciseId)}" data-set="${esc(set.id)}" ` +
        `title="${esc(tip)}">${done ? icon('check', 'ic-sm') : index + 1}</button>`
      );
    })
    .join('');
}

function planCard(ctx: UiContext, plan: TrainingPlanInstance): string {
  const { config } = ctx.store;
  const progress = planProgress(plan);
  const today = todayStr();
  const isToday = plansForDay(config, today).some((item) => item.id === plan.id);
  const items = plan.items.filter((item) => item.enabled);

  const rows = items
    .slice(0, 5)
    .map((item) => {
      const name = getExerciseNameById(config.exercises, item.exerciseId) || item.exerciseId;
      const itemP = itemProgress(plan, item);
      return (
        '<div class="plan-preview-row">' +
        `<span style="min-width:64px">${esc(name)}</span>` +
        `<span class="bar-mini"><i style="width:${itemP.pct}%"></i></span>` +
        `<span class="faint num">${itemP.done}/${itemP.total}</span>` +
        '</div>'
      );
    })
    .join('');

  const extra = items.length > 5 ? `<div class="faint">+${items.length - 5} ${esc(L('个动作', 'more exercises'))}</div>` : '';

  return (
    '<div class="card plan-card">' +
    '<div class="card-head"><div>' +
    `<div class="plan-name">${esc(plan.name)}</div>` +
    `<div class="card-sub">${esc(planRuleText(plan))}</div>` +
    '</div>' +
    (isToday
      ? `<span class="pill pill-lime">${esc(L('今天', 'Today'))}</span>`
      : progress.pct >= 100 && progress.total > 0
        ? `<span class="pill pill-green">${esc(L('已完成', 'Done'))}</span>`
        : `<span class="pill">${progress.pct}%</span>`) +
    '</div>' +
    `<div class="plan-items-preview">${rows || `<div class="faint">${esc(L('还没有动作', 'No exercises yet'))}</div>`}${extra}</div>` +
    '<div class="plan-sets">' +
    items
      .slice(0, 4)
      .map(
        (item) =>
          '<div class="plan-item">' +
          `<span class="plan-item-name">${esc(getExerciseNameById(config.exercises, item.exerciseId) || item.exerciseId)}</span>` +
          `<span class="sets">${setPills(ctx, plan, item)}</span>` +
          `<span class="plan-item-meta">${item.sets.length} ${esc(L('组', 'sets'))}</span>` +
          `<button class="mini-btn" data-action="quick-record" data-exercise="${esc(item.exerciseId)}" title="${esc(L('记录这一项', 'Record this'))}">${icon('plus', 'ic-sm')}</button>` +
          '</div>'
      )
      .join('') +
    '</div>' +
    (plan.sourceNote ? `<div class="faint" style="margin-top:8px">${esc(L('来源', 'Source'))}：${esc(plan.sourceNote)}</div>` : '') +
    '<div class="plan-card-foot">' +
    `<button class="btn btn-primary btn-sm" data-action="quick-record" data-exercise="${esc(items[0]?.exerciseId ?? '')}" ${items.length ? '' : 'disabled'}>${icon('play', 'ic-sm')}${esc(L('开始训练', 'Start'))}</button>` +
    `<button class="btn btn-outline btn-sm" data-action="edit-plan" data-plan="${esc(plan.id)}">${icon('edit', 'ic-sm')}${esc(L('编辑', 'Edit'))}</button>` +
    `<button class="btn btn-ghost btn-sm" style="margin-left:auto" data-action="delete-plan" data-plan="${esc(plan.id)}">${icon('trash', 'ic-sm')}</button>` +
    '</div></div>'
  );
}

export function renderPlans(ctx: UiContext): string {
  const { config } = ctx.store;
  const plans = config.plans ?? [];
  const today = todayStr();
  const todayPlans = plansForDay(config, today);
  const nextPlan = todayPlans[0];

  const banner = nextPlan
    ? '<div class="today-banner">' +
      `<div class="icon">${icon('calendar')}</div>` +
      '<div><b>' +
      esc(L('今天：', 'Today: ')) +
      esc(nextPlan.name) +
      '</b><span>' +
      esc(planRuleText(nextPlan)) +
      ' · ' +
      esc(L('按组完成，完成状态独立保存', 'Tick sets as you go; completion is stored separately')) +
      '</span></div>' +
      `<button class="btn" data-action="quick-record" data-exercise="${esc(nextPlan.items.find((item) => item.enabled)?.exerciseId ?? '')}">${icon('play')}${esc(L('开始', 'Start'))}</button>` +
      '</div>'
    : '<div class="today-banner" style="background:linear-gradient(110deg,#3c4048,#26282e)">' +
      `<div class="icon">${icon('calendar')}</div>` +
      '<div><b>' +
      esc(L('今天没有排期计划', 'No plan scheduled today')) +
      '</b><span>' +
      esc(L('你仍然可以自由训练，或新建一个计划', 'Train freely, or create a new plan')) +
      '</span></div>' +
      `<button class="btn" data-action="new-plan">${icon('plus')}${esc(L('新建计划', 'New plan'))}</button>` +
      '</div>';

  const cards = plans.length
    ? plans.map((plan) => planCard(ctx, plan)).join('')
    : `<div class="card" style="grid-column:1/-1"><div class="empty">${esc(
        L('还没有训练计划。新建一个，把动作和组数提前排好。', 'No plans yet. Create one to lay out exercises and sets in advance.')
      )}<div style="margin-top:14px"><button class="btn btn-primary" data-action="new-plan">${icon('plus')}${esc(
        L('新建计划', 'New plan')
      )}</button></div></div></div>`;

  return (
    '<div class="page-head"><div><h2>' +
    esc(L('训练计划', 'Training plans')) +
    '</h2><p>' +
    esc(L('按方案逐组完成，完成态独立保存', 'Complete sets as planned; progress is kept separately')) +
    '</p></div><div class="head-actions">' +
    `<button class="btn btn-primary" data-action="new-plan">${icon('plus')}${esc(L('新建计划', 'New plan'))}</button>` +
    '</div></div>' +
    banner +
    `<div class="plan-grid">${cards}</div>`
  );
}

export function planCount(ctx: UiContext): number {
  return (ctx.store.config.plans ?? []).length;
}
