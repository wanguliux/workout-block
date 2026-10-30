/*
 * fields.ts —— 动态字段控件（记录表单 / 计划编辑 / 日志编辑共用）。
 * 训练类型的字段定义直接驱动界面：数字、时长、文本、下拉与派生字段。
 * 存储统一为「kg / 秒」，只在输入与显示时按用户单位换算。
 */

import { FieldDef, TrainingType } from '../data/types';
import { getFieldLabel, getFieldUnit, renderFieldValue } from '../data/display';
import { evalFieldExpr } from '../data/statExpr';
import { formatMass, parseMass } from '../util/units';
import { parseDurationInput } from '../cli/durationInput';
import { L, esc } from './format';

export type DraftValues = Record<string, string>;

export interface ParseOutcome {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export function isInputField(field: FieldDef): boolean {
  return field.inputType !== 'computed';
}

export function fieldInputValue(field: FieldDef, value: unknown, unit: 'kg' | 'lb'): string {
  if (value === undefined || value === null || value === '') return '';
  switch (field.inputType) {
    case 'duration':
      return String(Math.round(Number(value)));
    case 'number':
      return field.mass ? formatMass(Number(value), unit) : String(value);
    case 'select':
    case 'text':
      return String(value);
    default:
      return '';
  }
}

function placeholderOf(field: FieldDef): string {
  switch (field.inputType) {
    case 'duration':
      return L('如 1分30秒 / 90', 'e.g. 1m30s / 90');
    case 'number':
      return field.mass ? L('输入重量', 'Weight') : L('输入数字', 'Number');
    default:
      return '';
  }
}

export function parseFieldRaw(field: FieldDef, raw: string | undefined, unit: 'kg' | 'lb'): ParseOutcome {
  const text = (raw ?? '').trim();
  if (text === '') {
    if (field.required) {
      return { ok: false, error: L(`请填写「${getFieldLabel(field)}」`, `"${getFieldLabel(field)}" is required`) };
    }
    return { ok: true, value: undefined };
  }

  if (field.inputType === 'duration') {
    try {
      const seconds = parseDurationInput(text);
      if (seconds < 0) throw new Error('negative');
      return { ok: true, value: seconds };
    } catch {
      return {
        ok: false,
        error: L(`「${getFieldLabel(field)}」格式无效，可用 90 / 1分30秒 / 1:30`, `Invalid "${getFieldLabel(field)}"; try 90 / 1m30s / 1:30`),
      };
    }
  }

  if (field.inputType === 'number') {
    const num = Number(text);
    if (!Number.isFinite(num)) {
      return { ok: false, error: L(`「${getFieldLabel(field)}」需要数字`, `"${getFieldLabel(field)}" must be a number`) };
    }
    if (num < 0) {
      return { ok: false, error: L(`「${getFieldLabel(field)}」不能为负数`, `"${getFieldLabel(field)}" cannot be negative`) };
    }
    return { ok: true, value: field.mass ? parseMass(text, unit) : num };
  }

  if (field.inputType === 'select' && field.options?.length) {
    if (!field.options.includes(text)) {
      return { ok: false, error: L(`「${getFieldLabel(field)}」选项无效`, `Invalid option for "${getFieldLabel(field)}"`) };
    }
    return { ok: true, value: text };
  }

  return { ok: true, value: text };
}

export type ParseDraftResult =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; error: string; key?: string };

export function parseDraft(type: TrainingType, values: DraftValues, unit: 'kg' | 'lb'): ParseDraftResult {
  const fields: Record<string, unknown> = {};
  for (const field of type.fields) {
    if (!isInputField(field)) continue;
    const result = parseFieldRaw(field, values[field.key], unit);
    if (!result.ok) return { ok: false, error: result.error ?? L('输入无效', 'Invalid input'), key: field.key };
    if (result.value !== undefined) fields[field.key] = result.value;
  }
  return { ok: true, fields };
}

/** 计划预设用：允许必填字段留空，只校验「已填但格式错误」的值。 */
export function parsePlanFields(type: TrainingType, values: DraftValues, unit: 'kg' | 'lb'): ParseDraftResult {
  const fields: Record<string, unknown> = {};
  for (const field of type.fields) {
    if (!isInputField(field)) continue;
    const raw = values[field.key];
    if ((raw ?? '').trim() === '') continue;
    const result = parseFieldRaw(field, raw, unit);
    if (!result.ok) return { ok: false, error: result.error ?? L('输入无效', 'Invalid input'), key: field.key };
    if (result.value !== undefined) fields[field.key] = result.value;
  }
  return { ok: true, fields };
}

export interface ComputedRow {
  key: string;
  label: string;
  text: string;
}

export function computedRows(type: TrainingType | undefined, values: DraftValues, unit: 'kg' | 'lb'): ComputedRow[] {
  if (!type) return [];
  const materialized: Record<string, unknown> = {};
  for (const field of type.fields) {
    if (!isInputField(field)) continue;
    const parsed = parseFieldRaw(field, values[field.key], unit);
    if (parsed.ok && parsed.value !== undefined) materialized[field.key] = parsed.value;
  }
  const rows: ComputedRow[] = [];
  for (const field of type.fields) {
    if (field.inputType !== 'computed' || !field.formula) continue;
    let text = '—';
    try {
      const value = evalFieldExpr(field.formula, materialized);
      text = renderFieldValue(value, field, unit) || '—';
    } catch {
      text = '—';
    }
    rows.push({ key: field.key, label: getFieldLabel(field), text });
  }
  return rows;
}

export function computedBlockHTML(type: TrainingType | undefined, values: DraftValues, unit: 'kg' | 'lb'): string {
  const rows = computedRows(type, values, unit);
  if (rows.length === 0) return '';
  return (
    '<div class="computed" data-computed>' +
    `<span class="tag">${esc(L('派生', 'DERIVED'))}</span>` +
    rows
      .map(
        (row) =>
          `<span class="chip" data-computed-key="${esc(row.key)}">${esc(row.label)} <b>${esc(row.text)}</b></span>`
      )
      .join('') +
    '</div>'
  );
}

export function fieldBlockHTML(
  field: FieldDef,
  raw: string,
  unit: 'kg' | 'lb',
  attr: string
): string {
  const label = getFieldLabel(field);
  const unitText = getFieldUnit(field, unit);
  const required = field.required ? '<span class="req">*</span>' : '';
  let control = '';

  if (field.inputType === 'select') {
    const options = field.options ?? [];
    control =
      `<select class="select" ${attr}="${esc(field.key)}">` +
      (field.required ? '' : `<option value="">${esc(L('不选择', 'None'))}</option>`) +
      options
        .map(
          (opt) =>
            `<option value="${esc(opt)}"${String(raw) === opt ? ' selected' : ''}>${esc(opt)}</option>`
        )
        .join('') +
      '</select>';
  } else if (field.inputType === 'text') {
    control = `<input class="input" type="text" ${attr}="${esc(field.key)}" value="${esc(raw)}" />`;
  } else {
    control =
      `<input class="input" type="text" inputmode="decimal" autocomplete="off" ` +
      `${attr}="${esc(field.key)}" value="${esc(raw)}" placeholder="${esc(placeholderOf(field))}" />`;
  }

  return (
    `<div class="field" data-field-wrap="${esc(field.key)}">` +
    `<label>${esc(label)}${required}</label>` +
    (unitText
      ? `<div class="combo">${control}<span class="unit-suffix">${esc(unitText)}</span></div>`
      : control) +
    '</div>'
  );
}

export function fieldGridHTML(
  type: TrainingType | undefined,
  values: DraftValues,
  unit: 'kg' | 'lb',
  attr: string,
  extraClass = ''
): string {
  const fields = (type?.fields ?? []).filter(isInputField);
  if (fields.length === 0) {
    return `<div class="empty">${esc(L('该训练类型还没有可录入字段', 'This type has no input fields yet'))}</div>`;
  }
  return (
    `<div class="field-grid ${extraClass}">` +
    fields.map((field) => fieldBlockHTML(field, values[field.key] ?? '', unit, attr)).join('') +
    '</div>'
  );
}

/** 从一组输入框读取草稿值（用于弹窗内编辑，避免把每个键都挂到全局 state）。 */
export function readDraftFrom(root: ParentNode, attr = 'data-field'): DraftValues {
  const values: DraftValues = {};
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[${attr}]`).forEach((input) => {
    const key = input.getAttribute(attr) ?? '';
    if (key) values[key] = input.value;
  });
  return values;
}

export function refreshComputedIn(root: ParentNode, type: TrainingType | undefined, unit: 'kg' | 'lb', attr = 'data-field'): void {
  const block = root.querySelector<HTMLElement>('[data-computed]');
  if (!block) return;
  const rows = computedRows(type, readDraftFrom(root, attr), unit);
  for (const row of rows) {
    const chip = block.querySelector<HTMLElement>(`[data-computed-key="${row.key}"] b`);
    if (chip) chip.textContent = row.text;
  }
}
