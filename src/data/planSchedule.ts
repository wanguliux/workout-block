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

/** 本地日历的今天（YYYY-MM-DD）。三端（插件/网页/CLI）判定「今天」必须同源，故收在此处。 */
export function todayLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * 当前排期窗口：最近一个「≤ day」的排期日（current）与它之前的那一个（previous，可能不存在）。
 *
 * 用途＝判定「本次排期做完了没」。完成态 `completedSets` 每组只存**一条**完成日期（最新一次），
 * 因此不能拿「key 存在」当已完成（那会让一次勾选永久生效），必须问：
 * 这条完成日期是否落在 (previous, current] 这个半开区间里——在，才算「本次排期已完成」。
 *
 * 例：weekday=[3,6]（周三/周六练），今天周六 → current=周六、previous=周三；
 *     完成日期=周三 → 不在窗口内 → 未完成（正确：周六还没练）。
 *     今天周五（非排期日）→ current=周三、previous=上周六；完成日期=周三 → 在窗口内 → 已完成。
 */
export function scheduledWindow(rule: TimeRule, day: string): { current?: string; previous?: string } {
  if (rule.type === 'cycle') {
    if (!rule.cycleStart) return {};
    const len = cycleLength(rule);
    const diff = dayDiff(rule.cycleStart, day);
    if (diff < 0) return {};
    const idx = Math.floor(diff / len);
    const current = shiftDay(rule.cycleStart, idx * len);
    // 第一个循环没有「上一个排期日」：窗口下界敞开，起始日之前不可能有完成记录。
    return idx >= 1 ? { current, previous: shiftDay(rule.cycleStart, (idx - 1) * len) } : { current };
  }
  if (rule.type === 'date') {
    const d = rule.date ?? '';
    // 指定日期未到 → 还没进入窗口（提前几天不该显示已完成）。
    if (!d || d > day) return {};
    return { current: d };
  }
  // weekday：一周至少一个排期日，往前扫 15 天必然收齐两个。
  const found: string[] = [];
  let cursor = day;
  for (let i = 0; i < 15 && found.length < 2; i++) {
    if (planMatchesDay(rule, cursor)) found.push(cursor);
    cursor = shiftDay(cursor, -1);
  }
  return { current: found[0], previous: found[1] };
}

/**
 * 某组是否「在本次排期窗口内已完成」。
 * completedDate 为空 / 当前无排期 / 完成日期早于窗口下界 / 晚于窗口上界 → 均判未完成。
 */
export function isCompletedInWindow(rule: TimeRule, day: string, completedDate?: string): boolean {
  if (!completedDate) return false;
  const { current, previous } = scheduledWindow(rule, day);
  if (!current) return false;
  if (completedDate > current) return false;
  if (previous && completedDate <= previous) return false;
  return true;
}

/**
 * 「本次排期窗口」的完成组数 / 总组数——插件面板与 CLI 列表共用这一份口径。
 * 只吃最小结构（exerciseId + sets[].id），不依赖 PlanItem 类型，保持纯函数。
 */
export function countPeriodSets(
  rule: TimeRule,
  day: string,
  items: ReadonlyArray<{ exerciseId: string; sets: ReadonlyArray<{ id: string }> }>,
  completedSets?: Record<string, string>
): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const item of items) {
    for (const set of item.sets) {
      total++;
      if (isCompletedInWindow(rule, day, completedSets?.[`${item.exerciseId}#${set.id}`])) done++;
    }
  }
  return { done, total };
}
