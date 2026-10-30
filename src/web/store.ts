/*
 * store.ts —— 网页版数据仓库（localStorage 版 VaultIO）。
 * 配置/日志/设置全部保存在本浏览器；数据结构、迁移、种子与 CSV 序列化
 * 全部复用 src/data 的纯模块，保证网页版与插件/CLI 对同一份数据的理解一致。
 */

import { LogRow, WorkoutConfig } from '../data/types';
import { migrateConfig } from '../data/configMigrate';
import { getDefaultConfig } from '../data/seed';
import { logsToCsv, parseCsvContent, normalizeFields } from '../data/csvFormat';
import { applyDefaultNameKeys } from '../data/display';
import { generateId } from '../util/id';
import { setLocale } from '../i18n';
import { setWebLang } from './format';

const LS_PREFIX = 'workout-block-web:v1:';
const KEY_CONFIG = `${LS_PREFIX}config`;
const KEY_SETTINGS = `${LS_PREFIX}settings`;
const KEY_LOGS = `${LS_PREFIX}logs`;

export type WebRange = '7d' | '30d' | '90d' | 'all';

export interface WebSettings {
  language: 'zh' | 'en';
  unit: 'kg' | 'lb';
  remember: boolean;
  theme: 'light' | 'dark';
  /** 空字符串 = 跟随配置里的 heatmapDefault / 第一条统计。 */
  defaultMetricId: string;
  defaultRange: WebRange;
  autoClear: boolean;
  decimals: 0 | 1 | 2;
}

function prefersDark(): boolean {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  } catch {
    return false;
  }
}

export const DEFAULT_WEB_SETTINGS: WebSettings = {
  language: 'zh',
  unit: 'kg',
  remember: true,
  theme: prefersDark() ? 'dark' : 'light',
  defaultMetricId: '',
  defaultRange: '7d',
  autoClear: true,
  decimals: 0,
};

function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    /* 隐私模式/配额超限：写入失败要能被上层看见，否则用户以为存下来了 */
    return false;
  }
}
function lsRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 同上 */
  }
}

/** 判断 localStorage 变更事件是否属于本应用的键（多标签同步用）。 */
export function isStoreKey(key: string | null): boolean {
  return !!key && key.startsWith(LS_PREFIX);
}

function looksLikeConfig(value: unknown): value is WorkoutConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<WorkoutConfig>;
  return (
    Array.isArray(v.trainingTypes) &&
    Array.isArray(v.exercises) &&
    Array.isArray(v.muscles) &&
    Array.isArray(v.statistics)
  );
}

export interface BackupPayload {
  app: string;
  version: number;
  exportedAt: string;
  config: WorkoutConfig;
  settings: WebSettings;
  logs: LogRow[];
}

export class WebStore {
  config: WorkoutConfig;
  settings: WebSettings;
  logs: LogRow[];

  private listeners = new Set<() => void>();
  private persistErrorListeners = new Set<() => void>();
  /** 是否处于「写盘失败」状态：只在失败首次出现时通知一次，避免每次输入都弹提示。 */
  private persistFailed = false;

  constructor() {
    this.settings = this.loadSettings();
    this.config = this.loadConfig();
    this.logs = this.loadLogs();
    setLocale(this.settings.language);
    setWebLang(this.settings.language);
  }

  private loadConfig(): WorkoutConfig {
    const raw = lsGet(KEY_CONFIG);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as WorkoutConfig;
        if (looksLikeConfig(parsed)) {
          // 已落盘的网页配置结构完整：只补齐 nameKey / plans，不再并入种子，
          // 否则用户删掉的默认动作、统计和计划会在刷新后被迁移逻辑重新加回来。
          if (!Array.isArray(parsed.plans)) parsed.plans = [];
          return applyDefaultNameKeys(parsed);
        }
        return migrateConfig(parsed);
      } catch {
        /* 损坏配置：回落到种子配置 */
      }
    }
    return migrateConfig(getDefaultConfig());
  }

  private loadSettings(): WebSettings {
    const raw = lsGet(KEY_SETTINGS);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<WebSettings>;
        const range: WebRange =
          parsed.defaultRange === '30d' || parsed.defaultRange === '90d' || parsed.defaultRange === 'all'
            ? parsed.defaultRange
            : '7d';
        return {
          language: parsed.language === 'en' ? 'en' : 'zh',
          unit: parsed.unit === 'lb' ? 'lb' : 'kg',
          remember: parsed.remember !== false,
          theme: parsed.theme === 'dark' ? 'dark' : parsed.theme === 'light' ? 'light' : DEFAULT_WEB_SETTINGS.theme,
          defaultMetricId: typeof parsed.defaultMetricId === 'string' ? parsed.defaultMetricId : '',
          defaultRange: range,
          autoClear: parsed.autoClear !== false,
          decimals: parsed.decimals === 1 || parsed.decimals === 2 ? parsed.decimals : 0,
        };
      } catch {
        /* 落入默认 */
      }
    }
    return { ...DEFAULT_WEB_SETTINGS };
  }

  private loadLogs(): LogRow[] {
    const raw = lsGet(KEY_LOGS);
    if (!raw) return [];
    return parseCsvContent(raw).rows;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private persist(): void {
    // 三个键都尝试写（不要用 && 短路，否则前一个失败会让后面根本不写）
    const okConfig = lsSet(KEY_CONFIG, JSON.stringify(this.config));
    const okSettings = lsSet(KEY_SETTINGS, JSON.stringify(this.settings));
    const okLogs = lsSet(KEY_LOGS, logsToCsv(this.logs));
    const ok = okConfig && okSettings && okLogs;
    if (!ok) {
      if (!this.persistFailed) {
        this.persistFailed = true;
        for (const fn of this.persistErrorListeners) fn();
      }
      return;
    }
    this.persistFailed = false;
  }

  /** 写盘失败通知（配额满、隐私模式）：只在首次失败时触发一次，成功一次后重置。 */
  onPersistError(fn: () => void): void {
    this.persistErrorListeners.add(fn);
  }

  /** 从 localStorage 全量重载（多标签页同步用：别的标签改了数据，本标签跟上）。 */
  reloadFromStorage(): void {
    this.config = this.loadConfig();
    this.settings = this.loadSettings();
    this.logs = this.loadLogs();
    setLocale(this.settings.language);
    setWebLang(this.settings.language);
    this.emit();
  }

  updateConfig(mutate: (config: WorkoutConfig) => void): void {
    mutate(this.config);
    this.persist();
    this.emit();
  }

  updateSettings(patch: Partial<WebSettings>): void {
    this.settings = { ...this.settings, ...patch };
    if (patch.language) {
      setLocale(patch.language);
      setWebLang(patch.language);
    }
    this.persist();
    this.emit();
  }

  // —— 记录读写 ——

  addLog(input: Omit<LogRow, 'id'> & { id?: string }): LogRow {
    const row: LogRow = { ...input, id: input.id || this.freshId() };
    row.fields = normalizeFields(row.fields);
    this.logs.push(row);
    this.persist();
    this.emit();
    return row;
  }

  updateLog(id: string, patch: Partial<Omit<LogRow, 'id'>>): void {
    const index = this.logs.findIndex((r) => r.id === id);
    if (index < 0) return;
    const next = { ...this.logs[index], ...patch };
    next.fields = normalizeFields(next.fields);
    this.logs[index] = next;
    this.persist();
    this.emit();
  }

  removeLog(id: string): void {
    this.logs = this.logs.filter((r) => r.id !== id);
    this.persist();
    this.emit();
  }

  private freshId(): string {
    for (let i = 0; i < 5; i++) {
      const id = generateId();
      if (!this.logs.some((r) => r.id === id)) return id;
    }
    return generateId() + generateId().slice(0, 4);
  }

  // —— CSV 互通 ——

  exportCsv(): string {
    return logsToCsv(this.logs);
  }

  importCsv(text: string): { added: number; skipped: number; dropped: number } {
    const parsed = parseCsvContent(text);
    const existing = new Set(this.logs.map((r) => r.id));
    let added = 0;
    let skipped = 0;
    for (const row of parsed.rows) {
      if (existing.has(row.id)) {
        skipped++;
        continue;
      }
      existing.add(row.id);
      this.logs.push(row);
      added++;
    }
    if (added > 0) {
      this.persist();
      this.emit();
    }
    return { added, skipped, dropped: parsed.dropped };
  }

  // —— 配置 / 完整备份 ——

  exportConfigJson(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /** 导入配置（覆盖当前配置，记录不受影响）。 */
  importConfigJson(text: string): { ok: true } | { ok: false; error: string } {
    try {
      const parsed = JSON.parse(text) as WorkoutConfig;
      if (!looksLikeConfig(parsed)) throw new Error('not a workout config');
      this.config = migrateConfig(parsed);
      this.persist();
      this.emit();
      return { ok: true };
    } catch {
      return { ok: false, error: 'invalid' };
    }
  }

  exportBackup(): BackupPayload {
    return {
      app: 'workout-block-web',
      version: 1,
      exportedAt: new Date().toISOString(),
      config: this.config,
      settings: this.settings,
      logs: this.logs,
    };
  }

  exportBackupJson(): string {
    return JSON.stringify(this.exportBackup(), null, 2);
  }

  /** 完整恢复：记录、配置、设置整体替换。 */
  importBackupJson(text: string): { ok: true; logs: number } | { ok: false; error: string } {
    try {
      const parsed = JSON.parse(text) as Partial<BackupPayload> & { config?: WorkoutConfig; logs?: LogRow[] };
      if (!looksLikeConfig(parsed.config)) throw new Error('missing config');
      const migrated = migrateConfig(parsed.config);
      const logs = Array.isArray(parsed.logs) ? parsed.logs : [];
      // 走一遍 CSV 规范化，过滤缺少 timestamp/category 的脏行并规范 fields。
      const normalized = parseCsvContent(logsToCsv(logs)).rows;
      const settings = this.normalizeSettings(parsed.settings);
      this.config = migrated;
      this.logs = normalized;
      this.settings = settings;
      setLocale(settings.language);
      setWebLang(settings.language);
      this.persist();
      this.emit();
      return { ok: true, logs: normalized.length };
    } catch {
      return { ok: false, error: 'invalid' };
    }
  }

  private normalizeSettings(value: unknown): WebSettings {
    const parsed = (value ?? {}) as Partial<WebSettings>;
    const range: WebRange =
      parsed.defaultRange === '30d' || parsed.defaultRange === '90d' || parsed.defaultRange === 'all'
        ? parsed.defaultRange
        : '7d';
    return {
      language: parsed.language === 'en' ? 'en' : 'zh',
      unit: parsed.unit === 'lb' ? 'lb' : 'kg',
      remember: parsed.remember !== false,
      theme: parsed.theme === 'dark' ? 'dark' : parsed.theme === 'light' ? 'light' : DEFAULT_WEB_SETTINGS.theme,
      defaultMetricId: typeof parsed.defaultMetricId === 'string' ? parsed.defaultMetricId : '',
      defaultRange: range,
      autoClear: parsed.autoClear !== false,
      decimals: parsed.decimals === 1 || parsed.decimals === 2 ? parsed.decimals : 0,
    };
  }

  /** 本地存储占用（字节）。 */
  storageBytes(): number {
    let total = 0;
    for (const key of [KEY_CONFIG, KEY_SETTINGS, KEY_LOGS]) {
      total += lsGet(key)?.length ?? 0;
    }
    return total * 2; // localStorage 以 UTF-16 计
  }

  resetAll(): void {
    this.config = migrateConfig(getDefaultConfig());
    this.settings = { ...DEFAULT_WEB_SETTINGS };
    this.logs = [];
    setLocale(this.settings.language);
    setWebLang(this.settings.language);
    lsRemove(KEY_CONFIG);
    lsRemove(KEY_SETTINGS);
    lsRemove(KEY_LOGS);
    this.persist();
    this.emit();
  }
}
