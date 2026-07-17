import { App, Events, Plugin } from 'obsidian';
import { LogRow, WorkoutConfig, TrainingType, Exercise, Muscle, PluginSettings, DEFAULT_SETTINGS, CSV_FILENAME, CONFIG_FILENAME, TrainingPlanInstance } from './types';
import { generateId } from '../util/id';
import { CSVStore } from './CSVStore';
import { ConfigStore } from './ConfigStore';

/*
 * DataManager.ts —— 插件的「数据中枢」。
 *
 * 存储分工（回到「两个文件 + 插件设置」的经典结构）：
 *  - settings：插件私有 data.json（Plugin.loadData / saveData），仅存放用户偏好，
 *              不进 vault、不影响查询、也不触发 vault 文件写入导致的卡顿。
 *  - logs：vault 内 workout_logs.csv（支持 Dataview 等查询）。
 *  - config：vault 内 workout-config.json（同样支持查询）。
 *
 * 性能要点（根治"添加记录卡顿"）：
 *  - 添加记录走 CSVStore.appendRow，内部用 Vault.append 做 O(1) 追加，不再整文件重写。
 *  - selfWriting 标志：插件自身写盘期间，main.ts 的 vault.on('modify') 监听完全跳过
 *    重载 + 重渲染（data-changed 已做精准重渲染），避免重复开销与卡顿。
 *
 * 数据迁移：若 CSV 为空但旧版插件私有 data 里有 logs / config，则一次性导入 vault 文件，
 *          不丢用户在上一版测试期间产生的数据。
 */
// 取今天日期（YYYY-MM-DD），用于完成状态打标。
function todayStr(): string {
  const n = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}

export class DataManager {
  app: App;                     // Obsidian 应用实例
  private plugin: Plugin;       // 插件实例，用于 loadData/saveData（私有 settings）
  private events: Events;       // 事件总线
  private csvStore: CSVStore;   // 记录数据层（vault CSV）
  private configStore: ConfigStore; // 配置数据层（vault JSON）
  private settings: PluginSettings;  // 设置内存副本（来自插件私有 data）
  private logsCache: LogRow[] = [];   // 记录内存缓存（存活记录，已排除软删除）
  private deletedIds = new Set<string>(); // 软删除标记过的 id 集合（墓碑行），用于缓存过滤与 id 去重
  private selfWriting = false;        // 自身写盘标志：写盘期间为 true
  private lastSelfWriteAt = 0;        // 最近一次自身写盘时间戳(ms)：用于 vault.on('modify') 漏判兜底
  private logsFlushTimer: number | null = null; // 记录写盘防抖定时器（合并多次删除/编辑为一次整文件写）

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.events = new Events();
    this.settings = { ...DEFAULT_SETTINGS };
    this.csvStore = new CSVStore(this);
    this.configStore = new ConfigStore(this);
  }

  // 初始化：加载设置（私有 data）、迁移、加载记录（CSV）与配置（vault JSON）。
  async init(): Promise<void> {
    const saved = (await this.plugin.loadData()) as (Partial<PluginSettings> & { logs?: LogRow[]; config?: WorkoutConfig }) | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(saved || {}) };
    this.applySettingsMigration();

    // 记录：优先从 vault CSV 读取；若 CSV 为空但旧版私有 data 有 logs，则一次性导入 CSV。
    // readAllWithStats 额外返回丢弃的脏行数（超长 fields 的幽灵行），用于判断是否需要落盘自愈。
    const initial = await this.csvStore.readAllWithStats();
    this.logsCache = initial.rows;
    this.deletedIds = new Set(initial.deletedIds);
    const dropped = initial.dropped;
    const hadRows = this.logsCache.length > 0;
    // 自净：剔除损坏行（字段超大——通常因脏 CSV 未闭合引号把多行吞进一个单元格，
    // 使某一行 id/fields 变成数百 KB 巨串）与重复 id 的幽灵行。若不清除，每次 writeAll
    // 都会把巨串放大写回，导致 Obsidian 主线程长时间阻塞、删除记录时整块卡死。
    const wasDirty = this.sanitizeLogsCache();

    if (!hadRows && saved?.logs && saved.logs.length > 0) {
      this.logsCache = saved.logs;
      this.setSelfWriting(true);
      try {
        await this.csvStore.writeAll(this.logsCache);
      } finally {
        this.setSelfWriting(false);
      }
    } else if (wasDirty || dropped > 0) {
      // 自净后落盘，确保磁盘 CSV 也被修正（丢弃的脏行不再写回），避免下次读取再次解析出脏行
      this.setSelfWriting(true);
      try {
        await this.csvStore.writeAll(this.logsCache);
      } finally {
        this.setSelfWriting(false);
      }
    }

    // CSV 表头自愈：若磁盘是旧版 9 列表头，整体重写归一为 CSV_HEADER，
    // 并把兜底生成的 id 持久化，避免后续 appendRow 追加 7 列行造成列错位/数据损坏。
    await this.normalizeCsvIfNeeded();

    // 配置：vault JSON 优先；若没有则用旧版私有 data 的 config 兜底导入。
    await this.configStore.ensureLoaded(saved?.config);
  }

  // CSV 迁移自愈：若磁盘表头不是当前规范表头（旧版结构），用缓存整体重写，
  // 归一表头并持久化兜底 id，防止「旧文件 + 新追加行」列错位导致数据损坏。
  private async normalizeCsvIfNeeded(): Promise<void> {
    if (!(await this.csvStore.isHeaderStale())) return;
    this.setSelfWriting(true);
    try {
      await this.csvStore.writeAll(this.logsCache);
    } finally {
      this.setSelfWriting(false);
    }
  }

  // 兼容旧版设置字段名（升级保障）：把旧的 dataDirectory / csvPath / configPath 映射到新目录字段。
  private applySettingsMigration(): void {
    const s = this.settings as unknown as Record<string, unknown>;
    if (typeof s['dataDirectory'] === 'string' && s['dataDirectory']) {
      const oldDir = s['dataDirectory'] as string;
      if (!this.settings.csvDirectory) this.settings.csvDirectory = oldDir;
      if (!this.settings.configDirectory) this.settings.configDirectory = oldDir;
    }
    if (typeof s['csvPath'] === 'string' && s['csvPath']) {
      const parts = (s['csvPath'] as string).split('/');
      parts.pop();
      const dir = parts.join('/');
      if (!this.settings.csvDirectory) this.settings.csvDirectory = dir;
    }
    if (typeof s['configPath'] === 'string' && s['configPath']) {
      const parts = (s['configPath'] as string).split('/');
      parts.pop();
      const dir = parts.join('/');
      if (!this.settings.configDirectory) this.settings.configDirectory = dir;
    }
  }

  // 获取设置（仅内存）。
  getSettings(): PluginSettings {
    return this.settings;
  }

  // 保存设置到私有 data，并广播 settings-changed。
  async saveSettings(): Promise<void> {
    await this.plugin.saveData(this.settings);
    this.emit('settings-changed', this.settings);
  }

  // 重新从 CSV 加载记录到缓存（外部改文件时调用）。
  // 同步刷新 deletedIds，确保软删除墓碑在外部文件变动后仍被正确过滤。
  async reloadLogs(): Promise<void> {
    const r = await this.csvStore.readAllWithStats();
    this.logsCache = r.rows;
    this.deletedIds = new Set(r.deletedIds);
  }

  // 重新从 vault JSON 加载配置到缓存（外部改文件时调用，先清缓存再读）。
  async reloadConfig(): Promise<void> {
    this.configStore.clearCache();
    await this.configStore.load();
  }

  // 返回记录副本，避免外部改动影响内部缓存。
  // 防御性过滤软删除 id：即便缓存意外混入已删行，渲染/统计也看不到。
  getLogs(): LogRow[] {
    return this.logsCache.filter((r) => !this.deletedIds.has(r.id));
  }

  // —— selfWriting 控制 ——
  // 关键修复点：写盘的「开始」与「结束」都刷新 lastSelfWriteAt 时间戳。
  // 旧实现只在 setSelfWriting(true)（写盘开始）时刷新；一旦 CSV 较大、整文件重写本身
  // 耗时超过 1.5s，vault.on('modify') 在写盘【结束后】派发时，时间戳已超出窗口 → 被误判为
  // 「外部手动改文件」→ 触发 reloadLogs()（整文件重读）+ rerenderAllBlocks()（重算 320KB 热力图），
  // 造成删除记录后 Obsidian 主线程卡死、丢光标、无法输入。
  // 改为「结束也刷新」后，无论写盘耗时多久，modify 事件派发时时间戳都落在窗口内，保护必然生效。
  private setSelfWriting(v: boolean): void {
    this.selfWriting = v;
    this.lastSelfWriteAt = Date.now();
  }
  // 自身写盘是否「刚刚发生」（默认 2s 内，留足事件派发延迟余量）。
  // 关键：Obsidian 的 vault.on('modify') 事件是在写盘完成后才异步派发的，此时 selfWriting
  // 早已被复位为 false，仅靠 isSelfWriting() 会漏判，导致自身写盘被当成「外部改文件」，
  // 进而触发整文件重读 + 全量重渲染（对大 CSV / 320KB 肌肉 SVG 热力图是致命卡顿）。
  // 用时间戳兜底（且结束也刷新，见 setSelfWriting），确保自身写盘一定被跳过，
  // data-changed 已做的精准重渲染足够。
  wasSelfWrittenRecently(windowMs = 2000): boolean {
    return Date.now() - this.lastSelfWriteAt < windowMs;
  }
  // 供 main.ts 的 vault.on('modify') 监听判断是否「插件自身正在写盘」。
  isSelfWriting(): boolean {
    return this.selfWriting;
  }

  // 记录 CSV 文件路径（供 main.ts 监听匹配）。
  getCsvPath(): string {
    const dir = this.settings.csvDirectory || '';
    return dir ? `${dir}/${CSV_FILENAME}` : CSV_FILENAME;
  }
  // 配置 JSON 文件路径（供 main.ts 监听匹配）。
  getConfigPath(): string {
    const dir = this.settings.configDirectory || '';
    return dir ? `${dir}/${CONFIG_FILENAME}` : CONFIG_FILENAME;
  }

  // 生成一个与现有记录不重复的短 id（默认基于内存缓存 + 软删除集合，避免与已删 id 撞车；
  // 也可传入已占用集合做批量去重，此时同样并入 deletedIds）。
  private uniqueLogId(taken: Set<string> = new Set([...this.logsCache.map((r) => r.id), ...this.deletedIds])): string {
    let id = generateId();
    while (taken.has(id)) id = generateId();
    return id;
  }

  // 新增一条记录：补全 id（timestamp 可由调用方覆盖，缺省取当前时间），O(1) 追加到 CSV，同步缓存，广播 data-changed。
  async addLog(row: Omit<LogRow, 'id' | 'timestamp'> & { timestamp?: string }): Promise<void> {
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const id = this.uniqueLogId();
    const logRow: LogRow = {
      id,
      timestamp,
      ...row,
    };
    this.setSelfWriting(true);
    try {
      await this.csvStore.appendRow(logRow); // Vault.append，O(1)，不重写整文件
    } finally {
      this.setSelfWriting(false);
    }
    this.logsCache.push(logRow);
    this.emit('data-changed', { type: 'add', row: logRow });
  }

  // 批量新增「计划」记录：一次合并后整体持久化（只写盘一次）。每条独立生成稳定 id。
  async addPlanLogs(rows: Omit<LogRow, 'id' | 'timestamp'>[]): Promise<void> {
    const now = new Date();
    const taken = new Set([...this.logsCache.map((r) => r.id), ...this.deletedIds]);
    const logRows: LogRow[] = rows.map((row, i) => {
      const time = new Date(now.getTime() + i * 60000);
      const timestamp = `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
      const id = this.uniqueLogId(taken);
      taken.add(id);
      return { ...row, id, timestamp };
    });
    const merged = [...this.logsCache, ...logRows];
    this.setSelfWriting(true);
    try {
      await this.csvStore.writeAll(merged);
    } finally {
      this.setSelfWriting(false);
    }
    this.logsCache = merged;
    this.emit('data-changed', { type: 'add-plan', rows: logRows });
  }

  // 训练记录写盘防抖：把短时间内的多次 updateLog 合并成「一次」整文件写盘。
  // 注意：删除已改为「软删除」（appendTombstone，O(1) 追加墓碑），不再触发本防抖重写，
  // 因此本机制如今只为编辑（updateLog）合并写盘用——编辑本就需改中间行、属低频操作。
  // 界面刷新走 data-changed（即时），持久化走此处（合并），互不阻塞。
  // 关键：立即标记 selfWriting 开始时间戳，使 wasSelfWrittenRecently() 能覆盖从「调度写盘」到
  // 「写盘完成」的整个窗口，避免 vault.on('modify') 在防抖期间误判为外部修改触发重复重渲染。
  private scheduleLogsFlush(): void {
    if (this.logsFlushTimer !== null) return;
    this.lastSelfWriteAt = Date.now();
    this.logsFlushTimer = window.setTimeout(() => {
      this.logsFlushTimer = null;
      void this.flushLogsToDisk();
    }, 200);
  }

  // 实际整文件写盘（防抖到点后执行）。写盘期间 selfWriting=true，避免 vault modify 监听重复刷新。
  // 仅由 updateLog 触发（edit 需改中间行）。软删除走 appendTombstone，不经过此处。
  private async flushLogsToDisk(): Promise<void> {
    this.setSelfWriting(true);
    try {
      await this.csvStore.writeAll(this.logsCache);
    } catch (e) {
      console.error('[workout] 训练记录写盘失败:', e);
    } finally {
      this.setSelfWriting(false);
    }
  }

  // 更新一条记录：按稳定主键 id 定位旧行，合并更新后广播变化，写盘走防抖合并（编辑需改中间行，属低频）。
  async updateLog(id: string, updates: Partial<LogRow>): Promise<void> {
    const index = this.logsCache.findIndex((r) => r.id === id);
    if (index !== -1) {
      this.logsCache[index] = { ...this.logsCache[index], ...updates };
    }
    const updated = index !== -1 ? this.logsCache[index] : ({ ...updates, id } as LogRow);
    this.emit('data-changed', { type: 'update', row: updated });
    this.scheduleLogsFlush();
  }

  // 软删除一条记录：不再整文件重写，而是「内存移除 + O(1) 追加墓碑」。
  // 1) 从内存缓存移除该行（所有渲染/统计都走 getLogs，自动过滤，界面即时消失）；
  // 2) 把 id 记入 deletedIds（用于缓存过滤与后续 id 分配去重）；
  // 3) 仅追加一行 deleted=true 的墓碑到 CSV（vault.append，O(1)），不重写整文件
  //    —— 这彻底消灭了「删除必须整文件重写 → 大 CSV 卡死主线程、丢光标、打不了字」的问题；
  // 4) 即时广播 data-changed（不依赖写盘），表格里那一行立刻消失。
  // 真正的整文件压缩（移除墓碑、释放体积）由设置页「压缩清理 CSV」按钮按需触发（compactLogs）。
  async deleteLog(id: string): Promise<void> {
    const removed = this.logsCache.find((r) => r.id === id);
    if (!removed) return; // 已删除或不存在，避免重复追加墓碑
    this.logsCache = this.logsCache.filter((r) => r.id !== id);
    this.deletedIds.add(id);
    this.setSelfWriting(true);
    try {
      await this.csvStore.appendTombstone(id);
    } catch (e) {
      console.error('[workout] 追加删除墓碑失败:', e);
    } finally {
      this.setSelfWriting(false);
    }
    this.emit('data-changed', { type: 'delete', row: removed });
  }

  // 整文件压缩清理：以内存中的「存活记录」为准重写 CSV，
  // 丢弃所有软删除墓碑行与被删记录的残留行，真正释放体积并规整文件。
  // 由设置页「压缩清理 CSV」按钮在用户主动触发时执行（O(n) 整写一次，可接受）。
  // 返回被彻底移除的删除记录条数（供 UI 提示）。
  async compactLogs(): Promise<number> {
    const removed = this.deletedIds.size;
    this.setSelfWriting(true);
    try {
      await this.csvStore.writeAll(this.logsCache);
    } catch (e) {
      console.error('[workout] 压缩清理 CSV 失败:', e);
      return 0;
    } finally {
      this.setSelfWriting(false);
    }
    this.deletedIds.clear();
    // 通知所有代码块刷新（记录集变化，覆盖 log / day / heatmap）
    this.emit('data-changed', { type: 'bulk-update' });
    return removed;
  }

  // 剔除损坏的日志记录：核心字段缺失、超长或重复均视为脏数据丢弃。
  // 相同 id 只保留第一条，后续重复行（脏 CSV 未闭合引号制造的幽灵行）一并丢弃。
  // 返回是否发生过剔除，便于 init() 决定是否落盘修正。
  private sanitizeLogsCache(): boolean {
    const MAX_ID = 2000;
    const MAX_FIELDS = 10000;
    const seen = new Set<string>();
    const before = this.logsCache.length;
    this.logsCache = this.logsCache.filter((r) => {
      // 关键字段缺失：id / timestamp / category 任意为空即无法正确渲染或持久化，直接丢弃。
      if (!r.id || !r.timestamp || !r.category) return false;
      const idLen = String(r.id).length;
      const fieldsLen = r.fields ? JSON.stringify(r.fields).length : 0;
      if (idLen > MAX_ID || fieldsLen > MAX_FIELDS) return false;
      // 去重：重复 id 只保留第一条（幽灵/损坏行丢弃），避免脏数据撑大文件或干扰查询。
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    return this.logsCache.length !== before;
  }

  // 标记某计划某训练项的某组为「已完成」（持久化到计划配置，独立于训练记录）。
  // 即使之后删除了该组产生的训练记录，完成状态仍保留——满足「完成即完成」的预期。
  async markPlanSetCompleted(plan: TrainingPlanInstance, exerciseId: string, setId: string): Promise<void> {
    const config = await this.getConfig();
    const target = config.plans?.find((p) => p.id === plan.id);
    if (!target) return;
    if (!target.completedSets) target.completedSets = {};
    target.completedSets[`${exerciseId}#${setId}`] = todayStr();
    await this.saveConfig(config);
  }

  // 读取配置（来自 vault JSON 缓存或加载）。
  async getConfig(): Promise<WorkoutConfig> {
    return await this.configStore.load();
  }

  // 保存配置并广播 config-changed（写盘期间 selfWriting=true，避免监听重复刷新）。
  async saveConfig(config: WorkoutConfig): Promise<void> {
    this.setSelfWriting(true);
    try {
      await this.configStore.save(config);
    } finally {
      this.setSelfWriting(false);
    }
    this.emit('config-changed', config);
  }

  // —— 以下是一组对配置里「训练类型 / 训练项 / 肌肉」的增删改封装 ——
  async addTrainingType(type: TrainingType): Promise<void> {
    const config = await this.getConfig();
    config.trainingTypes.push(type);
    await this.saveConfig(config);
  }

  async updateTrainingType(id: string, updates: Partial<TrainingType>): Promise<void> {
    const config = await this.getConfig();
    const index = config.trainingTypes.findIndex((t) => t.id === id);
    if (index !== -1) {
      config.trainingTypes[index] = { ...config.trainingTypes[index], ...updates };
      await this.saveConfig(config);
    }
  }

  // 重命名训练类型 ID，并级联更新所有关联引用：
  // 1) 配置里该类型的 id 改为 newId（其余字段按 updates 合并）；
  // 2) 所有训练记录的 category === oldId → newId；
  // 3) 所有训练项的 category === oldId → newId（训练项归属该类型）；
  // 4) 所有统计的 associatedTypes 里出现的 oldId → newId（统计按类型关联）。
  // 用于「编辑训练类型时改了 ID」的场景，保证记录/训练项/统计都不被断联。
  async renameTrainingType(oldId: string, newId: string, updates: Partial<TrainingType>): Promise<void> {
    const config = await this.getConfig();
    const index = config.trainingTypes.findIndex((t) => t.id === oldId);
    if (index !== -1) {
      config.trainingTypes[index] = { ...config.trainingTypes[index], ...updates, id: newId };
      await this.saveConfig(config); // saveConfig 内部会广播 config-changed
    }

    // 级联更新记录里的 category
    let changed = false;
    this.logsCache = this.logsCache.map((r) => {
      if (r.category === oldId) {
        changed = true;
        return { ...r, category: newId };
      }
      return r;
    });

    // 级联更新训练项的 category（训练项归属该类型）
    let exercisesChanged = false;
    config.exercises = config.exercises.map((e) => {
      if (e.category === oldId) {
        exercisesChanged = true;
        return { ...e, category: newId };
      }
      return e;
    });

    // 级联更新统计的 associatedTypes（统计按训练类型关联，可能含多个 id）
    let statsChanged = false;
    config.statistics = (config.statistics || []).map((s) => {
      if (s.associatedTypes && s.associatedTypes.includes(oldId)) {
        statsChanged = true;
        return {
          ...s,
          associatedTypes: s.associatedTypes.map((t) => (t === oldId ? newId : t)),
        };
      }
      return s;
    });

    if (exercisesChanged || statsChanged) {
      await this.saveConfig(config); // 二次持久化（配置侧）；已含 config-changed 广播
    }

    if (changed) {
      this.setSelfWriting(true);
      try {
        await this.csvStore.writeAll(this.logsCache);
      } finally {
        this.setSelfWriting(false);
      }
      // 不带 row，main.ts 会退化为全量重渲染（覆盖所有引用该 ID 的表格）
      this.emit('data-changed', { type: 'bulk-update' });
    }
  }

  async deleteTrainingType(id: string): Promise<void> {
    const config = await this.getConfig();
    config.trainingTypes = config.trainingTypes.filter((t) => t.id !== id);
    await this.saveConfig(config);
  }

  async addExercise(exercise: Exercise): Promise<void> {
    const config = await this.getConfig();
    config.exercises.push(exercise);
    await this.saveConfig(config);
  }

  async updateExercise(id: string, updates: Partial<Exercise>): Promise<void> {
    const config = await this.getConfig();
    const index = config.exercises.findIndex((e) => e.id === id);
    if (index !== -1) {
      config.exercises[index] = { ...config.exercises[index], ...updates };
      await this.saveConfig(config);
    }
  }

  // 重命名训练项 ID，并级联更新所有关联记录：
  // 1) 配置里该训练项的 id 改为 newId（其余字段按 updates 合并）；
  // 2) CSV 中所有 exerciseId === oldId 的记录批量改为 newId，整体写盘。
  // 用于「编辑训练项时改了 ID」的场景，保证历史记录不被断联。
  async renameExercise(oldId: string, newId: string, updates: Partial<Exercise>): Promise<void> {
    const config = await this.getConfig();
    const index = config.exercises.findIndex((e) => e.id === oldId);
    if (index !== -1) {
      config.exercises[index] = { ...config.exercises[index], ...updates, id: newId };
      await this.saveConfig(config); // saveConfig 内部会广播 config-changed
    }

    // 级联更新记录里的 exerciseId
    let changed = false;
    this.logsCache = this.logsCache.map((r) => {
      if (r.exerciseId === oldId) {
        changed = true;
        return { ...r, exerciseId: newId };
      }
      return r;
    });

    if (changed) {
      this.setSelfWriting(true);
      try {
        await this.csvStore.writeAll(this.logsCache);
      } finally {
        this.setSelfWriting(false);
      }
      // 不带 row，main.ts 会退化为全量重渲染（覆盖所有引用该 ID 的表格）
      this.emit('data-changed', { type: 'bulk-update' });
    }
  }

  // 删除训练项：先级联软删除其关联的全部训练记录（exerciseId === id），再移除训练项本身。
  // 级联删除沿用 deleteLog 的软删除策略（移除缓存行 + 记墓碑 id + O(1) 批量追加墓碑），
  // 避免整文件重写卡顿；真正释放体积沿用「压缩清理 CSV」按需执行。
  // 这样「训练项还有训练记录时删除该训练项」不会再留下孤儿记录。
  async deleteExercise(id: string): Promise<void> {
    // 1) 找出该训练项关联的全部训练记录并软删除
    const related = this.logsCache.filter((r) => r.exerciseId === id);
    if (related.length > 0) {
      this.logsCache = this.logsCache.filter((r) => r.exerciseId !== id);
      for (const r of related) this.deletedIds.add(r.id);
      this.setSelfWriting(true);
      try {
        await this.csvStore.appendTombstones(related.map((r) => r.id));
      } catch (e) {
        console.error('[workout] 级联删除训练记录墓碑失败:', e);
      } finally {
        this.setSelfWriting(false);
      }
      // 训练记录变化：无 row → main.ts 退化为全量重渲染所有 log/day/heatmap 代码块
      this.emit('data-changed', { type: 'bulk-update' });
    }

    // 2) 移除训练项本身并落盘（saveConfig 会广播 config-changed，触发项目列表与代码块刷新）
    const config = await this.getConfig();
    config.exercises = config.exercises.filter((e) => e.id !== id);
    await this.saveConfig(config);
  }

  async addMuscle(muscle: Muscle): Promise<void> {
    const config = await this.getConfig();
    config.muscles.push(muscle);
    await this.saveConfig(config);
  }

  async updateMuscle(id: string, updates: Partial<Muscle>): Promise<void> {
    const config = await this.getConfig();
    const index = config.muscles.findIndex((m) => m.id === id);
    if (index !== -1) {
      config.muscles[index] = { ...config.muscles[index], ...updates };
      await this.saveConfig(config);
    }
  }

  async deleteMuscle(id: string): Promise<void> {
    const config = await this.getConfig();
    config.muscles = config.muscles.filter((m) => m.id !== id);
    await this.saveConfig(config);
  }

  // —— 训练计划（聚合进 workout-config.json 的 plans 字段）——
  // 返回全部训练计划实例（无则空数组）。
  async getPlans(): Promise<TrainingPlanInstance[]> {
    const config = await this.getConfig();
    return config.plans ?? [];
  }

  // 按计划名（全局唯一）取单个计划实例。
  async getPlanByName(name: string): Promise<TrainingPlanInstance | undefined> {
    const config = await this.getConfig();
    return config.plans?.find((p) => p.name === name);
  }

  // 校验计划名是否已被占用（编辑时传入 exceptId 排除自身）。
  async isPlanNameTaken(name: string, exceptId?: string): Promise<boolean> {
    const config = await this.getConfig();
    return (config.plans ?? []).some((p) => p.name === name && p.id !== exceptId);
  }

  // 新增或更新计划：以 name 为主键（全局唯一）。已存在则覆盖，否则追加。
  async upsertPlan(plan: TrainingPlanInstance): Promise<void> {
    const config = await this.getConfig();
    if (!config.plans) config.plans = [];
    // 以稳定的 id 为主键（而非 name）。编辑计划时若改名，按 name 匹配会找不到旧条目、
    // 导致新增一条同 id 的重复计划、旧条目残留（配置损坏）；按 id 匹配则原地更新。
    const idx = config.plans.findIndex((p) => p.id === plan.id);
    const oldName = idx >= 0 ? config.plans[idx].name : undefined;
    if (idx >= 0) config.plans[idx] = plan;
    else config.plans.push(plan);
    await this.saveConfig(config);
    // 级联改名：编辑计划时若改了名称，把所有引用旧名的 workout-plan 代码块改写到新名（不动 CSV 历史）
    if (oldName && oldName !== plan.name) {
      try {
        await this.renamePlanInCodeBlocks(oldName, plan.name);
      } catch (e) {
        console.error('[workout] 级联更新计划代码块失败:', e);
      }
    }
  }

  // 级联改名：扫描 vault 内所有 markdown 文件，把引用了 oldName 的 workout-plan 代码块的
  // plan: 参数改写为 newName。只改代码块、不触碰 CSV 历史记录。
  private async renamePlanInCodeBlocks(oldName: string, newName: string): Promise<number> {
    const files = this.app.vault.getMarkdownFiles();
    let updated = 0;
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const lines = content.split('\n');
      let changed = false;
      let i = 0;
      while (i < lines.length) {
        if (lines[i].trim().startsWith('```workout-plan')) {
          // 在代码块内查找 plan: 参数行（只处理第一个）
          let j = i + 1;
          let closing = -1;
          while (j < lines.length) {
            if (lines[j].trim().startsWith('```')) { closing = j; break; }
            const trimmed = lines[j].trim();
            const colonIdx = trimmed.indexOf(':');
            if (colonIdx > 0) {
              const key = trimmed.slice(0, colonIdx).trim();
              if (key === 'plan') {
                const val = trimmed.slice(colonIdx + 1).trim();
                if (val === oldName) {
                  lines[j] = 'plan: ' + newName;
                  changed = true;
                  updated++;
                }
                break; // 只处理第一个 plan: 参数
              }
            }
            j++;
          }
          i = closing >= 0 ? closing + 1 : lines.length;
        } else {
          i++;
        }
      }
      if (changed) {
        await this.app.vault.modify(file, lines.join('\n'));
      }
    }
    return updated;
  }

  // 删除计划（不影响已写 CSV 记录）。
  async deletePlan(name: string): Promise<void> {
    const config = await this.getConfig();
    if (!config.plans) return;
    config.plans = config.plans.filter((p) => p.name !== name);
    await this.saveConfig(config);
  }

  // 更新某计划内某训练项某组的预设字段（组内编辑「未完成」组保存时调用，只改预设不写库）。
  async updatePlanSetFields(planName: string, exerciseId: string, setId: string, fields: Record<string, unknown>): Promise<void> {
    const config = await this.getConfig();
    const plan = config.plans?.find((p) => p.name === planName);
    if (!plan) return;
    const item = plan.items.find((i) => i.exerciseId === exerciseId && i.enabled);
    const set = item?.sets.find((s) => s.id === setId);
    if (set) set.fields = fields;
    await this.saveConfig(config);
  }

  // 记忆上次输入值：返回最近一次该训练项的字段值，供下次自动填充。
  getLastValues(exerciseId?: string): Record<string, unknown> | null {
    if (!this.settings.lastValueMemory) {
      return null;
    }
    if (!exerciseId) {
      return null;
    }
    const logs = this.logsCache.filter((l) => l.exerciseId === exerciseId && l.timestamp);
    if (logs.length === 0) {
      return null;
    }
    logs.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    return logs[0].fields;
  }

  // 订阅事件（重载签名：分别约束三种事件的回调参数类型）。
  on(event: 'data-changed', callback: (data: { type: string; row?: LogRow; rows?: LogRow[]; id?: string }) => void): void;
  on(event: 'config-changed', callback: (config: WorkoutConfig) => void): void;
  on(event: 'settings-changed', callback: (settings: PluginSettings) => void): void;
  on(event: string, callback: (...args: any[]) => void): void {
    this.events.on(event, callback);
  }

  // 取消订阅事件
  off(event: string, callback: (...args: unknown[]) => void): void {
    this.events.off(event, callback);
  }

  // 内部触发事件
  private emit(event: 'data-changed', data: { type: string; row?: LogRow; rows?: LogRow[]; id?: string }): void;
  private emit(event: 'config-changed', config: WorkoutConfig): void;
  private emit(event: 'settings-changed', settings: PluginSettings): void;
  private emit(event: string, ...args: unknown[]): void {
    this.events.trigger(event, ...args);
  }
}
