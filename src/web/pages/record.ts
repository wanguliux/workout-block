/*
 * record.ts —— 记录页：类型 → 动作 → 动态字段 → 保存。
 * 表单草稿保存在 state.record，输入时就地刷新派生字段，避免整页重渲染丢焦点。
 */

import { LogRow, TrainingType } from '../../data/types';
import { getExerciseNameById, getTrainingTypeName } from '../../data/display';
import { icon } from '../icons';
import { UiContext } from '../context';
import { state } from '../state';
import { compactSetText, exercisesOfType, logExerciseName, sortLogsDesc, typeOf } from '../calc';
import { L, esc, dayLabel, dateOf, timeOf, todayStr } from '../format';
import { computedBlockHTML, fieldGridHTML, fieldInputValue } from '../fields';
import { typeIcon } from '../heatmap';

function latestLogFor(ctx: UiContext, exerciseId: string): LogRow | undefined {
  return sortLogsDesc(ctx.store.logs.filter((log) => log.exerciseId === exerciseId))[0];
}

export function valuesFromLog(log: LogRow | undefined, type: TrainingType | undefined, unit: 'kg' | 'lb'): Record<string, string> {
  if (!log || !type) return {};
  const values: Record<string, string> = {};
  for (const field of type.fields) {
    const raw = log.fields?.[field.key];
    const text = fieldInputValue(field, raw, unit);
    if (text !== '') values[field.key] = text;
  }
  return values;
}

export function initialValuesFor(ctx: UiContext, exerciseId: string): Record<string, string> {
  const remembered = ctx.store.settings.remember ? state.record.lastValues.get(exerciseId) : undefined;
  if (remembered) return { ...remembered };
  const type = typeOf(ctx.store.config, ctx.store.config.exercises.find((ex) => ex.id === exerciseId)?.category);
  return valuesFromLog(latestLogFor(ctx, exerciseId), type, ctx.store.settings.unit);
}

function typePills(ctx: UiContext): string {
  return ctx.store.config.trainingTypes
    .map(
      (type) =>
        `<button class="type-pill${state.record.typeId === type.id ? ' on' : ''}" data-action="record-type" data-type="${esc(type.id)}">` +
        icon(typeIcon(type), 'ic-sm') +
        esc(getTrainingTypeName(type)) +
        '</button>'
    )
    .join('');
}

function exerciseOptions(ctx: UiContext): string {
  const list = exercisesOfType(ctx.store.config, state.record.typeId);
  if (list.length === 0) return `<option value="">${esc(L('该类型还没有动作', 'No exercises yet'))}</option>`;
  return list
    .map((exercise) => {
      const name = getExerciseNameById(ctx.store.config.exercises, exercise.id);
      return `<option value="${esc(exercise.id)}"${state.record.exerciseId === exercise.id ? ' selected' : ''}>${esc(name)}</option>`;
    })
    .join('');
}

function lastValueCard(ctx: UiContext): string {
  const { config, settings } = ctx.store;
  const exerciseId = state.record.exerciseId;
  if (!exerciseId) return '';
  const latest = latestLogFor(ctx, exerciseId);
  if (!latest) {
    return (
      '<div class="last-value"><div><div class="faint">' +
      esc(L('还没有历史记录', 'No history yet')) +
      '</div><div class="big">' +
      esc(L('这是第一组', 'First set')) +
      '</div></div></div>'
    );
  }
  const name = logExerciseName(config, latest);
  return (
    '<div class="last-value"><div>' +
    `<div class="faint">${esc(L('上次', 'Last'))} · ${esc(dayLabel(dateOf(latest.timestamp)))} ${esc(timeOf(latest.timestamp))}</div>` +
    `<div class="big">${esc(name)} ${esc(compactSetText(config, latest.category, latest.fields, settings.unit))}</div>` +
    '</div>' +
    `<button class="btn btn-sm btn-outline" data-action="fill-last" data-log="${esc(latest.id)}">${esc(L('沿用', 'Use'))}</button>` +
    '</div>'
  );
}

function todayMiniList(ctx: UiContext): string {
  const { config, settings } = ctx.store;
  const today = todayStr();
  const rows = sortLogsDesc(ctx.store.logs.filter((log) => dateOf(log.timestamp) === today)).slice(0, 6);
  if (rows.length === 0) {
    return `<div class="empty">${esc(L('今天还没有记录', 'Nothing logged today yet'))}</div>`;
  }
  return (
    '<div class="mini-list">' +
    rows
      .map(
        (log) =>
          '<div class="mini-item">' +
          `<span class="time">${esc(timeOf(log.timestamp))}</span>` +
          `<span>${esc(logExerciseName(config, log))}</span>` +
          `<span class="val">${esc(compactSetText(config, log.category, log.fields, settings.unit))}</span>` +
          `<button class="mini-btn" data-action="edit-log" data-log="${esc(log.id)}" title="${esc(L('编辑', 'Edit'))}">${icon('edit', 'ic-sm')}</button>` +
          '</div>'
      )
      .join('') +
    '</div>'
  );
}

function durationTip(): string {
  return (
    '<div class="card" style="margin-top:16px">' +
    '<div class="card-title" style="margin-bottom:8px">' +
    icon('timer') +
    esc(L('时长怎么填？', 'How to enter duration')) +
    '</div>' +
    '<div class="muted" style="line-height:1.9">' +
    `<div>• ${esc(L('纯数字 = 秒：90 → 1分30秒', 'Plain number = seconds: 90 → 1m30s'))}</div>` +
    `<div>• ${esc(L('中文单位：1小时30分20秒 / 1分30秒 / 30分', 'Chinese units: 1小时30分20秒 / 1分30秒 / 30分'))}</div>` +
    `<div>• ${esc(L('英文单位：1h30m20s / 30m / 90s', 'English units: 1h30m20s / 30m / 90s'))}</div>` +
    `<div>• ${esc(L('冒号：1:30:20（时:分:秒）/ 30:20（分:秒）', 'Colon: 1:30:20 (h:m:s) / 30:20 (m:s)'))}</div>` +
    '</div></div>'
  );
}

export function renderRecord(ctx: UiContext): string {
  const { config, settings } = ctx.store;
  const type = typeOf(config, state.record.typeId) ?? config.trainingTypes[0];
  const unit = settings.unit;

  if (!type) {
    return (
      '<div class="card"><div class="empty">' +
      esc(L('还没有训练类型，请先去「自定义」创建。', 'No training types yet. Create one in Customize.')) +
      `<div style="margin-top:12px"><button class="btn btn-primary" data-page="customize" data-tab="types">${icon('sliders')}${esc(L('去自定义', 'Customize'))}</button></div>` +
      '</div></div>'
    );
  }

  const exercises = exercisesOfType(config, type.id);
  if (!exercises.some((exercise) => exercise.id === state.record.exerciseId)) {
    state.record.exerciseId = exercises[0]?.id ?? '';
    if (state.record.exerciseId && Object.keys(state.record.values).length === 0) {
      state.record.values = initialValuesFor(ctx, state.record.exerciseId);
    }
  }

  const recentExercises = sortLogsDesc(ctx.store.logs).slice(0, 30);  const suggestions: string[] = [];
  for (const log of recentExercises) {
    if (!log.exerciseId || suggestions.includes(log.exerciseId)) continue;
    suggestions.push(log.exerciseId);
    if (suggestions.length >= 6) break;
  }

  return (
    '<div class="page-head"><div><h2>' +
    esc(L('记录一组', 'Log a set')) +
    '</h2><p>' +
    esc(L('选动作 → 填数值 → 保存，最快 5 秒', 'Pick an exercise, enter values, save — about 5 seconds')) +
    '</p></div><div class="head-actions">' +
    `<button class="btn btn-outline" data-page="history">${icon('list')}${esc(L('训练日志', 'History'))}</button>` +
    '</div></div>' +
    '<div class="record-grid"><div class="card">' +
    `<div class="field"><span class="field-label">${esc(L('训练类型', 'Training type'))}</span><div class="type-pills">${typePills(ctx)}</div></div>` +
    '<div class="field"><label>' +
    esc(L('训练动作', 'Exercise')) +
    '</label><div class="combo">' +
    `<select class="select" data-record-exercise>${exerciseOptions(ctx)}</select>` +
    `<button class="btn btn-outline" data-action="new-exercise" title="${esc(L('新建动作', 'New exercise'))}">${icon('plus')}</button>` +
    '</div></div>' +
    lastValueCard(ctx) +
    fieldGridHTML(type, state.record.values, unit, 'data-field') +
    computedBlockHTML(type, state.record.values, unit) +
    '<div class="field-grid" style="margin-top:2px">' +
    '<div class="field"><label>' +
    esc(L('时间', 'Time')) +
    `</label><input class="input" type="datetime-local" data-record-time value="${esc(state.record.time)}" /></div>` +
    '<div class="field"><label>' +
    esc(L('计划 / 备注标签', 'Plan / tag')) +
    `</label><input class="input" type="text" data-record-plan value="${esc(state.record.planName)}" placeholder="${esc(L('可选，如 三分化-胸', 'Optional, e.g. Push day'))}" /></div>` +
    '</div>' +
    '<div class="field"><label>' +
    esc(L('备注', 'Note')) +
    `</label><textarea class="input" rows="2" data-record-note placeholder="${esc(L('可选，记录状态或感受', 'Optional notes'))}">${esc(state.record.note)}</textarea></div>` +
    `<div class="form-error" data-record-error>${esc(state.record.error)}</div>` +
    '<div class="form-actions">' +
    `<button class="btn btn-primary btn-lg" data-action="save-log" data-again="0">${icon('check')}${esc(L('保存记录', 'Save set'))}</button>` +
    `<button class="btn btn-outline btn-lg" data-action="save-log" data-again="1">${icon('plus')}${esc(L('保存并再来一组', 'Save & another'))}</button>` +
    `<button class="btn btn-ghost" data-action="reset-fields">${esc(L('清空数值', 'Clear values'))}</button>` +
    '</div>' +
    (suggestions.length
      ? '<div style="margin-top:14px;padding-top:13px;border-top:1px solid var(--line)"><div class="faint" style="margin-bottom:7px">' +
        esc(L('最近动作', 'Recent exercises')) +
        '</div><div class="quick-chips">' +
        suggestions
          .map((id) => {
            const name = getExerciseNameById(config.exercises, id) || id;
            const active = id === state.record.exerciseId;
            return `<button class="quick-chip${active ? ' on' : ''}" data-action="quick-record" data-exercise="${esc(id)}">${esc(name)}</button>`;
          })
          .join('') +
        '</div></div>'
      : '') +
    '</div><div>' +
    '<div class="card"><div class="card-head"><div><div class="card-title">' +
    icon('clock') +
    esc(L('今日记录', 'Today')) +
    '</div><div class="card-sub">' +
    esc(L('点铅笔可修改', 'Click the pencil to edit')) +
    '</div></div><button class="link-btn" data-page="history">' +
    esc(L('全部', 'All')) +
    '</button></div>' +
    todayMiniList(ctx) +
    '</div>' +
    durationTip() +
    '</div></div>'
  );
}
