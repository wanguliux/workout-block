/**
 * decision/workoutLogWrite.ts —— workout-log 域写处理（workout-block 作为被写方）
 *
 * 跨插件写入（KOS 决策中心路由）：handleWorkoutActions 是 executeActions 的真实写入口，
 * workoutLogContract 是向外声明的写契约（供宿主写穿前校验）。
 *
 * 分层：
 * - 纯核心（normalizeLog/校验/幂等判定/契约构建）零 obsidian 依赖，可单测；
 * - 薄壳层（readLogs/addLog/updateLog/deleteLog/notice）由 contributor 注入 dataManager 实现，
 *   避免循环依赖。
 *
 * 纪律（机制文档 §1.5）：宿主预检是"断言"，本模块 executeActions 内的语义校验才是"真闸"；
 * 幂等/边界以本插件为准（同一条训练记录不重复入账）。
 *
 * 写路径单一真相源在 DataManager（addLog O(1) 追加 / updateLog 防抖写 / deleteLog 软删墓碑），
 * 跨插件写与录入弹窗/CLI 落盘逐字节同构，不另写平行实现。
 * update/remove 的 id 来自 raw-records 查询返回的稳定主键（AI 可先查、后改/删）。
 */
import type { DomainWriteContract, WriteAction } from './types';
import type { LogRow, WorkoutConfig } from '../data/types';

/** YYYY-MM-DD 或 YYYY-MM-DD HH:mm（留空 = 由 DataManager 落当前时间） */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;

/** executeActions 所需的插件侧能力（由 contributor 注入 DataManager 实现） */
export interface WorkoutWriteApi {
  /** 当前配置（含训练类型/训练项词表；含兜底默认值，冷启动期间可能非真实配置） */
  getConfigSync(): WorkoutConfig;
  /** 读当前已存活记录（幂等判重 / update/remove 定位用） */
  readLogs(): LogRow[];
  /** 追加一条训练记录（O(1)，id/timestamp 由 DataManager 补全） */
  addLog(row: Omit<LogRow, 'id' | 'timestamp'> & { timestamp?: string }): Promise<void>;
  /** 按稳定主键更新一条记录（防抖写盘） */
  updateLog(id: string, updates: Partial<LogRow>): Promise<void>;
  /** 按稳定主键软删除一条记录（墓碑） */
  deleteLog(id: string): Promise<void>;
  /** 写入结果提示（成功静默、失败/拦截 human 提示） */
  notice(msg: string): void;
}

// ── 写契约 ──────────────────────────────────────────────

/**
 * workout-log 域写契约：operation = log-workout / update-log / remove-log。
 * 枚举词表（训练类型/训练项）从当前 config 动态物化——提供写契约时读取当下配置，
 * 宿主在写穿前调用，可为最新配置。
 */
export function workoutLogContract(config: WorkoutConfig): DomainWriteContract {
  const categoryValues = (config.trainingTypes ?? []).map((tt) => tt.id);
  const exerciseValues = (config.exercises ?? []).map((e) => e.id);
  return {
    pluginId: 'workout-block',
    writableDomains: ['workout-log'],
    operations: {
      'log-workout': {
        target: 'dynamic',
        requiredFields: ['category', 'timestamp'],
        fieldsSchema: {
          category: { type: 'enum', enum: categoryValues, required: true },
          timestamp: { type: 'string', required: true },
          exerciseId: { type: 'enum', enum: exerciseValues },
          fields: { type: 'list' },
          note: { type: 'string' },
          plan: { type: 'string' },
        },
        appendOnly: true,
        mode: 'local',
      },
      'update-log': {
        target: 'dynamic',
        requiredFields: ['id'],
        fieldsSchema: {
          id: { type: 'string', required: true },
          category: { type: 'enum', enum: categoryValues },
          exerciseId: { type: 'enum', enum: exerciseValues },
          timestamp: { type: 'string' },
          fields: { type: 'list' },
          note: { type: 'string' },
          plan: { type: 'string' },
        },
        mode: 'local',
      },
      'remove-log': {
        target: 'dynamic',
        requiredFields: ['id'],
        fieldsSchema: {
          id: { type: 'string', required: true },
        },
        mode: 'local',
      },
    },
  };
}

// ── 纯核心：归一化与校验 ─────────────────────────────────

/** 归一化结果：可入库的训练记录行（id/timestamp 由 DataManager 兜底） */
export type LogNormResult =
  | { ok: true; row: Partial<LogRow> }
  | { ok: false; error: string };

/** 训练类型字段合法 key（含 legacyKeys 别名） */
function fieldKeysFor(config: WorkoutConfig, category: string): string[] {
  const tt = (config.trainingTypes ?? []).find((c) => c.id === category);
  if (!tt) return [];
  const keys = new Set<string>();
  for (const f of tt.fields ?? []) {
    keys.add(f.key);
    for (const lk of f.legacyKeys ?? []) keys.add(lk);
  }
  return [...keys];
}

/**
 * 把跨插件提议的原始 data 归一化为合法训练记录（写契约第二道闸，add/update 共用）。
 * category 在 add（log-workout）路径上必须提供（见 runLog），在 update 路径可省略表示"不改"。
 * 校验（仅对已提供的字段）：category 词表 → exerciseId 词表/归属 → timestamp 格式 → fields 词表。
 */
export function normalizeLog(data: unknown, config: WorkoutConfig): LogNormResult {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: '写入数据应为对象' };
  }
  const d = data as Record<string, unknown>;

  let category: string | undefined;
  if (typeof d.category === 'string') {
    const c = d.category.trim();
    if (c === '') return { ok: false, error: '训练类型 category 不能为空' };
    if (!(config.trainingTypes ?? []).some((tt) => tt.id === c)) {
      return { ok: false, error: `训练类型「${c}」不在词表内` };
    }
    category = c;
  }

  let exerciseId: string | undefined;
  if (typeof d.exerciseId === 'string' && d.exerciseId.trim() !== '') {
    const exId = d.exerciseId.trim();
    const ex = (config.exercises ?? []).find((e) => e.id === exId);
    if (!ex) return { ok: false, error: `训练项「${exId}」不在词表内` };
    if (category && ex.category !== category) {
      return { ok: false, error: `训练项「${ex.id}」归属类型为 ${ex.category}，与 category=${category} 不符` };
    }
    exerciseId = ex.id;
  }

  let timestamp: string | undefined;
  if (typeof d.timestamp === 'string' && d.timestamp.trim() !== '') {
    const ts = d.timestamp.trim();
    if (!TIMESTAMP_RE.test(ts)) return { ok: false, error: `timestamp 格式非法：${d.timestamp}` };
    timestamp = ts;
  }

  let fields: Record<string, unknown> | undefined;
  if (d.fields !== undefined && d.fields !== null) {
    if (typeof d.fields !== 'object' || Array.isArray(d.fields)) {
      return { ok: false, error: 'fields 应为对象' };
    }
    const keyScope = category ? fieldKeysFor(config, category) : null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d.fields as Record<string, unknown>)) {
      if (v === undefined || v === null || v === '') continue; // 空字段不落库
      if (keyScope && !keyScope.includes(k)) {
        return { ok: false, error: `字段「${k}」不在训练类型 ${category} 的字段词表内` };
      }
      out[k] = v;
    }
    fields = out;
  }

  const note = typeof d.note === 'string' && d.note.trim() !== '' ? d.note.trim() : undefined;
  const plan = typeof d.plan === 'string' && d.plan.trim() !== '' ? d.plan.trim() : undefined;

  return { ok: true, row: { category, exerciseId, timestamp, fields, note, plan } };
}

/** 同一条训练记录判定（幂等判重用）：category + exerciseId + timestamp + fields + note + plan 全等 */
function sameLog(a: { category?: string; exerciseId?: string; timestamp?: string; fields?: Record<string, unknown>; note?: string; plan?: string }, b: LogRow): boolean {
  return (
    (a.category ?? '') === (b.category ?? '') &&
    (a.exerciseId ?? '') === (b.exerciseId ?? '') &&
    (a.timestamp ?? '') === (b.timestamp ?? '') &&
    (a.note ?? '') === (b.note ?? '') &&
    (a.plan ?? '') === (b.plan ?? '') &&
    JSON.stringify(a.fields ?? {}) === JSON.stringify(b.fields ?? {})
  );
}

// ── 执行层（薄壳：调用方注入耗时 IO，本模块同步编排启动异步落盘） ──

/**
 * 编排一组 workout-log 域 WriteAction 的写入（供 contributor.executeActions 调用）。
 * 与 KOS 宿主 executeDecisionActions 同构：同步返回、内部以 void 启动异步落盘，
 * 单条失败只记录/提示，不中断整批。纪律：写入由插件发生，AI 不直接写。
 */
export function handleWorkoutActions(api: WorkoutWriteApi, actions: WriteAction[]): void {
  for (const a of actions) {
    if (a.domain !== 'workout-log') {
      api.notice(`workout-log 写：忽略非本域动作 ${a.domain}`);
      continue;
    }
    switch (a.operation) {
      case 'log-workout':
        void runLog(api, a);
        break;
      case 'update-log':
        void runUpdate(api, a);
        break;
      case 'remove-log':
        void runRemove(api, a);
        break;
      default:
        api.notice(`workout-log 写：不支持操作 ${a.operation}`);
    }
  }
}

async function runLog(api: WorkoutWriteApi, a: WriteAction): Promise<void> {
  const norm = normalizeLog(a.data, api.getConfigSync());
  if (!norm.ok) {
    api.notice(`workout-log 写拦截：${norm.error}`);
    return;
  }
  if (!norm.row.category || !norm.row.timestamp) {
    api.notice('workout-log 写拦截：log-workout 缺少训练类型 category 或时间 timestamp');
    return;
  }
  // 幂等：同样的一条训练记录（category+exerciseId+timestamp+fields+note+plan）已存在则跳过
  const existing = api.readLogs();
  if (existing.some((l) => sameLog(norm.row, l))) return;
  await api.addLog(norm.row as Omit<LogRow, 'id' | 'timestamp'> & { timestamp?: string });
}

async function runUpdate(api: WorkoutWriteApi, a: WriteAction): Promise<void> {
  if (typeof a.data !== 'object' || a.data === null || Array.isArray(a.data)) {
    api.notice('workout-log 写拦截：update-log 数据应为对象');
    return;
  }
  const d = a.data as Record<string, unknown>;
  const id = d.id;
  const refId = typeof id === 'string' ? id : '';
  if (!refId) {
    api.notice('workout-log 写拦截：update-log 缺少 id');
    return;
  }
  if (!api.readLogs().some((l) => l.id === refId)) {
    api.notice(`workout-log 写：未找到要更新的记录（id ${refId}）`);
    return;
  }
  const norm = normalizeLog(a.data, api.getConfigSync());
  if (!norm.ok) {
    api.notice(`workout-log 写拦截：${norm.error}`);
    return;
  }
  const { exerciseId, timestamp, note, plan, category } = norm.row;
  // 部分更新：只写入调用方实际提供的字段，缺失字段保持原值（不覆盖）
  const updates: Partial<LogRow> = {};
  if (category !== undefined) updates.category = category;
  if (exerciseId !== undefined) updates.exerciseId = exerciseId;
  if (timestamp !== undefined) updates.timestamp = timestamp;
  if (note !== undefined) updates.note = note;
  if (plan !== undefined) updates.plan = plan;
  if ('fields' in d && d.fields !== undefined && d.fields !== null) updates.fields = norm.row.fields;
  await api.updateLog(refId, updates);
}

async function runRemove(api: WorkoutWriteApi, a: WriteAction): Promise<void> {
  if (typeof a.data !== 'object' || a.data === null || Array.isArray(a.data)) {
    api.notice('workout-log 写拦截：remove-log 数据应为对象');
    return;
  }
  const idValue = (a.data as Record<string, unknown>).id;
  const refId = typeof idValue === 'string' ? idValue : '';
  if (!refId) {
    api.notice('workout-log 写拦截：remove-log 缺少 id');
    return;
  }
  if (!api.readLogs().some((l) => l.id === refId)) {
    api.notice(`workout-log 写：未找到要删除的记录（id ${refId}）`);
    return;
  }
  await api.deleteLog(refId);
}