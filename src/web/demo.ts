/*
 * demo.ts —— 演示数据注入（网页版专用：投稿评审、初次试用）。
 *
 * 为什么需要：网页版首访是空态（0 组 / 空图表 / 热力图无记录），
 * 第一次打开的人看不到界面真实能力。这里提供一次性「载入演示数据」。
 *
 * 约定：
 *  - 只写训练记录（store.addLog），不动训练类型、字段、肌肉映射与设置；
 *  - 日期按「相对今天」生成，任何一天打开都能看到最近两周的活跃曲线；
 *  - 今天会补 1–2 组匹配当日计划的记录，让「今日安排」的完成度不是 0；
 *  - 配置里已不存在的动作自动跳过，不会造脏数据。
 */

import { addDays, todayStr } from './format';
import type { WebStore } from './store';

interface DemoRow {
  day: number; // 相对今天的天数偏移（0 = 今天，-1 = 昨天）
  time: string; // HH:mm
  category: string;
  exerciseId: string;
  fields: Record<string, unknown>;
  note?: string;
}

const DEMO_ROWS: DemoRow[] = [
  { day: -13, time: '07:20', category: 'aerobic', exerciseId: 'running', fields: { duration_sec: 2100, distance_km: 12 } },
  { day: -12, time: '20:00', category: 'strength', exerciseId: 'squat', fields: { weight: 50, reps: 10 } },
  { day: -12, time: '20:06', category: 'strength', exerciseId: 'squat', fields: { weight: 50, reps: 10 } },
  { day: -11, time: '18:30', category: 'strength', exerciseId: 'bench_press', fields: { weight: 45, reps: 12 } },
  { day: -11, time: '18:36', category: 'strength', exerciseId: 'bench_press', fields: { weight: 45, reps: 10 } },
  { day: -9, time: '09:15', category: 'strength', exerciseId: 'squat', fields: { weight: 55, reps: 10 } },
  { day: -9, time: '09:22', category: 'strength', exerciseId: 'squat', fields: { weight: 57.5, reps: 8 } },
  { day: -8, time: '12:30', category: 'aerobic', exerciseId: 'jumping_rope', fields: { duration_sec: 1200 } },
  { day: -6, time: '18:40', category: 'strength', exerciseId: 'dumbbell_bench_press', fields: { weight: 16, reps: 12 }, note: '哑铃单边重量' },
  { day: -6, time: '18:52', category: 'strength', exerciseId: 'barbell_row', fields: { weight: 40, reps: 12 } },
  { day: -5, time: '19:20', category: 'bodyweight', exerciseId: 'pullup', fields: { reps: 8 }, note: '状态不错' },
  { day: -5, time: '19:24', category: 'bodyweight', exerciseId: 'pullup', fields: { reps: 7 } },
  { day: -5, time: '19:28', category: 'bodyweight', exerciseId: 'plank', fields: { duration_sec: 90 } },
  { day: -4, time: '18:50', category: 'strength', exerciseId: 'deadlift', fields: { weight: 80, reps: 5 } },
  { day: -4, time: '18:56', category: 'strength', exerciseId: 'deadlift', fields: { weight: 82.5, reps: 5 } },
  { day: -3, time: '07:10', category: 'aerobic', exerciseId: 'running', fields: { duration_sec: 1860, distance_km: 10 } },
  { day: -2, time: '07:40', category: 'aerobic', exerciseId: 'cycling', fields: { duration_sec: 2700, distance_km: 15 } },
  { day: -2, time: '19:10', category: 'strength', exerciseId: 'bench_press', fields: { weight: 52.5, reps: 8 } },
  { day: -2, time: '19:18', category: 'strength', exerciseId: 'bench_press', fields: { weight: 52.5, reps: 7 } },
  { day: -1, time: '19:20', category: 'strength', exerciseId: 'squat', fields: { weight: 70, reps: 6 }, note: '今天状态在线' },
  { day: -1, time: '19:28', category: 'strength', exerciseId: 'squat', fields: { weight: 72.5, reps: 5 } },
];

/** 今日计划里挑前两组预填记录，让「今日安排」不是 0/4。 */
function todayPlanRows(store: WebStore): DemoRow[] {
  const isoWeekday = new Date().getDay() || 7; // JS: 周日=0 → ISO 7
  const plan = (store.config.plans ?? []).find(
    (item) => item.timeRule.type === 'weekday' && (item.timeRule.weekdays ?? []).includes(isoWeekday)
  );
  if (!plan) return [];
  const rows: DemoRow[] = [];
  for (const item of plan.items.filter((entry) => entry.enabled).slice(0, 2)) {
    const preset = item.sets[0]?.fields ?? {};
    if (!Object.keys(preset).length) continue;
    const hour = String(8 + rows.length).padStart(2, '0');
    rows.push({
      day: 0,
      time: `${hour}:10`,
      category: item.category,
      exerciseId: item.exerciseId,
      fields: { ...preset },
    });
  }
  return rows;
}

/** 今天最近的几个时间点（避免演示记录出现在未来）。 */
function recentTimes(count: number): string[] {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const pad = (n: number) => String(n).padStart(2, '0');
  return Array.from({ length: count }, (_, i) => {
    const minutes = Math.max(1, nowMinutes - 40 + i * 15);
    return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
  });
}

/**
 * 今日兜底记录：当天没有匹配计划时也要有记录，
 * 否则首访看板仍是 0 组 / 0 kg，「载入演示数据」等于没生效。
 */
function todayFallbackRows(store: WebStore): DemoRow[] {
  const known = new Set(store.config.exercises.map((item) => item.id));
  const picks = [
    { category: 'strength', exerciseId: 'squat', fields: { weight: 70, reps: 6 } },
    { category: 'strength', exerciseId: 'bench_press', fields: { weight: 52.5, reps: 8 } },
  ].filter((row) => known.has(row.exerciseId));
  const times = recentTimes(picks.length);
  return picks.map((row, index) => ({ ...row, day: 0, time: times[index] }));
}

export interface DemoResult {
  added: number;
  days: number;
}

/** 注入演示记录；返回新增条数与覆盖天数。 */
export function seedDemoLogs(store: WebStore): DemoResult {
  const known = new Set(store.config.exercises.map((item) => item.id));
  const planRows = todayPlanRows(store);
  // 计划里已排到今天的动作优先；一个都没排到时补两条，保证「今日」不是空态。
  const todayRows = planRows.length ? planRows : todayFallbackRows(store);
  const rows = [...DEMO_ROWS, ...todayRows].filter((row) => known.has(row.exerciseId));
  const base = todayStr();
  const days = new Set<string>();
  for (const row of rows) {
    const date = addDays(base, row.day);
    days.add(date);
    store.addLog({
      timestamp: `${date} ${row.time}`,
      category: row.category,
      exerciseId: row.exerciseId,
      fields: { ...row.fields },
      note: row.note,
    });
  }
  return { added: rows.length, days: days.size };
}
