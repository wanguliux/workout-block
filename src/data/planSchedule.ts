import type { TimeRule } from './types';

/*
 * planSchedule.ts —— 「哪天该练」的唯一排期真相源（纯函数，无插件依赖）。
 * 插件（决策中心查询 / 计划完成面板）、网页版、CLI 共用同一份判定，避免规则改动时多处各改一份。
 *
 * 三种规则：
 *  - date    ：只在指定日期排期；
 *  - weekday ：ISO 周几包含即排期（周一=1 … 周日=7）；
 *  - cycle   ：自循环起始日期起，每 N 天排期一次（起始日当天即第 1 个训练日）。
 */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 日期 ±天数（按本地日历推进，返回 YYYY-MM-DD）。 */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** ISO 周几（周一=1 … 周日=7）。 */
export function isoWeekdayOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 ? 7 : dow;
}

/** 从 a 到 b 的整天数（UTC 取整，规避夏令时导致的 ±1 小时误差）。 */
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** 循环周期天数：非法值（缺省/0/负数/非数字）退回 1 天，保证判定结果确定。 */
export function cycleLength(rule: TimeRule): number {
  const n = Math.trunc(Number(rule.cycleDays));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** day 落在第几个循环（0 起）；早于起始日期或无起始日期返回 -1。 */
export function cycleIndexOn(rule: TimeRule, day: string): number {
  if (!rule.cycleStart) return -1;
  const diff = dayDiff(rule.cycleStart, day);
  if (diff < 0) return -1;
  return Math.floor(diff / cycleLength(rule));
}

/** 某计划时间规则在指定日期是否排期。 */
export function planMatchesDay(rule: TimeRule, day: string): boolean {
  switch (rule.type) {
    case 'date':
      return (rule.date ?? '') === day;
    case 'weekday':
      return (rule.weekdays ?? []).includes(isoWeekdayOf(day));
    case 'cycle': {
      if (!rule.cycleStart) return false;
      const diff = dayDiff(rule.cycleStart, day);
      return diff >= 0 && diff % cycleLength(rule) === 0;
    }
    default:
      return false;
  }
}

/**
 * 完成态归属的周期键（同键即同一周期，用于「本周期内是否已完成」判定）：
 *  - date  ：当天；
 *  - weekday：所在 ISO 周的周一；
 *  - cycle ：所在循环的起始日。
 */
export function planPeriodKey(rule: TimeRule, day: string): string {
  switch (rule.type) {
    case 'weekday':
      return shiftDay(day, -(isoWeekdayOf(day) - 1));
    case 'cycle': {
      const idx = cycleIndexOn(rule, day);
      if (idx < 0) return day;
      return shiftDay(rule.cycleStart as string, idx * cycleLength(rule));
    }
    default:
      return day;
  }
}

/** 规范化时间规则：缺省/非法值就地回退（UI 与 CLI 共用，两处回退口径不会漂）。 */
export function normalizeTimeRule(rule: TimeRule, today: string): TimeRule {
  if (rule.type === 'weekday') {
    const days = Array.from(
      new Set((rule.weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))
    ).sort((a, b) => a - b);
    return { type: 'weekday', weekdays: days.length ? days : [1] };
  }
  if (rule.type === 'cycle') {
    return { type: 'cycle', cycleDays: cycleLength(rule), cycleStart: rule.cycleStart || today };
  }
  return { type: 'date', date: rule.date || today };
}
