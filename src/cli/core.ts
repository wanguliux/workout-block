import { FieldDef, LogRow, StatDef, WorkoutConfig } from '../data/types';
import { parseMass } from '../util/units';
import { parseDurationInput } from './durationInput';
import { CliError } from './errors';

/*
 * core.ts —— CLI 的纯领域辅助（零 Obsidian / 零 fs 依赖，可单测）。
 *
 * 这里承载「把 agent 翻译出的结构化参数落成合法数据」的全部规则：
 * 时间戳格式对齐插件（"YYYY-MM-DD HH:mm"）、时长按秒存储的多格式解析、
 * 字段值按 FieldDef 校验（质量字段按设置单位换算成 kg 存储）、
 * 与 workout-log 代码块一致的 date/week 分组键。
 */

// 与 DataManager.addLog 一致的时间戳格式：YYYY-MM-DD HH:mm（本地时区）。
export function formatTimestamp(d: Date = new Date()): string {
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 与 DataManager.todayStr 一致的日期格式：YYYY-MM-DD（本地时区）。
export function todayStr(d: Date = new Date()): string {
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 校验 "YYYY-MM-DD HH:mm" 时间戳（允许 "YYYY-MM-DD"，自动补 00:00）。返回规范化结果。 */
export function normalizeTimestamp(raw: string): string {
  const s = raw.trim();
  if (TIMESTAMP_RE.test(s)) return s;
  if (DATE_RE.test(s)) return `${s} 00:00`;
  // 允许 ISO 形式 YYYY-MM-DDTHH:mm（与插件 RecordModal 的 datetime-local 互转格式一致）
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16).replace('T', ' ');
  throw new CliError(`时间格式应为 "YYYY-MM-DD HH:mm"，收到："${raw}"`);
}

/** 校验 "YYYY-MM-DD" 日期。 */
export function assertDate(raw: string): string {
  const s = raw.trim();
  if (!DATE_RE.test(s)) throw new CliError(`日期格式应为 YYYY-MM-DD，收到："${raw}"`);
  return s;
}

/** 记录是否落在 [from, to] 日期区间（闭区间，任一端可省略）。 */
export function inDateRange(timestamp: string, from?: string, to?: string): boolean {
  const day = timestamp.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

// 时长解析器独立在 durationInput.ts（便于单测），此处导入并再导出供命令层统一从 core 引用。
export { parseDurationInput };

/**
 * 按字段定义解析并校验用户输入的字段值，返回「存储形态」：
 *  - number：parseFloat；mass 字段按插件设置单位换算成 kg 存储（与 RecordModal 一致）；
 *  - duration：多格式解析成秒（整数）；
 *  - select：必须命中 options（防止自由输入造成统计口径外的值）；
 *  - text：原样字符串。
 */
export function parseFieldValue(field: FieldDef, raw: string, unit: 'kg' | 'lb'): unknown {
  const value = raw.trim();
  switch (field.inputType) {
    case 'number': {
      const n = parseFloat(value);
      if (!Number.isFinite(n)) throw new CliError(`字段 ${field.key} 需要数字，收到："${raw}"`);
      return field.mass ? parseMass(value, unit) : n;
    }
    case 'duration':
      return parseDurationInput(value);
    case 'select': {
      const options = field.options ?? [];
      if (options.length > 0 && !options.includes(value)) {
        throw new CliError(`字段 ${field.key} 的值 "${raw}" 不在可选项内（${options.join(' / ')}）`);
      }
      return value;
    }
    case 'text':
      return value;
    case 'computed':
      // 计算字段不落库、由公式算出，CLI 不接受手动输入
      throw new CliError(`字段 ${field.key} 是计算字段，由公式自动算出，不能手动输入`);
  }
}

/**
 * 按训练类型的 FieldDef 列表校验并构造 fields 对象：
 * 拒绝未知字段 key（防止拼错静默丢失），缺失必填字段时报错。
 */
export function buildFields(
  typeFields: FieldDef[],
  input: Record<string, string>,
  unit: 'kg' | 'lb'
): Record<string, unknown> {
  const known = new Map(typeFields.map((f) => [f.key, f]));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      throw new CliError(
        `未知字段 "${key}"。该训练类型支持的字段：${typeFields.map((f) => f.key).join(', ') || '（无）'}`
      );
    }
  }
  const fields: Record<string, unknown> = {};
  for (const f of typeFields) {
    const raw = input[f.key];
    if (raw === undefined || raw === '') {
      if (f.required) throw new CliError(`缺少必填字段 "${f.key}"`);
      continue;
    }
    fields[f.key] = parseFieldValue(f, raw, unit);
  }
  return fields;
}

/** 分组键：date = YYYY-MM-DD；week = 该日所在 ISO 周的周一日期。 */
export function groupKey(timestamp: string, groupBy: 'date' | 'week'): string {
  const day = timestamp.slice(0, 10);
  if (groupBy === 'date') return day;
  return weekMonday(day);
}

/** 求某日期所在 ISO 周的周一（周一=每周第一天）。 */
export function weekMonday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dow = date.getDay() === 0 ? 7 : date.getDay(); // 周日=7
  date.setDate(date.getDate() - (dow - 1));
  return todayStr(date);
}

/** 按 id 或显示名解析统计项。 */
export function resolveStat(config: WorkoutConfig, nameOrId: string): StatDef | undefined {
  const lower = nameOrId.toLowerCase();
  return config.statistics.find(
    (s) => s.id.toLowerCase() === lower || s.name.toLowerCase() === lower
  );
}

/** 生成与现有记录（含已软删除 id）不重复的新 id。 */
export function uniqueId(taken: Set<string>, generate: () => string): string {
  let id = generate();
  while (taken.has(id)) id = generate();
  return id;
}

/** 按时间戳降序排序（新→旧），与 workout-log 默认 sort=desc 一致。 */
export function sortLogsDesc(logs: LogRow[]): LogRow[] {
  return logs.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
