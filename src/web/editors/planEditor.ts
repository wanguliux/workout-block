/*
 * planEditor.ts —— 训练计划编辑器。
 * 支持日期 / 每周两种时间规则，逐动作增删与逐组预设；编辑时保留组 id，
 * 这样已完成状态（`exerciseId#setId`）不会因为改计划而丢失。
 */

import { FieldDef, PlanSet, TrainingPlanInstance, TrainingType } from '../../data/types';
import { getExerciseName, getTrainingTypeName } from '../../data/display';
import { generateId } from '../../util/id';
import { icon } from '../icons';
import { UiContext } from '../context';
import { L, esc, todayStr } from '../format';
import { computedBlockHTML, fieldGridHTML, fieldInputValue, parsePlanFields, readDraftFrom, refreshComputedIn } from '../fields';
import { modalFrame, showModal, toast } from '../ui';
import { editorSignal, closeEditor } from './editorHost';

interface SetDraft {
  id: string;
  values: Record<string, string>;
}

interface ItemDraft {
  exerciseId: string;
  category: string;
  enabled: boolean;
  sets: SetDraft[];
}

interface PlanDraft {
  id: string;
  existing: boolean;
  name: string;
  ruleType: 'weekday' | 'date';
  weekdays: number[];
  date: string;
  sourceNote: string;
  items: ItemDraft[];
  completedSets: Record<string, string>;
  createdAt: string;
}

function valuesOf(set: PlanSet, type: TrainingType | undefined, unit: 'kg' | 'lb'): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of type?.fields ?? []) {
    const text = fieldInputValue(field, set.fields[field.key], unit);
    if (text !== '') values[field.key] = text;
  }
  return values;
}

function draftFrom(ctx: UiContext, plan?: TrainingPlanInstance): PlanDraft {
  if (!plan) {
    return {
      id: generateId(),
      existing: false,
      name: '',
      ruleType: 'weekday',
      weekdays: [1, 3, 5],
      date: todayStr(),
      sourceNote: '',
      items: [],
      completedSets: {},
      createdAt: todayStr(),
    };
  }
  return {
    id: plan.id,
    existing: true,
    name: plan.name,
    ruleType: plan.timeRule.type,
    weekdays: [...(plan.timeRule.weekdays ?? [])],
    date: plan.timeRule.date ?? todayStr(),
    sourceNote: plan.sourceNote ?? '',
    createdAt: plan.createdAt,
    completedSets: { ...(plan.completedSets ?? {}) },
    items: plan.items.map((item) => {
      const type = ctx.store.config.trainingTypes.find((t) => t.id === item.category);
      return {
        exerciseId: item.exerciseId,
        category: item.category,
        enabled: item.enabled,
        sets: item.sets.map((set) => ({ id: set.id, values: valuesOf(set, type, ctx.store.settings.unit) })),
      };
    }),
  };
}

function weekdayChips(draft: PlanDraft): string {
  const labels = [L('一', 'Mon'), L('二', 'Tue'), L('三', 'Wed'), L('四', 'Thu'), L('五', 'Fri'), L('六', 'Sat'), L('日', 'Sun')];
  return (
    '<div class="weekday-chips">' +
    labels
      .map((label, index) => {
        const day = index + 1;
        return `<button class="weekday-chip${draft.weekdays.includes(day) ? ' on' : ''}" data-editor-action="toggle-weekday" data-day="${day}">${esc(
          label
        )}</button>`;
      })
      .join('') +
    '</div>'
  );
}

function exerciseSelect(ctx: UiContext, item: ItemDraft, index: number): string {
  const { config } = ctx.store;
  return (
    `<select class="select" data-editor-exercise data-index="${index}">` +
    config.exercises
      .map(
        (exercise) =>
          `<option value="${esc(exercise.id)}"${exercise.id === item.exerciseId ? ' selected' : ''}>${esc(
            getExerciseName(exercise)
          )}</option>`
      )
      .join('') +
    '</select>'
  );
}

function setBlock(type: TrainingType | undefined, item: ItemDraft, itemIndex: number, set: SetDraft, setIndex: number, unit: 'kg' | 'lb'): string {
  const removable = item.sets.length > 1;
  return (
    `<div class="set-edit-card" data-set-index="${setIndex}">` +
    '<div class="set-edit-head">' +
    `<span class="set-no">${esc(L('第', 'Set'))} ${setIndex + 1} ${esc(L('组', ''))}</span>` +
    (removable
      ? `<button class="mini-btn danger" data-editor-action="remove-set" data-item="${itemIndex}" data-set="${setIndex}" title="${esc(
          L('删除这一组', 'Remove set')
        )}">${icon('trash', 'ic-sm')}</button>`
      : '') +
    '</div>' +
    fieldGridHTML(type, set.values, unit, 'data-editor-field') +
    computedBlockHTML(type, set.values, unit) +
    '</div>'
  );
}

function itemBlock(ctx: UiContext, draft: PlanDraft, item: ItemDraft, index: number): string {
  const type = ctx.store.config.trainingTypes.find((t) => t.id === item.category);
  return (
    `<div class="plan-item-edit" data-item-index="${index}">` +
    '<div class="plan-item-edit-head">' +
    '<div class="plan-item-pick">' +
    exerciseSelect(ctx, item, index) +
    `<span class="pill pill-soft">${esc(getTrainingTypeName(type))}</span>` +
    '</div>' +
    '<label class="check-inline"><input type="checkbox" data-editor-enabled data-index="' +
    index +
    '"' +
    (item.enabled ? ' checked' : '') +
    ` />${esc(L('纳入训练', 'Include'))}</label>` +
    `<button class="mini-btn danger" data-editor-action="remove-item" data-index="${index}" title="${esc(
      L('删除动作', 'Remove exercise')
    )}">${icon('trash', 'ic-sm')}</button>` +
    '</div>' +
    '<div class="set-edit-list">' +
    item.sets.map((set, setIndex) => setBlock(type, item, index, set, setIndex, ctx.store.settings.unit)).join('') +
    '</div>' +
    `<button class="btn btn-ghost btn-sm" data-editor-action="add-set" data-item="${index}">${icon('plus', 'ic-sm')}${esc(
      L('添加一组', 'Add set')
    )}</button>` +
    '</div>'
  );
}

function bodyHTML(ctx: UiContext, draft: PlanDraft): string {
  const { config } = ctx.store;
  const addOptions = config.exercises
    .map((exercise) => `<option value="${esc(exercise.id)}">${esc(getExerciseName(exercise))}</option>`)
    .join('');
  return (
    '<div class="plan-editor">' +
    '<div class="editor-grid">' +
    '<div class="field"><label>' +
    esc(L('计划名称', 'Plan name')) +
    `</label><input class="input" data-editor-name value="${esc(draft.name)}" placeholder="${esc(
      L('如 三分化-背', 'e.g. Pull day')
    )}" /></div>` +
    '<div class="field"><label>' +
    esc(L('来源备注', 'Source note')) +
    `</label><input class="input" data-editor-source value="${esc(draft.sourceNote)}" placeholder="${esc(
      L('可选', 'Optional')
    )}" /></div>` +
    '</div>' +
    '<div class="section-title">' +
    esc(L('训练时间', 'Schedule')) +
    '</div>' +
    '<div class="seg">' +
    `<button class="${draft.ruleType === 'weekday' ? 'on' : ''}" data-editor-action="rule" data-rule="weekday">${esc(
      L('每周固定', 'Weekly')
    )}</button>` +
    `<button class="${draft.ruleType === 'date' ? 'on' : ''}" data-editor-action="rule" data-rule="date">${esc(
      L('指定日期', 'One date')
    )}</button>` +
    '</div>' +
    (draft.ruleType === 'weekday'
      ? weekdayChips(draft)
      : `<div class="field" style="max-width:240px;margin-top:10px"><label>${esc(
          L('日期', 'Date')
        )}</label><input class="input" type="date" data-editor-date value="${esc(draft.date)}" /></div>`) +
    '<div class="section-title" style="margin-top:22px">' +
    esc(L('训练动作与预设组', 'Exercises & preset sets')) +
    `<span class="faint">${esc(L(`${draft.items.length} 个动作`, `${draft.items.length} exercises`))}</span>` +
    '</div>' +
    '<div class="plan-items-edit">' +
    (draft.items.length
      ? draft.items.map((item, index) => itemBlock(ctx, draft, item, index)).join('')
      : `<div class="empty">${esc(L('还没有动作，先在下方添加。', 'No exercises yet — add one below.'))}</div>`) +
    '</div>' +
    '<div class="add-item-row">' +
    `<select class="select" id="planAddExercise">${addOptions || `<option value="">${esc(L('没有动作', 'No exercises'))}</option>`}</select>` +
    `<button class="btn btn-outline" data-editor-action="add-item"${config.exercises.length ? '' : ' disabled'}>${icon('plus', 'ic-sm')}${esc(
      L('添加动作', 'Add exercise')
    )}</button>` +
    '</div>' +
    '<div class="form-error" id="planEditorError"></div>' +
    '</div>'
  );
}

function setError(message: string): void {
  const el = document.getElementById('planEditorError');
  if (el) el.textContent = message;
}

function save(ctx: UiContext, draft: PlanDraft): void {
  const name = draft.name.trim();
  if (!name) {
    setError(L('请填写计划名称', 'Plan name is required'));
    return;
  }
  if (draft.ruleType === 'weekday' && draft.weekdays.length === 0) {
    setError(L('请至少选择一天', 'Pick at least one weekday'));
    return;
  }
  if (draft.ruleType === 'date' && !draft.date) {
    setError(L('请选择日期', 'Pick a date'));
    return;
  }

  const unit = ctx.store.settings.unit;
  const items: TrainingPlanInstance['items'] = [];
  const surviving = new Set<string>();

  for (const item of draft.items) {
    const exercise = ctx.store.config.exercises.find((ex) => ex.id === item.exerciseId);
    if (!exercise) continue;
    const type = ctx.store.config.trainingTypes.find((t) => t.id === exercise.category);
    if (!type) continue;
    const sets: PlanSet[] = [];
    for (const set of item.sets) {
      const parsed = parsePlanFields(type, set.values, unit);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      sets.push({ id: set.id, fields: parsed.fields });
      surviving.add(`${item.exerciseId}#${set.id}`);
    }
    items.push({ exerciseId: exercise.id, category: exercise.category, enabled: item.enabled, sets });
  }

  const completedSets: Record<string, string> = {};
  for (const [key, day] of Object.entries(draft.completedSets)) {
    if (surviving.has(key)) completedSets[key] = day;
  }

  const plan: TrainingPlanInstance = {
    id: draft.id,
    name,
    timeRule:
      draft.ruleType === 'weekday'
        ? { type: 'weekday', weekdays: [...draft.weekdays].sort((a, b) => a - b) }
        : { type: 'date', date: draft.date },
    sourceNote: draft.sourceNote.trim() || undefined,
    createdAt: draft.createdAt,
    items,
    completedSets,
  };

  ctx.store.updateConfig((config) => {
    config.plans = config.plans ?? [];
    const index = config.plans.findIndex((item) => item.id === plan.id);
    if (index >= 0) config.plans[index] = plan;
    else config.plans.push(plan);
  });
  closeEditor();
  toast(L('计划已保存', 'Plan saved'));
}

export function openPlanEditor(ctx: UiContext, planId?: string): void {
  const plan = planId ? (ctx.store.config.plans ?? []).find((item) => item.id === planId) : undefined;
  const draft = draftFrom(ctx, plan);
  const signal = editorSignal();
  const root = document.getElementById('modalRoot');
  if (!root) return;

  const render = (): void => {
    showModal(
      modalFrame({
        title: plan ? L('编辑训练计划', 'Edit plan') : L('新建训练计划', 'New plan'),
        sub: L('动作、组数与时间规则都可以随时调整', 'Adjust exercises, sets and schedule anytime'),
        body: bodyHTML(ctx, draft),
        foot:
          `<button class="btn btn-ghost" data-action="close-modal">${esc(L('取消', 'Cancel'))}</button>` +
          `<button class="btn btn-primary" data-editor-action="save">${icon('check', 'ic-sm')}${esc(L('保存计划', 'Save'))}</button>`,
        large: true,
      })
    );
  };

  render();

  root.addEventListener(
    'click',
    (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-editor-action]');
      if (!target) return;
      const action = target.dataset.editorAction;
      if (action === 'rule') {
        draft.ruleType = target.dataset.rule === 'date' ? 'date' : 'weekday';
        render();
      } else if (action === 'toggle-weekday') {
        const day = Number(target.dataset.day);
        draft.weekdays = draft.weekdays.includes(day)
          ? draft.weekdays.filter((item) => item !== day)
          : [...draft.weekdays, day];
        render();
      } else if (action === 'add-item') {
        const select = document.getElementById('planAddExercise') as HTMLSelectElement | null;
        const exerciseId = select?.value ?? '';
        const exercise = ctx.store.config.exercises.find((item) => item.id === exerciseId);
        if (!exercise) return;
        draft.items.push({
          exerciseId: exercise.id,
          category: exercise.category,
          enabled: true,
          sets: [{ id: generateId(8), values: {} }],
        });
        render();
      } else if (action === 'remove-item') {
        draft.items.splice(Number(target.dataset.index), 1);
        render();
      } else if (action === 'add-set') {
        const item = draft.items[Number(target.dataset.item)];
        if (!item) return;
        const last = item.sets[item.sets.length - 1];
        item.sets.push({ id: generateId(8), values: { ...(last?.values ?? {}) } });
        render();
      } else if (action === 'remove-set') {
        const item = draft.items[Number(target.dataset.item)];
        if (!item) return;
        item.sets.splice(Number(target.dataset.set), 1);
        render();
      } else if (action === 'save') {
        save(ctx, draft);
      }
    },
    { signal }
  );

  root.addEventListener(
    'input',
    (event) => {
      const input = event.target as HTMLInputElement;
      if (input.matches('[data-editor-name]')) {
        draft.name = input.value;
      } else if (input.matches('[data-editor-source]')) {
        draft.sourceNote = input.value;
      } else if (input.matches('[data-editor-date]')) {
        draft.date = input.value;
      } else if (input.matches('[data-editor-field]')) {
        const card = input.closest<HTMLElement>('[data-set-index]');
        const itemEl = input.closest<HTMLElement>('[data-item-index]');
        if (!card || !itemEl) return;
        const item = draft.items[Number(itemEl.dataset.itemIndex)];
        const set = item?.sets[Number(card.dataset.setIndex)];
        if (!set) return;
        const key = input.getAttribute('data-editor-field') ?? '';
        set.values[key] = input.value;
        const type = ctx.store.config.trainingTypes.find((t) => t.id === item.category);
        refreshComputedIn(card, type, ctx.store.settings.unit, 'data-editor-field');
      }
    },
    { signal }
  );

  root.addEventListener(
    'change',
    (event) => {
      const target = event.target as HTMLElement;
      if (target.matches('[data-editor-exercise]')) {
        const select = target as HTMLSelectElement;
        const item = draft.items[Number(select.dataset.index)];
        const exercise = ctx.store.config.exercises.find((ex) => ex.id === select.value);
        if (!item || !exercise) return;
        if (item.exerciseId !== exercise.id) {
          item.exerciseId = exercise.id;
          item.category = exercise.category;
          const type = ctx.store.config.trainingTypes.find((t) => t.id === exercise.category);
          item.sets = item.sets.map((set) => ({
            id: set.id,
            values: Object.fromEntries(
              (type?.fields ?? [])
                .filter((field: FieldDef) => field.inputType !== 'computed')
                .map((field) => [field.key, set.values[field.key] ?? ''])
            ),
          }));
        }
        render();
      } else if (target.matches('[data-editor-enabled]')) {
        const item = draft.items[Number((target as HTMLInputElement).dataset.index)];
        if (item) item.enabled = (target as HTMLInputElement).checked;
      }
    },
    { signal }
  );
}

/** 编辑器里读取一组预设字段（导出给测试/调试用）。 */
export function readPlanSetValues(root: ParentNode): Record<string, string> {
  return readDraftFrom(root, 'data-editor-field');
}
