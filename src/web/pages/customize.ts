/*
 * customize.ts —— 自定义页：训练类型、字段、动作、肌肉、统计。
 * 所有编辑动作都打开弹窗（editors/*），保存后写回 WebStore。
 */

import { Exercise, FieldDef, Muscle, StatDef, TrainingType } from '../../data/types';
import { getExerciseName, getFieldLabel, getFieldUnit, getMuscleName, getTrainingTypeName } from '../../data/display';
import { icon } from '../icons';
import { UiContext } from '../context';
import { state } from '../state';
import type { CustomTab } from '../state';
import { statAssocText, statFormulaText, typeName } from '../calc';
import { L, esc } from '../format';
import { DEFAULT_HEATMAP_SCALE, colorToCss } from '../../data/heatmapDefaults';

function fieldTypeText(field: FieldDef): string {
  switch (field.inputType) {
    case 'number':
      return L('数字', 'Number');
    case 'duration':
      return L('时长', 'Duration');
    case 'text':
      return L('文本', 'Text');
    case 'select':
      return L('下拉', 'Select');
    case 'computed':
      return L('派生', 'Derived');
  }
}

function fieldExtra(field: FieldDef, unit: 'kg' | 'lb'): string {
  if (field.inputType === 'computed') return field.formula ? `<span class="mono faint">${esc(field.formula)}</span>` : '—';
  const bits: string[] = [];
  if (field.required) bits.push(L('必填', 'Required'));
  if (field.mass) bits.push(L('质量', 'Mass'));
  const unitText = getFieldUnit(field, unit);
  if (unitText) bits.push(unitText);
  return bits.length ? esc(bits.join(' · ')) : '<span class="faint">—</span>';
}

function typesTab(ctx: UiContext): string {
  const { config, settings } = ctx.store;
  if (config.trainingTypes.length === 0) {
    return `<div class="empty">${esc(L('还没有训练类型', 'No training types yet'))}<div style="margin-top:12px"><button class="btn btn-primary" data-action="edit-type" data-type="">${icon('plus')}${esc(L('新建类型', 'New type'))}</button></div></div>`;
  }
  const cards = config.trainingTypes
    .map((type: TrainingType) => {
      const rows = type.fields
        .map(
          (field) =>
            '<tr>' +
            `<td><b>${esc(getFieldLabel(field))}</b></td>` +
            `<td class="mono faint">${esc(field.key)}</td>` +
            `<td>${esc(fieldTypeText(field))}</td>` +
            `<td>${fieldExtra(field, settings.unit)}</td>` +
            '<td>' +
            `<button class="mini-btn" data-action="edit-field" data-type="${esc(type.id)}" data-field="${esc(field.key)}" title="${esc(L('编辑字段', 'Edit field'))}">${icon('edit', 'ic-sm')}</button>` +
            `<button class="mini-btn danger" data-action="delete-field" data-type="${esc(type.id)}" data-field="${esc(field.key)}" title="${esc(L('删除字段', 'Delete field'))}">${icon('trash', 'ic-sm')}</button>` +
            '</td></tr>'
        )
        .join('');
      return (
        '<div class="card type-card">' +
        '<div class="type-head">' +
        `<b>${esc(getTrainingTypeName(type))}</b>` +
        `<span class="pill">${esc(type.id)}</span>` +
        `<span class="faint">${type.fields.length} ${esc(L('个字段', 'fields'))}</span>` +
        '<span class="spacer"></span>' +
        `<button class="btn btn-outline btn-sm" data-action="edit-type" data-type="${esc(type.id)}">${icon('edit', 'ic-sm')}${esc(L('编辑', 'Edit'))}</button>` +
        `<button class="btn btn-ghost btn-sm" data-action="delete-type" data-type="${esc(type.id)}">${icon('trash', 'ic-sm')}</button>` +
        '</div>' +
        '<div class="table-wrap"><table class="field-table"><thead><tr>' +
        `<th>${esc(L('字段', 'Field'))}</th><th>key</th><th>${esc(L('类型', 'Type'))}</th><th>${esc(L('属性', 'Options'))}</th><th></th>` +
        `</tr></thead><tbody>${rows || `<tr><td colspan="5"><div class="faint">${esc(L('还没有字段', 'No fields yet'))}</div></td></tr>`}</tbody></table></div>` +
        `<div class="add-row"><button class="btn btn-outline btn-sm" data-action="edit-field" data-type="${esc(type.id)}" data-field="">${icon('plus', 'ic-sm')}${esc(L('添加字段', 'Add field'))}</button></div>` +
        '</div>'
      );
    })
    .join('');
  return cards;
}

function exerciseMatches(ctx: UiContext, exercise: Exercise): boolean {
  const term = state.custom.exerciseSearch.trim().toLowerCase();
  if (!term) return true;
  const name = getExerciseName(exercise).toLowerCase();
  const type = typeName(ctx.store.config, exercise.category).toLowerCase();
  return name.includes(term) || type.includes(term);
}

export function exercisesBody(ctx: UiContext): string {
  const { config } = ctx.store;
  const list = config.exercises.filter((exercise) => exerciseMatches(ctx, exercise));
  if (config.exercises.length === 0) {
    return `<div class="empty">${esc(L('还没有动作', 'No exercises yet'))}<div style="margin-top:12px"><button class="btn btn-primary" data-action="edit-exercise" data-exercise="">${icon('plus')}${esc(L('新建动作', 'New exercise'))}</button></div></div>`;
  }
  const grid = list
    .map((exercise) => {
      const primary =
        exercise.muscles
          ?.filter((muscle) => muscle.role === 'primary')
          .map((muscle) => getMuscleName(config.muscles.find((item) => item.id === muscle.muscleId)) || muscle.muscleId)
          .join(' / ') || L('未标注主练', 'No primary muscle');
      const secondary =
        exercise.muscles
          ?.filter((muscle) => muscle.role === 'secondary')
          .map((muscle) => getMuscleName(config.muscles.find((item) => item.id === muscle.muscleId)) || muscle.muscleId)
          .join(' / ') || '';
      return (
        '<div class="ex-card">' +
        '<div class="ex-card-head">' +
        `<b>${esc(getExerciseName(exercise))}</b>` +
        `<span class="pill pill-soft">${esc(typeName(config, exercise.category))}</span>` +
        '</div>' +
        `<div class="ex-muscles"><span>${esc(L('主练', 'Primary'))}：${esc(primary)}</span>` +
        (secondary ? `<span>${esc(L('辅练', 'Secondary'))}：${esc(secondary)}</span>` : '') +
        '</div>' +
        '<div class="ex-card-foot">' +
        `<button class="mini-btn" data-action="edit-exercise" data-exercise="${esc(exercise.id)}">${icon('edit', 'ic-sm')}</button>` +
        `<button class="mini-btn danger" data-action="delete-exercise" data-exercise="${esc(exercise.id)}">${icon('trash', 'ic-sm')}</button>` +
        '</div></div>'
      );
    })
    .join('');
  return (
    `<div class="ex-grid">${grid || `<div class="empty" style="grid-column:1/-1">${esc(L('没有匹配的动作', 'No matching exercises'))}</div>`}</div>`
  );
}

function exercisesTab(ctx: UiContext): string {
  return (
    '<div class="mini-toolbar">' +
    '<div class="search-inline">' +
    icon('search') +
    `<input class="input" type="search" data-custom-search="exercise" value="${esc(state.custom.exerciseSearch)}" placeholder="${esc(
      L('搜索动作 / 类型', 'Search exercise / type')
    )}" /></div>` +
    '<span class="muted-mini">' +
    esc(L(`${ctx.store.config.exercises.length} 个动作`, `${ctx.store.config.exercises.length} exercises`)) +
    '</span>' +
    '<button class="btn btn-primary btn-sm" style="margin-left:auto" data-action="edit-exercise" data-exercise="">' +
    icon('plus', 'ic-sm') +
    esc(L('新建动作', 'New exercise')) +
    '</button></div>' +
    `<div id="exerciseGrid">${exercisesBody(ctx)}</div>`
  );
}

function scalePreview(muscle: Muscle): string {
  const levels = muscle.heatmapLevels?.length ? muscle.heatmapLevels : DEFAULT_HEATMAP_SCALE;
  return (
    '<div class="scale">' +
    levels
      .map((level) => `<i style="background:${colorToCss(level.color)}" title="${esc(String(level.max ?? '∞'))}"></i>`)
      .join('') +
    '</div>'
  );
}

function muscleMatches(ctx: UiContext, muscle: Muscle): boolean {
  const term = state.custom.muscleSearch.trim().toLowerCase();
  if (!term) return true;
  return (getMuscleName(muscle) || muscle.id).toLowerCase().includes(term) || muscle.id.toLowerCase().includes(term);
}

export function musclesBody(ctx: UiContext): string {
  const { config } = ctx.store;
  const list = config.muscles.filter((muscle) => muscleMatches(ctx, muscle));
  if (config.muscles.length === 0) {
    return `<div class="empty">${esc(L('还没有肌肉', 'No muscles yet'))}<div style="margin-top:12px"><button class="btn btn-primary" data-action="edit-muscle" data-muscle="">${icon('plus')}${esc(L('新建肌肉', 'New muscle'))}</button></div></div>`;
  }
  const cards = list
    .map((muscle) => {
      const paths = muscle.svgRegionIds?.length ?? 0;
      const metric = muscle.heatmapMetric
        ? config.statistics.find((stat) => stat.id === muscle.heatmapMetric)?.name
        : '';
      return (
        '<div class="muscle-card">' +
        '<div class="head">' +
        `<b>${esc(getMuscleName(muscle) || muscle.id)}</b>` +
        `<span class="pill ${muscle.contributesToCoverage ? 'pill-green' : ''}">${esc(
          muscle.contributesToCoverage ? L('计入覆盖', 'Covered') : L('不计入', 'Excluded')
        )}</span>` +
        '</div>' +
        scalePreview(muscle) +
        `<div class="faint">${esc(L(`${paths} 条 SVG 路径`, `${paths} SVG paths`))}` +
        (metric ? ` · ${esc(metric)}` : '') +
        '</div>' +
        `<div class="faint">${esc(L('休息阈值', 'Rest threshold'))} ${muscle.restThresholdDays ?? 7} ${esc(L('天', 'days'))}` +
        (muscle.heatmapRange ? ` · ${esc(muscle.heatmapRange)}` : '') +
        '</div>' +
        '<div class="muscle-card-foot">' +
        `<button class="btn btn-outline btn-sm" data-action="edit-muscle" data-muscle="${esc(muscle.id)}">${icon('edit', 'ic-sm')}${esc(L('编辑', 'Edit'))}</button>` +
        `<button class="mini-btn danger" data-action="delete-muscle" data-muscle="${esc(muscle.id)}">${icon('trash', 'ic-sm')}</button>` +
        '</div></div>'
      );
    })
    .join('');
  return `<div class="muscle-grid">${cards || `<div class="empty" style="grid-column:1/-1">${esc(L('没有匹配的肌肉', 'No matching muscles'))}</div>`}</div>`;
}

function musclesTab(ctx: UiContext): string {
  return (
    '<div class="mini-toolbar">' +
    '<div class="search-inline">' +
    icon('search') +
    `<input class="input" type="search" data-custom-search="muscle" value="${esc(state.custom.muscleSearch)}" placeholder="${esc(
      L('搜索肌肉', 'Search muscle')
    )}" /></div>` +
    '<span class="muted-mini">' +
    esc(L(`${ctx.store.config.muscles.length} 块肌肉`, `${ctx.store.config.muscles.length} muscles`)) +
    '</span>' +
    '<button class="btn btn-ghost btn-sm" data-action="apply-mapping" data-tier="default">' +
    esc(L('套用默认映射', 'Default mapping')) +
    '</button>' +
    '<button class="btn btn-ghost btn-sm" data-action="apply-mapping" data-tier="minimal">' +
    esc(L('精简映射', 'Minimal mapping')) +
    '</button>' +
    '<button class="btn btn-primary btn-sm" style="margin-left:auto" data-action="edit-muscle" data-muscle="">' +
    icon('plus', 'ic-sm') +
    esc(L('新建肌肉', 'New muscle')) +
    '</button></div>' +
    `<div id="muscleGrid">${musclesBody(ctx)}</div>`
  );
}

function statCard(ctx: UiContext, stat: StatDef): string {
  const scale = stat.heatmapScale?.length ? stat.heatmapScale : DEFAULT_HEATMAP_SCALE;
  return (
    '<div class="stat-edit-card">' +
    '<div class="stat-edit-head">' +
    `<b>${esc(stat.name)}</b>` +
    `<span class="pill pill-soft">${esc(statAssocText(ctx.store.config, stat))}</span>` +
    (stat.unit ? `<span class="pill">${esc(stat.unit)}</span>` : '') +
    (stat.heatmapDefault ? `<span class="pill pill-lime">${esc(L('默认热力图指标', 'Default heatmap'))}</span>` : '') +
    '<span style="margin-left:auto"></span>' +
    `<button class="switch${stat.enabled ? ' on' : ''}" data-action="toggle-stat" data-stat="${esc(stat.id)}" title="${esc(
      L('启用 / 停用', 'Enable / disable')
    )}"></button>` +
    `<button class="mini-btn" data-action="edit-stat" data-stat="${esc(stat.id)}">${icon('edit', 'ic-sm')}</button>` +
    `<button class="mini-btn danger" data-action="delete-stat" data-stat="${esc(stat.id)}">${icon('trash', 'ic-sm')}</button>` +
    '</div>' +
    `<div class="formula">${esc(statFormulaText(stat))}</div>` +
    '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">' +
    '<div class="scale" style="width:120px;margin:0">' +
    scale.map((level) => `<i style="background:${colorToCss(level.color)}"></i>`).join('') +
    '</div>' +
    `<span class="faint">${esc(L('热力图分档', 'Heatmap bands'))}</span></div>` +
    '</div>'
  );
}

function statsTab(ctx: UiContext): string {
  const stats = ctx.store.config.statistics;
  return (
    '<div class="mini-toolbar">' +
    `<span class="muted-mini">${esc(L(`${stats.length} 个统计指标`, `${stats.length} statistics`))}</span>` +
    '<button class="btn btn-primary btn-sm" style="margin-left:auto" data-action="edit-stat" data-stat="">' +
    icon('plus', 'ic-sm') +
    esc(L('新建统计', 'New statistic')) +
    '</button></div>' +
    (stats.length
      ? stats.map((stat) => statCard(ctx, stat)).join('')
      : `<div class="empty">${esc(L('还没有统计指标', 'No statistics yet'))}</div>`)
  );
}

function plansTab(ctx: UiContext): string {
  const plans = ctx.store.config.plans ?? [];
  return (
    '<div class="mini-toolbar">' +
    `<span class="muted-mini">${esc(L(`${plans.length} 个计划`, `${plans.length} plans`))}</span>` +
    '<button class="btn btn-primary btn-sm" style="margin-left:auto" data-action="new-plan">' +
    icon('plus', 'ic-sm') +
    esc(L('新建计划', 'New plan')) +
    '</button></div>' +
    (plans.length
      ? '<div class="mini-list">' +
        plans
          .map(
            (plan) =>
              '<div class="mini-item">' +
              `<b>${esc(plan.name)}</b>` +
              `<span class="faint">${esc(plan.items.filter((item) => item.enabled).length)} ${esc(L('个动作', 'exercises'))}</span>` +
              `<span class="val faint">${esc(
                plan.timeRule.type === 'date'
                  ? plan.timeRule.date ?? ''
                  : L('每周', 'Weekly') + ' ' + (plan.timeRule.weekdays ?? []).join('/')
              )}</span>` +
              `<button class="mini-btn" data-action="edit-plan" data-plan="${esc(plan.id)}">${icon('edit', 'ic-sm')}</button>` +
              '</div>'
          )
          .join('') +
        '</div>'
      : `<div class="empty">${esc(L('还没有训练计划', 'No training plans yet'))}</div>`)
  );
}

const TABS: { id: CustomTab; label: [string, string]; icon: string }[] = [
  { id: 'types', label: ['训练类型', 'Types'], icon: 'layers' },
  { id: 'exercises', label: ['动作库', 'Exercises'], icon: 'dumbbell' },
  { id: 'muscles', label: ['肌肉与映射', 'Muscles'], icon: 'activity' },
  { id: 'stats', label: ['统计指标', 'Statistics'], icon: 'chart' },
  { id: 'plans', label: ['训练计划', 'Plans'], icon: 'calendar' },
];

export function renderCustomBody(ctx: UiContext): string {
  const tab = state.custom.tab;
  if (tab === 'exercises') return exercisesTab(ctx);
  if (tab === 'muscles') return musclesTab(ctx);
  if (tab === 'stats') return statsTab(ctx);
  if (tab === 'plans') return plansTab(ctx);
  return typesTab(ctx);
}

export function renderCustomize(ctx: UiContext): string {
  const tab = state.custom.tab;
  return (
    '<div class="page-head"><div><h2>' +
    esc(L('自定义', 'Customize')) +
    '</h2><p>' +
    esc(L('类型、动作、肌肉、统计，全部由你定义', 'Define types, exercises, muscles and statistics yourself')) +
    '</p></div></div>' +
    '<div class="custom-tabs">' +
    TABS.map(
      (item) =>
        `<button class="custom-tab${tab === item.id ? ' on' : ''}" data-page="customize" data-tab="${item.id}">` +
        icon(item.icon, 'ic-sm') +
        esc(L(item.label[0], item.label[1])) +
        '</button>'
    ).join('') +
    '</div>' +
    `<div id="customBody">${renderCustomBody(ctx)}</div>`
  );
}
