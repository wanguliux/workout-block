/*
 * logEditor.ts —— 单条训练记录的编辑弹窗。
 * 与记录页共用动态字段控件；保存时保持记录 id 不变。
 */

import { LogRow, TrainingType } from '../../data/types';
import { getExerciseName, getTrainingTypeName } from '../../data/display';
import { icon } from '../icons';
import { UiContext } from '../context';
import { L, esc, dateOf, timeOf } from '../format';
import { computedBlockHTML, fieldGridHTML, fieldInputValue, parseDraft, refreshComputedIn } from '../fields';
import { modalFrame, showModal, toast, confirmDialog } from '../ui';
import { editorSignal, closeEditor } from './editorHost';

function valuesFrom(log: LogRow, type: TrainingType | undefined, unit: 'kg' | 'lb'): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of type?.fields ?? []) {
    const text = fieldInputValue(field, log.fields?.[field.key], unit);
    if (text !== '') values[field.key] = text;
  }
  return values;
}

function localTime(timestamp: string): string {
  return `${dateOf(timestamp)}T${timeOf(timestamp)}`;
}

export function openLogEditor(ctx: UiContext, logId: string): void {
  const { config, settings } = ctx.store;
  const log = ctx.store.logs.find((row) => row.id === logId);
  if (!log) return;
  const type = config.trainingTypes.find((item) => item.id === log.category);
  if (!type) {
    toast(L('这条记录的训练类型已被删除', 'The training type of this log no longer exists'));
    return;
  }

  const values = valuesFrom(log, type, settings.unit);
  const exercises = config.exercises.filter((exercise) => exercise.category === type.id);
  const signal = editorSignal();
  const root = document.getElementById('modalRoot');
  if (!root) return;

  const body = (): string =>
    '<div class="log-editor">' +
    '<div class="editor-grid">' +
    '<div class="field"><label>' +
    esc(L('训练类型', 'Type')) +
    `</label><div class="static-value">${esc(getTrainingTypeName(type))}</div></div>` +
    '<div class="field"><label>' +
    esc(L('训练动作', 'Exercise')) +
    '</label><select class="select" data-log-exercise>' +
    exercises
      .map(
        (exercise) =>
          `<option value="${esc(exercise.id)}"${exercise.id === log.exerciseId ? ' selected' : ''}>${esc(
            getExerciseName(exercise)
          )}</option>`
      )
      .join('') +
    '</select></div></div>' +
    fieldGridHTML(type, values, settings.unit, 'data-log-field') +
    computedBlockHTML(type, values, settings.unit) +
    '<div class="editor-grid">' +
    '<div class="field"><label>' +
    esc(L('时间', 'Time')) +
    `</label><input class="input" type="datetime-local" data-log-time value="${esc(localTime(log.timestamp))}" /></div>` +
    '<div class="field"><label>' +
    esc(L('计划 / 标签', 'Plan / tag')) +
    `</label><input class="input" type="text" data-log-plan value="${esc(log.plan ?? '')}" /></div>` +
    '</div>' +
    '<div class="field"><label>' +
    esc(L('备注', 'Note')) +
    `</label><textarea class="input" rows="2" data-log-note>${esc(log.note ?? '')}</textarea></div>` +
    '<div class="form-error" id="logEditorError"></div>' +
    '</div>';

  showModal(
    modalFrame({
      title: L('编辑记录', 'Edit log'),
      sub: `${dateOf(log.timestamp)} ${timeOf(log.timestamp)} · ${getExerciseName(
        config.exercises.find((exercise) => exercise.id === log.exerciseId)
      ) || L('未关联动作', 'Unlinked')}`,
      body: body(),
      foot:
        `<button class="btn btn-danger btn-ghost" data-editor-action="delete">${icon('trash', 'ic-sm')}${esc(
          L('删除记录', 'Delete')
        )}</button>` +
        '<span style="flex:1"></span>' +
        `<button class="btn btn-ghost" data-action="close-modal">${esc(L('取消', 'Cancel'))}</button>` +
        `<button class="btn btn-primary" data-editor-action="save">${icon('check', 'ic-sm')}${esc(L('保存', 'Save'))}</button>`,
    })
  );

  const setError = (message: string): void => {
    const el = document.getElementById('logEditorError');
    if (el) el.textContent = message;
  };

  const collect = (): { fields: Record<string, unknown> } | null => {
    const parsed = parseDraft(type, values, settings.unit);
    if (!parsed.ok) {
      setError(parsed.error);
      return null;
    }
    // 字段从类型里被删掉后，历史记录里该字段的值仍要保留（与删除字段时的提示一致）：
    // 表单覆盖「当前类型定义内的键」，其余孤儿键原样带回。
    const known = new Set(type.fields.map((field) => field.key));
    const orphans: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(log.fields ?? {})) {
      if (!known.has(key)) orphans[key] = value;
    }
    return { fields: { ...orphans, ...parsed.fields } };
  };

  root.addEventListener(
    'input',
    (event) => {
      const input = event.target as HTMLInputElement;
      if (input.matches('[data-log-field]')) {
        values[input.getAttribute('data-log-field') ?? ''] = input.value;
        refreshComputedIn(root, type, settings.unit, 'data-log-field');
      }
    },
    { signal }
  );

  root.addEventListener(
    'click',
    (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-editor-action]');
      if (!target) return;
      if (target.dataset.editorAction === 'save') {
        const result = collect();
        if (!result) return;
        const exerciseSelect = root.querySelector<HTMLSelectElement>('[data-log-exercise]');
        const timeInput = root.querySelector<HTMLInputElement>('[data-log-time]');
        const planInput = root.querySelector<HTMLInputElement>('[data-log-plan]');
        const noteInput = root.querySelector<HTMLTextAreaElement>('[data-log-note]');
        const timestamp = timeInput?.value ? timeInput.value.replace('T', ' ') : log.timestamp;
        ctx.store.updateLog(log.id, {
          timestamp,
          exerciseId: exerciseSelect?.value || undefined,
          fields: result.fields,
          plan: planInput?.value.trim() || undefined,
          note: noteInput?.value.trim() || undefined,
        });
        closeEditor();
        toast(L('记录已更新', 'Log updated'));
      } else if (target.dataset.editorAction === 'delete') {
        confirmDialog({
          title: L('删除这条记录？', 'Delete this log?'),
          message: L('删除后无法恢复，但不会影响配置与其他记录。', 'This cannot be undone; config and other logs are unaffected.'),
          confirmLabel: L('删除', 'Delete'),
          danger: true,
          onConfirm: () => {
            ctx.store.removeLog(log.id);
            toast(L('已删除', 'Deleted'));
          },
        });
      }
    },
    { signal }
  );
}
