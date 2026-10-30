/*
 * format.ts —— 网页版展示工具（零框架）。
 * 统一收口：界面语言、转义、日期/时长/数字格式、字段摘要、文件下载。
 * 页面用模板字符串拼 HTML，所有用户数据必须经 esc() 输出。
 */

import type { FieldDef, LogRow, TrainingType, WorkoutConfig } from '../data/types';
import { getFieldLabel, getFieldUnit, renderFieldValue } from '../data/display';
import { materializeLog } from '../data/computedField';
import { formatDuration } from '../util/duration';
import { formatMass } from '../util/units';

let lang: 'zh' | 'en' = 'zh';

export function setWebLang(next: 'zh' | 'en'): void {
  lang = next;
}

export function getWebLang(): 'zh' | 'en' {
  return lang;
}

/** 行内双语：L('中文','English')。 */
export function L(zh: string, en: string): string {
  return lang === 'en' ? en : zh;
}

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function nowLocalValue(): string {
  const d = new Date();
  return `${todayStr(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function toStorageTime(v: string): string {
  return v.replace('T', ' ');
}

export function dateOf(timestamp: string): string {
  return (timestamp || '').slice(0, 10);
}

export function timeOf(timestamp: string): string {
  return (timestamp || '').slice(11, 16);
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return todayStr(dt);
}

export function isoWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 ? 7 : day;
}

export function weekdayLabel(iso: number, short = false): string {
  const zh = ['一', '二', '三', '四', '五', '六', '日'];
  const en = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const i = Math.max(1, Math.min(7, iso)) - 1;
  if (short) return lang === 'en' ? en[i] : zh[i];
  return lang === 'en' ? en[i] : `周${zh[i]}`;
}

export function dateLong(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const iso = isoWeekday(dateStr);
  if (lang === 'en') {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[m - 1]} ${d}, ${y} · ${weekdayLabel(iso, true)}`;
  }
  return `${y} 年 ${m} 月 ${d} 日 · ${weekdayLabel(iso)}`;
}

export function dayLabel(dateStr: string): string {
  const today = todayStr();
  if (dateStr === today) return L('今天', 'Today');
  if (dateStr === addDays(today, -1)) return L('昨天', 'Yesterday');
  if (dateStr === addDays(today, -2)) return L('前天', '2 days ago');
  return dateStr.slice(5);
}

export function monthDay(dateStr: string): string {
  return dateStr.slice(5);
}

export function formatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  const factor = 10 ** Math.max(0, Math.min(6, decimals));
  const rounded = Math.round(value * factor) / factor;
  return String(rounded);
}

export function formatInt(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN');
}

export function formatDecimals(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '—';
  const d = Math.max(0, Math.min(6, decimals));
  return value.toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function durationText(seconds: number): string {
  return formatDuration(seconds);
}

/** 当天训练跨度：多条记录取末组−首组；只有一条时取该条 duration_sec。 */
export function spanSeconds(dayLogs: LogRow[]): number {
  if (dayLogs.length === 0) return 0;
  if (dayLogs.length === 1) {
    const raw = dayLogs[0].fields?.duration_sec;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const log of dayLogs) {
    const m = (log.timestamp || '').match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) continue;
    const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
    min = Math.min(min, sec);
    max = Math.max(max, sec);
  }
  return min === Infinity ? 0 : Math.max(0, max - min);
}

export function spanMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}

export function streakDays(logs: LogRow[]): number {
  const days = new Set(logs.map((r) => dateOf(r.timestamp)).filter(Boolean));
  const today = todayStr();
  let cursor = days.has(today) ? today : addDays(today, -1);
  if (!days.has(cursor)) return 0;
  let count = 0;
  while (days.has(cursor)) {
    count++;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export interface ValueChip {
  label: string;
  value: string;
}

/** 把一条记录按类型字段渲染成 [标签, 值]（含派生字段）。 */
export function logValueChips(log: LogRow, config: WorkoutConfig): ValueChip[] {
  const type = config.trainingTypes.find((t) => t.id === log.category);
  const fields = type?.fields ?? [];
  const materialized = materializeLog(log, fields);
  const out: ValueChip[] = [];
  for (const field of fields) {
    const value = materialized.fields[field.key];
    if (value === undefined || value === null || value === '') continue;
    out.push({ label: getFieldLabel(field), value: renderFieldValue(value, field, unitOf(config)) });
  }
  if (out.length === 0) {
    for (const [key, value] of Object.entries(log.fields ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      out.push({ label: key, value: String(value) });
    }
  }
  return out;
}

let unitGetter: (() => 'kg' | 'lb') | null = null;
export function bindUnit(getter: () => 'kg' | 'lb'): void {
  unitGetter = getter;
}
function unitOf(_config?: WorkoutConfig): 'kg' | 'lb' {
  return unitGetter ? unitGetter() : 'kg';
}

/** 一组预设值的紧凑文字（如 60 kg × 8）。 */
export function compactFields(
  fields: Record<string, unknown>,
  type: TrainingType | undefined,
  unit: 'kg' | 'lb'
): string {
  if (type) {
    const weightField = type.fields.find((f) => f.key === 'weight' && f.inputType === 'number');
    const repsField = type.fields.find((f) => f.key === 'reps' && f.inputType === 'number');
    const weight = fields.weight;
    const reps = fields.reps;
    if (weightField && repsField && weight !== undefined && reps !== undefined && weight !== '' && reps !== '') {
      return `${formatMass(Number(weight), unit)} ${unit} × ${reps}`;
    }
  }
  const parts: string[] = [];
  for (const field of type?.fields ?? []) {
    if (field.inputType === 'computed') continue;
    const value = fields[field.key];
    if (value === undefined || value === null || value === '') continue;
    const text = renderFieldValue(value, field, unit);
    if (text) parts.push(text);
  }
  return parts.length ? parts.join(' · ') : '—';
}

export function fieldUnit(field: FieldDef, unit: 'kg' | 'lb'): string {
  return getFieldUnit(field, unit);
}

export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function slugId(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || `id-${Date.now().toString(36)}`;
}

/** 输入框里的时长展示：编辑既有秒值时回填数字秒，避免反复解析。 */
export function durationInputValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  return String(value);
}
