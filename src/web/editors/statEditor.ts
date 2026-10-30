/*
 * statEditor.ts —— 统计指标编辑：引导式构建器 / 自由表达式、关联类型、单位与热力图分档。
 * 表达式校验复用 src/data/statExpr 的白名单解析器（禁用 eval）。
 */

import { StatAggregation, StatDef, StatGranularity } from '../../data/types';
import { getTrainingTypeName } from '../../data/display';
import { validateExpression } from '../../data/statExpr';
import { DEFAULT_HEATMAP_SCALE, colorToCss } from '../../data/heatmapDefaults';
import { generateId } from '../../util/id';
import { icon } from '../icons';
import { UiContext } from '../context';
import { L, esc } from '../format';
import { modalFrame, showModal, toast } from '../ui';
import { editorSignal, closeEditor } from './editorHost';

type BuilderKind = StatAggregation['kind'];

interface StatDraft {
  id: string;
  existing: boolean;
  name: string;
  unit: string;
  types: string[];
  mode: 'builder' | 'expression';
  kind: BuilderKind;
  field: string;
  fieldA: string;
  fieldB: string;
  weightField: string;
  repsField: string;
  expression: string;
  granularity: StatGranularity;
  enabled: boolean;
  heatmapDefault: boolean;
  levels: { color: string; max: string }[];
}

const KINDS: { value: BuilderKind; label: [string, string] }[] = [
  { value: 'count', label: ['记录条数', 'Count rows'] },
  { value: 'sum', label: ['求和', 'Sum'] },
  { value: 'avg', label: ['平均值', 'Average'] },
  { value: 'max', label: ['最大值', 'Max'] },
  { value: 'min', label: ['最小值', 'Min'] },
  { value: 'productSum', label: ['乘积求和', 'Product sum'] },
  { value: 'oneRepMax', label: ['1RM 估算', '1RM estimate'] },
];

function draftFrom(stat?: StatDef): StatDraft {
  const builder = stat?.formula.builder;
  const levels = (stat?.heatmapScale?.length ? stat.heatmapScale : DEFAULT_HEATMAP_SCALE).map((level) => ({
    color: colorToCss(level.color),
    max: level.max === undefined ? '' : String(level.max),
  }));
  while (levels.length < 4) levels.push({ color: '#ef4444', max: '' });
  return {
    id: stat?.id ?? generateId(8),
    existing: !!stat,
    name: stat?.name ?? '',
    unit: stat?.unit ?? '',
    types: [...(stat?.associatedTypes ?? [])],
    mode: stat?.formula.mode ?? 'builder',
    kind: builder?.kind ?? 'count',
    field: builder && 'field' in builder ? builder.field : '',
    fieldA: builder?.kind === 'productSum' ? builder.fieldA : '',
    fieldB: builder?.kind === 'productSum' ? builder.fieldB : '',
    weightField: builder?.kind === 'oneRepMax' ? builder.weightField : '',
    repsField: builder?.kind === 'oneRepMax' ? builder.repsField : '',
    expression: stat?.formula.expression ?? '',
    granularity: stat?.granularity ?? 'daily',
    enabled: stat?.enabled ?? true,
    heatmapDefault: stat?.heatmapDefault ?? false,
    levels,
  };
}

function allowedFields(ctx: UiContext, types: string[]): string[] {
  const lists = types
    .map((id) => ctx.store.config.trainingTypes.find((type) => type.id === id)?.fields ?? [])
    .filter((fields) => fields.length > 0);
  if (lists.length === 0) return [];
  return lists[0].filter((field) => lists.slice(1).every((list) => list.some((item) => item.key === field.key))).map((field) => field.key);
}

function fieldOptions(fields: string[], value: string, allowEmpty = false): string {
  return (
    (allowEmpty ? `<option value="">${esc(L('请选择字段', 'Choose a field'))}</option>` : '') +
    fields
      .map((key) => `<option value="${esc(key)}"${value === key ? ' selected' : ''}>${esc(key)}</option>`)
      .join('')
  );
}

function builderHTML(draft: StatDraft, fields: string[]): string {
  const select = (slot: string, value: string, label: string): string =>
    '<div class="field"><label>' +
    esc(label) +
    '</label><select class="select" data-stat-field data-slot="' +
    slot +
    '">' +
    fieldOptions(fields, value, true) +
    '</select></div>';

  let controls = '';
  if (draft.kind === 'sum' || draft.kind === 'avg' || draft.kind === 'max' || draft.kind === 'min') {
    controls = select('field', draft.field, L('字段', 'Field'));
  } else if (draft.kind === 'productSum') {
    controls =
      '<div class="editor-grid">' +
      select('fieldA', draft.fieldA, L('字段 A', 'Field A')) +
      select('fieldB', draft.fieldB, L('字段 B', 'Field B')) +
      '</div>';
  } else if (draft.kind === 'oneRepMax') {
    controls =
      '<div class="editor-grid">' +
      select('weightField', draft.weightField, L('重量字段', 'Weight field')) +
      select('repsField', draft.repsField, L('次数字段', 'Reps field')) +
      '</div>';
  }

  return (
    '<div class="field"><label>' +
    esc(L('计算方式', 'Aggregation')) +
    '</label><select class="select" data-stat-kind>' +
    KINDS.map(
      (kind) =>
        `<option value="${kind.value}"${draft.kind === kind.value ? ' selected' : ''}>${esc(
          L(kind.label[0], kind.label[1])
        )}</option>`
    ).join('') +
    '</select></div>' +
    controls
  );
}

function levelsHTML(draft: StatDraft): string {
  return (
    '<div class="level-grid">' +
    draft.levels
      .map(
        (level, index) =>
          '<div class="level-row">' +
          `<span class="level-no">${index + 1}</span>` +
          `<input type="color" data-level-color="${index}" value="${esc(level.color)}" />` +
          `<input class="input" type="number" min="0" step="any" data-level-max="${index}" value="${esc(
            level.max
          )}" placeholder="${index === 3 ? '∞' : L('上限', 'Max')}" />` +
          '</div>'
      )
      .join('') +
    `<div class="faint">${esc(L('最后一档留空表示无穷大', 'Leave the last band blank for infinity'))}</div>` +
    '</div>'
  );
}

function bodyHTML(ctx: UiContext, draft: StatDraft): string {
  const fields = allowedFields(ctx, draft.types);
  return (
    '<div class="stat-editor">' +
    '<div class="editor-grid">' +
    '<div class="field"><label>' +
    esc(L('统计名称', 'Statistic name')) +
    `</label><input class="input" data-editor-name value="${esc(draft.name)}" placeholder="${esc(
      L('如 训练总量', 'e.g. Training volume')
    )}" /></div>` +
    '<div class="field"><label>' +
    esc(L('单位（可选）', 'Unit (optional)')) +
    `</label><input class="input" data-editor-unit value="${esc(draft.unit)}" placeholder="${esc(
      L('如 kg / 次', 'e.g. kg / reps')
    )}" /></div>` +
    '</div>' +
    '<div class="section-title">' +
    esc(L('关联训练类型', 'Associated types')) +
    '</div>' +
    '<div class="check-grid">' +
    ctx.store.config.trainingTypes
      .map(
        (type) =>
          `<label class="check-inline"><input type="checkbox" data-stat-type="${esc(type.id)}"${
            draft.types.includes(type.id) ? ' checked' : ''
          } />${esc(getTrainingTypeName(type))}</label>`
      )
      .join('') +
    '</div>' +
    `<div class="faint" style="margin-top:6px">${esc(
      L('公式可选字段 = 这些类型字段的交集', 'Available fields are the intersection of these types’ fields')
    )}</div>` +
    '<div class="section-title">' +
    esc(L('构建方式', 'Method')) +
    '</div>' +
    '<div class="seg">' +
    `<button class="${draft.mode === 'builder' ? 'on' : ''}" data-editor-action="mode" data-mode="builder">${esc(
      L('引导式', 'Builder')
    )}</button>` +
    `<button class="${draft.mode === 'expression' ? 'on' : ''}" data-editor-action="mode" data-mode="expression">${esc(
      L('表达式', 'Expression')
    )}</button>` +
    '</div>' +
    (draft.mode === 'builder'
      ? builderHTML(draft, fields)
      : '<div class="field"><label>' +
        esc(L('表达式', 'Expression')) +
        `</label><textarea class="input mono" rows="3" data-stat-expression placeholder="sum(reps * weight)">${esc(
          draft.expression
        )}</textarea><div class="faint">${esc(
          L(
            `可用字段：${fields.length ? fields.join(', ') : '（先关联训练类型）'}；函数：sum / avg / max / min / count`,
            `Fields: ${fields.length ? fields.join(', ') : '(associate a type first)'}; functions: sum / avg / max / min / count`
          )
        )}</div></div>`) +
    '<div class="editor-grid">' +
    '<div class="field"><label>' +
    esc(L('统计粒度', 'Granularity')) +
    '</label><select class="select" data-stat-granularity>' +
    [
      ['daily', L('按日', 'Daily')],
      ['weekly', L('按周', 'Weekly')],
      ['monthly', L('按月', 'Monthly')],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}"${draft.granularity === value ? ' selected' : ''}>${esc(label)}</option>`
      )
      .join('') +
    '</select></div>' +
    '<div class="field"><label>' +
    esc(L('状态', 'Status')) +
    '</label><div class="setting-control left"><button class="switch' +
    (draft.enabled ? ' on' : '') +
    '" data-editor-action="toggle-enabled"></button><span class="muted-mini">' +
    esc(draft.enabled ? L('已启用', 'Enabled') : L('已停用', 'Disabled')) +
    '</span></div></div>' +
    '</div>' +
    '<div class="setting-row compact"><div class="setting-info"><b>' +
    esc(L('设为热力图默认指标', 'Default heatmap metric')) +
    '</b><span>' +
    esc(L('同一时间只能有一个默认指标', 'Only one metric can be the default')) +
    '</span></div><button class="switch' +
    (draft.heatmapDefault ? ' on' : '') +
    '" data-editor-action="toggle-default"></button></div>' +
    '<div class="section-title">' +
    esc(L('热力图默认分档', 'Default heatmap bands')) +
    `<button class="link-btn" data-editor-action="reset-levels">${esc(L('恢复默认', 'Reset'))}</button>` +
    '</div>' +
    levelsHTML(draft) +
    '<div class="form-error" id="statEditorError"></div>' +
    '</div>'
  );
}

function setError(message: string): void {
  const el = document.getElementById('statEditorError');
  if (el) el.textContent = message;
}

function save(ctx: UiContext, draft: StatDraft): void {
  const name = draft.name.trim();
  if (!name) {
    setError(L('请填写统计名称', 'Statistic name is required'));
    return;
  }
  if (draft.types.length === 0) {
    setError(L('请至少关联一个训练类型', 'Associate at least one training type'));
    return;
  }
  const fields = allowedFields(ctx, draft.types);

  let formula: StatDef['formula'];
  if (draft.mode === 'expression') {
    const expression = draft.expression.trim();
    if (!expression) {
      setError(L('请填写表达式', 'Expression is required'));
      return;
    }
    try {
      validateExpression(expression, fields);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return;
    }
    formula = { mode: 'expression', expression };
  } else {
    let builder: StatAggregation;
    if (draft.kind === 'count') {
      builder = { kind: 'count' };
    } else if (draft.kind === 'productSum') {
      if (!draft.fieldA || !draft.fieldB) {
        setError(L('请选择两个字段', 'Choose both fields'));
        return;
      }
      builder = { kind: 'productSum', fieldA: draft.fieldA, fieldB: draft.fieldB };
    } else if (draft.kind === 'oneRepMax') {
      if (!draft.weightField || !draft.repsField) {
        setError(L('请选择重量与次数字段', 'Choose weight and reps fields'));
        return;
      }
      builder = { kind: 'oneRepMax', weightField: draft.weightField, repsField: draft.repsField };
    } else {
      if (!draft.field) {
        setError(L('请选择字段', 'Choose a field'));
        return;
      }
      builder = { kind: draft.kind, field: draft.field };
    }
    formula = { mode: 'builder', builder };
  }

  const parsedLevels = draft.levels.map((level, index) => ({
    color: level.color,
    max: level.max.trim() === '' ? (index === 3 ? undefined : NaN) : Number(level.max),
  }));
  for (let i = 0; i < parsedLevels.length; i++) {
    const max = parsedLevels[i].max;
    if (max === undefined) continue;
    if (!Number.isFinite(max) || (max as number) < 0) {
      setError(L('分档上限需要是非负数字', 'Band max values must be non-negative numbers'));
      return;
    }
    if (i > 0 && parsedLevels[i - 1].max !== undefined && (max as number) <= (parsedLevels[i - 1].max as number)) {
      setError(L('分档上限需要逐档递增', 'Band max values must increase'));
      return;
    }
  }
  const heatmapScale = parsedLevels.map((level) => ({ color: level.color, max: level.max }));

  const stat: StatDef = {
    id: draft.id,
    name,
    unit: draft.unit.trim() || undefined,
    associatedTypes: [...draft.types],
    formula,
    granularity: draft.granularity,
    enabled: draft.enabled,
    heatmapDefault: draft.heatmapDefault || undefined,
    heatmapScale,
  };

  ctx.store.updateConfig((config) => {
    if (stat.heatmapDefault) {
      for (const other of config.statistics) {
        if (other.id !== stat.id) other.heatmapDefault = false;
      }
    }
    const index = config.statistics.findIndex((item) => item.id === stat.id);
    if (index >= 0) config.statistics[index] = stat;
    else config.statistics.push(stat);
  });
  closeEditor();
  toast(L('统计已保存', 'Statistic saved'));
}

function rerender(ctx: UiContext, draft: StatDraft, editing: boolean): void {
  showModal(
    modalFrame({
      title: editing ? L('编辑统计指标', 'Edit statistic') : L('新建统计指标', 'New statistic'),
      sub: L('统计值会随训练记录实时计算', 'Values are computed from your logs in real time'),
      body: bodyHTML(ctx, draft),
      foot:
        `<button class="btn btn-ghost" data-action="close-modal">${esc(L('取消', 'Cancel'))}</button>` +
        `<button class="btn btn-primary" data-editor-action="save">${icon('check', 'ic-sm')}${esc(L('保存', 'Save'))}</button>`,
      large: true,
    })
  );
}

export function openStatEditor(ctx: UiContext, statId?: string): void {
  const stat = statId ? ctx.store.config.statistics.find((item) => item.id === statId) : undefined;
  const draft = draftFrom(stat);
  const signal = editorSignal();
  const root = document.getElementById('modalRoot');
  if (!root) return;

  rerender(ctx, draft, !!stat);

  root.addEventListener(
    'input',
    (event) => {
      const input = event.target as HTMLInputElement;
      if (input.matches('[data-editor-name]')) draft.name = input.value;
      else if (input.matches('[data-editor-unit]')) draft.unit = input.value;
      else if (input.matches('[data-stat-expression]')) draft.expression = input.value;
      else if (input.matches('[data-level-color]')) draft.levels[Number(input.dataset.levelColor)].color = input.value;
      else if (input.matches('[data-level-max]')) draft.levels[Number(input.dataset.levelMax)].max = input.value;
    },
    { signal }
  );

  root.addEventListener(
    'change',
    (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      if (target.matches('[data-stat-type]')) {
        const id = (target as HTMLInputElement).dataset.statType ?? '';
        const checked = (target as HTMLInputElement).checked;
        draft.types = checked ? [...new Set([...draft.types, id])] : draft.types.filter((item) => item !== id);
        rerender(ctx, draft, !!stat);
      } else if (target.matches('[data-stat-kind]')) {
        draft.kind = (target as HTMLSelectElement).value as BuilderKind;
        rerender(ctx, draft, !!stat);
      } else if (target.matches('[data-stat-field]')) {
        const slot = (target as HTMLSelectElement).dataset.slot as 'field' | 'fieldA' | 'fieldB' | 'weightField' | 'repsField';
        draft[slot] = (target as HTMLSelectElement).value;
      } else if (target.matches('[data-stat-granularity]')) {
        draft.granularity = (target as HTMLSelectElement).value as StatGranularity;
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
      if (action === 'mode') {
        draft.mode = target.dataset.mode === 'expression' ? 'expression' : 'builder';
        rerender(ctx, draft, !!stat);
      } else if (action === 'toggle-enabled') {
        draft.enabled = !draft.enabled;
        target.classList.toggle('on', draft.enabled);
        const label = target.parentElement?.querySelector('.muted-mini');
        if (label) label.textContent = draft.enabled ? L('已启用', 'Enabled') : L('已停用', 'Disabled');
      } else if (action === 'toggle-default') {
        draft.heatmapDefault = !draft.heatmapDefault;
        target.classList.toggle('on', draft.heatmapDefault);
      } else if (action === 'reset-levels') {
        draft.levels = DEFAULT_HEATMAP_SCALE.map((level) => ({
          color: colorToCss(level.color),
          max: level.max === undefined ? '' : String(level.max),
        }));
        rerender(ctx, draft, !!stat);
      } else if (action === 'save') {
        save(ctx, draft);
      }
    },
    { signal }
  );
}
