/*
 * defEditors.ts —— 训练类型 / 字段 / 动作三个定义编辑器。
 * 名称编辑采用「显示名」语义：改了名字就写入 name 并清掉 nameKey，
 * 没改则保留 nameKey，继续跟随界面语言。
 */

import { Exercise, ExerciseMuscle, FieldDef, FieldInputType, TrainingType } from '../../data/types';
import { getExerciseName, getFieldLabel, getMuscleName, getTrainingTypeName } from '../../data/display';
import { validateFieldExpr } from '../../data/statExpr';
import { icon } from '../icons';
import { UiContext } from '../context';
import { L, esc, slugId } from '../format';
import { modalFrame, showModal, toast } from '../ui';
import { editorSignal, closeEditor } from './editorHost';

function uniqueId(base: string, taken: string[]): string {
  let id = slugId(base);
  let index = 2;
  while (taken.includes(id)) {
    id = `${slugId(base)}-${index++}`;
  }
  return id;
}

// ============================ 训练类型 ============================

export function openTypeEditor(ctx: UiContext, typeId?: string): void {
  const type = typeId ? ctx.store.config.trainingTypes.find((item) => item.id === typeId) : undefined;
  const initialName = getTrainingTypeName(type);
  const draft = {
    id: type?.id ?? '',
    existing: !!type,
    name: type ? initialName : '',
    initialName,
    hasNameKey: !!type?.nameKey,
    contributes: type?.contributesToCoverage ?? true,
  };
  const signal = editorSignal();
  const root = document.getElementById('modalRoot');
  if (!root) return;

  const body = (): string =>
    '<div class="def-editor">' +
    '<div class="field"><label>' +
    esc(L('显示名称', 'Display name')) +
    `</label><input class="input" data-editor-name value="${esc(draft.name)}" placeholder="${esc(
      L('如 力量训练', 'e.g. Strength')
    )}" /></div>` +
    (draft.existing
      ? `<div class="field"><label>ID</label><div class="static-value mono">${esc(draft.id)}</div><div class="faint">${esc(
          L('ID 用于关联历史记录，创建后不可修改', 'The ID links historical logs and cannot be changed')
        )}</div></div>`
      : '') +
    '<div class="setting-row compact"><div class="setting-info"><b>' +
    esc(L('计入肌肉覆盖', 'Count toward coverage')) +
    '</b><span>' +
    esc(L('该类型的动作是否参与肌肉覆盖统计', 'Whether this type contributes to muscle coverage')) +
    '</span></div><button class="switch' +
    (draft.contributes ? ' on' : '') +
    '" data-editor-action="toggle-contributes"></button></div>' +
    '<div class="form-error" id="defEditorError"></div>' +
    '</div>';

  showModal(
    modalFrame({
      title: type ? L('编辑训练类型', 'Edit type') : L('新建训练类型', 'New type'),
      body: body(),
      foot:
        `<button class="btn btn-ghost" data-action="close-modal">${esc(L('取消', 'Cancel'))}</button>` +
        `<button class="btn btn-primary" data-editor-action="save">${icon('check', 'ic-sm')}${esc(L('保存', 'Save'))}</button>`,
    })
  );

  root.addEventListener(
    'input',
    (event) => {
      const input = event.target as HTMLInputElement;
      if (input.matches('[data-editor-name]')) draft.name = input.value;
    },
    { signal }
  );

  root.addEventListener(
    'click',
    (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-editor-action]');
      if (!target) return;
      if (target.dataset.editorAction === 'toggle-contributes') {
        draft.contributes = !draft.contributes;
        target.classList.toggle('on', draft.contributes);
      } else if (target.dataset.editorAction === 'save') {
        const name = draft.name.trim();
        const error = document.getElementById('defEditorError');
        if (!name) {
          if (error) error.textContent = L('请填写显示名称', 'Display name is required');
          return;
        }
        const id = draft.existing
          ? draft.id
          : uniqueId(name, ctx.store.config.trainingTypes.map((item) => item.id));
        const next: TrainingType = {
          id,
          fields: type?.fields ?? [],
          contributesToCoverage: draft.contributes,
        };
        if (draft.hasNameKey && name === draft.initialName) {
          if (type?.nameKey) next.nameKey = type.nameKey;
        } else {
          next.name = name;
        }
        ctx.store.updateConfig((config) => {
          const index = config.trainingTypes.findIndex((item) => item.id === id);
          if (index >= 0) config.trainingTypes[index] = next;
          else config.trainingTypes.push(next);
        });
        closeEditor();
        toast(L('训练类型已保存', 'Type saved'));
      }
    },
    { signal }
  );
}

// ============================ 字段 ============================

const INPUT_TYPES: { value: FieldInputType; label: [string, string] }[] = [
  { value: 'number', label: ['数字', 'Number'] },
  { value: 'duration', label: ['时长', 'Duration'] },
  { value: 'text', label: ['文本', 'Text'] },
  { value: 'select', label: ['下拉', 'Select'] },
  { value: 'computed', label: ['派生（公式）', 'Derived (formula)'] },
];

export function openFieldEditor(ctx: UiContext, typeId: string, fieldKey: string): void {
  const type = ctx.store.config.trainingTypes.find((item) => item.id === typeId);
  if (!type) return;
  const field = fieldKey ? type.fields.find((item) => item.key === fieldKey) : undefined;
  const initialLabel = field ? getFieldLabel(field) : '';
  const draft = {
    existing: !!field,
    key: field?.key ?? '',
    label: field ? initialLabel : '',
    initialLabel,
    hasLabelKey: !!field?.labelKey,
    inputType: field?.inputType ?? ('number' as FieldInputType),
    required: field?.required ?? false,
    mass: field?.mass ?? false,
    unitLabel: field?.unitLabel ?? '',
    options: (field?.options ?? []).join('\n'),
    formula: field?.formula ?? '',
    renderAs: field?.renderAs ?? ('number' as 'number' | 'duration'),
  };
  const signal = editorSignal();
  const root = document.getElementById('modalRoot');
  if (!root) return;

  const render = (): void => {
    showModal(
      modalFrame({
        title: field ? L('编辑字段', 'Edit field') : L('添加字段', 'Add field'),
        sub: getTrainingTypeName(type),
        body: bodyHTML(),
        foot:
          `<button class="btn btn-ghost" data-action="close-modal">${esc(L('取消', 'Cancel'))}</button>` +
          `<button class="btn btn-primary" data-editor-action="save">${icon('check', 'ic-sm')}${esc(
            L('保存字段', 'Save field')
          )}</button>`,
        large: true,
      })
    );
  };

  const bodyHTML = (): string => {
    const computed = draft.inputType === 'computed';
    const allowed = type.fields.filter((item) => item.inputType !== 'computed' && item.key !== draft.key).map((item) => item.key);
    return (
      '<div class="def-editor">' +
      '<div class="editor-grid">' +
      '<div class="field"><label>' +
      esc(L('显示名称', 'Label')) +
      `</label><input class="input" data-editor-label value="${esc(draft.label)}" placeholder="${esc(
        L('如 重量', 'e.g. Weight')
      )}" /></div>` +
      '<div class="field"><label>' +
      esc(L('字段 key', 'Field key')) +
      `</label><input class="input mono" data-editor-key value="${esc(draft.key)}" placeholder="weight" ${
        draft.existing ? 'readonly' : ''
      } />` +
      (draft.existing
        ? `<div class="faint">${esc(L('key 已被历史记录引用，不可修改', 'The key is referenced by logs and cannot change'))}</div>`
        : '') +
      '</div></div>' +
      '<div class="editor-grid">' +
      '<div class="field"><label>' +
      esc(L('输入类型', 'Input type')) +
      '</label><select class="select" data-editor-input-type>' +
      INPUT_TYPES.map(
        (item) =>
          `<option value="${item.value}"${draft.inputType === item.value ? ' selected' : ''}>${esc(
            L(item.label[0], item.label[1])
          )}</option>`
      ).join('') +
      '</select></div>' +
      '<div class="field"><label>' +
      esc(L('单位文字（可选）', 'Unit label (optional)')) +
      `</label><input class="input" data-editor-unit value="${esc(draft.unitLabel)}" placeholder="${esc(
        L('如 次 / 公里', 'e.g. reps / km')
      )}" /></div>` +
      '</div>' +
      (computed
        ? '<div class="editor-grid"><div class="field"><label>' +
          esc(L('公式', 'Formula')) +
          `</label><input class="input mono" data-editor-formula value="${esc(draft.formula)}" placeholder="duration_sec / distance_km" />` +
          `<div class="faint">${esc(
            L(
              `可用字段：${allowed.length ? allowed.join(', ') : '（先添加普通字段）'}；只支持四则运算`,
              `Fields: ${allowed.length ? allowed.join(', ') : '(add input fields first)'}; arithmetic only`
            )
          )}</div></div>` +
          '<div class="field"><label>' +
          esc(L('显示为', 'Render as')) +
          '</label><select class="select" data-editor-render-as>' +
          `<option value="number"${draft.renderAs === 'number' ? ' selected' : ''}>${esc(L('数字', 'Number'))}</option>` +
          `<option value="duration"${draft.renderAs === 'duration' ? ' selected' : ''}>${esc(
            L('时长', 'Duration')
          )}</option>` +
          '</select></div></div>'
        : '') +
      (draft.inputType === 'select'
        ? '<div class="field"><label>' +
          esc(L('选项（每行一个）', 'Options (one per line)')) +
          `</label><textarea class="input" rows="3" data-editor-options>${esc(draft.options)}</textarea></div>`
        : '') +
      '<div class="setting-row compact"><div class="setting-info"><b>' +
      esc(L('必填', 'Required')) +
      '</b><span>' +
      esc(L('保存记录时必须填写', 'Must be filled when saving a log')) +
      '</span></div><button class="switch' +
      (draft.required ? ' on' : '') +
      '" data-editor-action="toggle-required"></button></div>' +
      (draft.inputType === 'number'
        ? '<div class="setting-row compact"><div class="setting-info"><b>' +
          esc(L('质量（kg / lb）', 'Mass (kg / lb)')) +
          '</b><span>' +
          esc(L('开启后按重量单位自动换算', 'Converted automatically between kg and lb')) +
          '</span></div><button class="switch' +
          (draft.mass ? ' on' : '') +
          '" data-editor-action="toggle-mass"></button></div>'
        : '') +
      '<div class="form-error" id="defEditorError"></div>' +
      '</div>'
    );
  };

  render();

  root.addEventListener(
    'input',
    (event) => {
      const input = event.target as HTMLInputElement;
      if (input.matches('[data-editor-label]')) draft.label = input.value;
      else if (input.matches('[data-editor-key]')) draft.key = input.value;
      else if (input.matches('[data-editor-unit]')) draft.unitLabel = input.value;
      else if (input.matches('[data-editor-formula]')) draft.formula = input.value;
      else if (input.matches('[data-editor-options]')) draft.options = input.value;
    },
    { signal }
  );

  root.addEventListener(
    'change',
    (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      if (target.matches('[data-editor-input-type]')) {
        draft.inputType = (target as HTMLSelectElement).value as FieldInputType;
        render();
      } else if (target.matches('[data-editor-render-as]')) {
        draft.renderAs = (target as HTMLSelectElement).value === 'duration' ? 'duration' : 'number';
      } else if (target.matches('[data-editor-label]')) {
        draft.label = target.value;
      } else if (target.matches('[data-editor-key]')) {
        draft.key = target.value;
      }
    },
    { signal }
  );

  root.addEventListener(
    'click',
    (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-editor-action]');
      if (!target) return;
      const action = target.dataset.editorAction;
      const error = (): HTMLElement | null => document.getElementById('defEditorError');
      if (action === 'toggle-required') {
        draft.required = !draft.required;
        target.classList.toggle('on', draft.required);
      } else if (action === 'toggle-mass') {
        draft.mass = !draft.mass;
        target.classList.toggle('on', draft.mass);
      } else if (action === 'save') {
        const key = (draft.key || slugId(draft.label)).trim();
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
          const el = error();
          if (el) el.textContent = L('key 只能包含字母、数字、下划线，且不能以数字开头', 'Key must be letters, digits or underscores and cannot start with a digit');
          return;
        }
        if (!draft.existing && type.fields.some((item) => item.key === key)) {
          const el = error();
          if (el) el.textContent = L('同一类型下字段 key 不能重复', 'Field keys must be unique within a type');
          return;
        }
        if (draft.inputType === 'computed') {
          const formula = draft.formula.trim();
          if (!formula) {
            const el = error();
            if (el) el.textContent = L('请填写公式', 'Formula is required');
            return;
          }
          const allowed = type.fields.filter((item) => item.inputType !== 'computed' && item.key !== draft.key).map((item) => item.key);
          try {
            validateFieldExpr(formula, allowed);
          } catch (exception) {
            const el = error();
            if (el) el.textContent = exception instanceof Error ? exception.message : String(exception);
            return;
          }
        }
        if (draft.inputType === 'select') {
          const options = draft.options
            .split(/[\n,，]/)
            .map((item) => item.trim())
            .filter(Boolean);
          if (options.length === 0) {
            const el = error();
            if (el) el.textContent = L('下拉字段至少需要一个选项', 'A select field needs at least one option');
            return;
          }
        }

        const next: FieldDef = {
          key,
          inputType: draft.inputType,
          required: draft.required || undefined,
          mass: draft.inputType === 'number' && draft.mass ? true : undefined,
          unitLabel: draft.unitLabel.trim() || undefined,
        };
        if (draft.hasLabelKey && draft.label.trim() === draft.initialLabel) {
          if (field?.labelKey) next.labelKey = field.labelKey;
        } else {
          next.label = draft.label.trim() || key;
        }
        if (draft.inputType === 'select') {
          next.options = draft.options
            .split(/[\n,，]/)
            .map((item) => item.trim())
            .filter(Boolean);
        }
        if (draft.inputType === 'computed') {
          next.formula = draft.formula.trim();
          next.renderAs = draft.renderAs;
        }

        ctx.store.updateConfig((config) => {
          const targetType = config.trainingTypes.find((item) => item.id === type.id);
          if (!targetType) return;
          const index = targetType.fields.findIndex((item) => item.key === key);
          if (index >= 0) targetType.fields[index] = next;
          else targetType.fields.push(next);
        });
        closeEditor();
        toast(L('字段已保存', 'Field saved'));
      }
    },
    { signal }
  );
}

// ============================ 训练动作 ============================

export function openExerciseEditor(
  ctx: UiContext,
  exerciseId?: string,
  presetCategory?: string,
  onSaved?: (id: string) => void
): void {
  const exercise = exerciseId ? ctx.store.config.exercises.find((item) => item.id === exerciseId) : undefined;
  const initialName = exercise ? getExerciseName(exercise) : '';
  const roles: Record<string, 'primary' | 'secondary' | ''> = {};
  for (const muscle of ctx.store.config.muscles) {
    const link = exercise?.muscles?.find((item) => item.muscleId === muscle.id);
    roles[muscle.id] = link?.role ?? '';
  }
  const draft = {
    id: exercise?.id ?? '',
    existing: !!exercise,
    name: exercise ? initialName : '',
    initialName,
    hasNameKey: !!exercise?.nameKey,
    category: exercise?.category ?? presetCategory ?? ctx.store.config.trainingTypes[0]?.id ?? '',
    roles,
  };
  const signal = editorSignal();
  const root = document.getElementById('modalRoot');
  if (!root) return;

  const body = (): string => {
    const primary = Object.values(draft.roles).filter((role) => role === 'primary').length;
    const secondary = Object.values(draft.roles).filter((role) => role === 'secondary').length;
    return (
      '<div class="def-editor">' +
      '<div class="editor-grid">' +
      '<div class="field"><label>' +
      esc(L('动作名称', 'Exercise name')) +
      `</label><input class="input" data-editor-name value="${esc(draft.name)}" placeholder="${esc(
        L('如 杠铃卧推', 'e.g. Barbell bench press')
      )}" /></div>` +
      '<div class="field"><label>' +
      esc(L('训练类型', 'Training type')) +
      '</label><select class="select" data-editor-category>' +
      ctx.store.config.trainingTypes
        .map(
          (type) =>
            `<option value="${esc(type.id)}"${draft.category === type.id ? ' selected' : ''}>${esc(
              getTrainingTypeName(type)
            )}</option>`
        )
        .join('') +
      '</select></div></div>' +
      `<div class="section-title">${esc(L('肌肉关联', 'Muscles'))}<span class="faint">${esc(
        L(`主练 ${primary} · 辅练 ${secondary}`, `${primary} primary · ${secondary} secondary`)
      )}</span></div>` +
      '<div class="muscle-role-list">' +
      (ctx.store.config.muscles.length
        ? ctx.store.config.muscles
            .map(
              (muscle) =>
                '<div class="muscle-role-row">' +
                `<span>${esc(getMuscleName(muscle) || muscle.id)}</span>` +
                `<select class="select" data-muscle-role="${esc(muscle.id)}">` +
                `<option value=""${draft.roles[muscle.id] === '' ? ' selected' : ''}>${esc(L('不关联', 'None'))}</option>` +
                `<option value="primary"${draft.roles[muscle.id] === 'primary' ? ' selected' : ''}>${esc(
                  L('主练', 'Primary')
                )}</option>` +
                `<option value="secondary"${draft.roles[muscle.id] === 'secondary' ? ' selected' : ''}>${esc(
                  L('辅练', 'Secondary')
                )}</option>` +
                '</select></div>'
            )
            .join('')
        : `<div class="faint">${esc(L('还没有肌肉，先去肌肉页创建', 'No muscles yet; create some first'))}</div>`) +
      '</div>' +
      '<div class="form-error" id="defEditorError"></div>' +
      '</div>'
    );
  };

  showModal(
    modalFrame({
      title: exercise ? L('编辑动作', 'Edit exercise') : L('新建动作', 'New exercise'),
      sub: L('动作归属训练类型，并标注主练/辅练肌肉', 'An exercise belongs to a type and maps to muscles'),
      body: body(),
      foot:
        `<button class="btn btn-ghost" data-action="close-modal">${esc(L('取消', 'Cancel'))}</button>` +
        `<button class="btn btn-primary" data-editor-action="save">${icon('check', 'ic-sm')}${esc(
          L('保存动作', 'Save exercise')
        )}</button>`,
      large: true,
    })
  );

  root.addEventListener(
    'input',
    (event) => {
      const input = event.target as HTMLInputElement;
      if (input.matches('[data-editor-name]')) draft.name = input.value;
    },
    { signal }
  );

  root.addEventListener(
    'change',
    (event) => {
      const target = event.target as HTMLSelectElement;
      if (target.matches('[data-editor-category]')) {
        draft.category = target.value;
      } else if (target.matches('[data-muscle-role]')) {
        const muscleId = target.dataset.muscleRole ?? '';
        draft.roles[muscleId] = target.value as 'primary' | 'secondary' | '';
        showModal(
          modalFrame({
            title: exercise ? L('编辑动作', 'Edit exercise') : L('新建动作', 'New exercise'),
            sub: L('动作归属训练类型，并标注主练/辅练肌肉', 'An exercise belongs to a type and maps to muscles'),
            body: body(),
            foot:
              `<button class="btn btn-ghost" data-action="close-modal">${esc(L('取消', 'Cancel'))}</button>` +
              `<button class="btn btn-primary" data-editor-action="save">${icon('check', 'ic-sm')}${esc(
                L('保存动作', 'Save exercise')
              )}</button>`,
            large: true,
          })
        );
      }
    },
    { signal }
  );

  root.addEventListener(
    'click',
    (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-editor-action]');
      if (!target || target.dataset.editorAction !== 'save') return;
      const name = draft.name.trim();
      const error = document.getElementById('defEditorError');
      if (!name) {
        if (error) error.textContent = L('请填写动作名称', 'Exercise name is required');
        return;
      }
      if (!draft.category) {
        if (error) error.textContent = L('请选择训练类型', 'Choose a training type');
        return;
      }
      const id = draft.existing
        ? draft.id
        : uniqueId(name, ctx.store.config.exercises.map((item) => item.id));
      const muscles: ExerciseMuscle[] = Object.entries(draft.roles)
        .filter(([, role]) => role !== '')
        .map(([muscleId, role]) => ({ muscleId, role: role as 'primary' | 'secondary' }));
      const next: Exercise = {
        id,
        category: draft.category,
        muscles,
      };
      if (draft.hasNameKey && name === draft.initialName) {
        if (exercise?.nameKey) next.nameKey = exercise.nameKey;
      } else {
        next.name = name;
      }
      ctx.store.updateConfig((config) => {
        const index = config.exercises.findIndex((item) => item.id === id);
        if (index >= 0) config.exercises[index] = next;
        else config.exercises.push(next);
      });
      closeEditor();
      toast(L('动作已保存', 'Exercise saved'));
      onSaved?.(id);
    },
    { signal }
  );
}
