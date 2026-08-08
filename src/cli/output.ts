import { LogRow, TrainingType, WorkoutConfig } from '../data/types';
import { getExerciseNameById, renderFieldValue } from '../data/display';

/*
 * output.ts —— CLI 的输出层：人读表格对齐 / JSON 机器输出，
 * 以及记录字段值的显示格式化（复用插件 display.ts，保证与界面一致）。
 */

/** 把一条记录的 fields 渲染成 "标签: 值" 串联的文字（按类型字段定义顺序）。 */
export function formatRecordFields(log: LogRow, config: WorkoutConfig, unit: 'kg' | 'lb'): string {
  const type: TrainingType | undefined = config.trainingTypes.find((t) => t.id === log.category);
  const fields = type?.fields ?? [];
  const parts: string[] = [];
  for (const f of fields) {
    const v = log.fields[f.key];
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${f.key}=${renderFieldValue(v, f, unit)}`);
  }
  // 不在字段定义里的键（如 _planSet 或历史字段）原样附在后面，避免信息丢失
  for (const [k, v] of Object.entries(log.fields)) {
    if (fields.some((f) => f.key === k)) continue;
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${k}=${String(v)}`);
  }
  return parts.join(' ');
}

/** 记录的一行摘要（人读输出统一走这里）。 */
export function logSummary(log: LogRow, config: WorkoutConfig, unit: 'kg' | 'lb'): string {
  const name = getExerciseNameById(config.exercises, log.exerciseId) || log.exerciseId || '(未知训练项)';
  const fields = formatRecordFields(log, config, unit);
  const extras: string[] = [];
  if (log.plan) extras.push(`方案=${log.plan}`);
  if (log.note) extras.push(`备注=${log.note}`);
  return [`${log.timestamp}  ${name}`, fields, ...extras].filter(Boolean).join('  ');
}

/** 简单等宽表格：按列宽对齐（中文按 2 字宽估算，肉眼整齐即可，不做严格字宽计算）。 */
export function renderTable(headers: string[], rows: string[][]): string {
  const width = (s: string): number => {
    let w = 0;
    for (const ch of s) w += ch.charCodeAt(0) > 0x2e7f ? 2 : 1;
    return w;
  };
  const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - width(s)));
  const all = [headers, ...rows];
  const colCount = headers.length;
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    widths.push(Math.max(...all.map((r) => width(r[c] ?? ''))));
  }
  const lines = all.map((r) => r.map((cell, c) => pad(cell ?? '', widths[c])).join('  '));
  return lines.join('\n');
}

/** --json 输出：稳定序列化后打印到 stdout。 */
export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}
