import { Plugin, Notice, MarkdownPostProcessorContext, TFile } from 'obsidian';
import { DataManager } from './data/DataManager';
import { getExerciseNameById } from './data/display';
import { setLocale, t } from './i18n';
import { registerCodeBlock, rerenderAllBlocks, rerenderBlocksForExercise, rerenderBlocksByType, setRegistryApp, resetRegistry } from './codeblock/registry';
import { renderWorkoutLog } from './codeblock/workoutLog';
import { renderWorkoutDay } from './codeblock/workoutDay';
import { renderWorkoutHeatmap } from './codeblock/workoutHeatmap';
import { renderWorkoutPlan } from './codeblock/workoutPlan';
import { LogRow, FieldDef, WorkoutConfig } from './data/types';
import { applyMappingTier } from './data/muscleMapping';
import { RecordModal } from './ui/RecordModal';
import { confirmWithModal } from './ui/Confirm';
import { NewPlanModal } from './ui/NewPlanModal';
import { ExerciseModal } from './ui/ExerciseModal';
import { TypeModal } from './ui/TypeModal';
import { SettingsTab } from './ui/SettingsTab';
import { InsertCodeBlockModal } from './ui/InsertCodeBlockModal';
import {
  tryRegisterInsertCommand,
  type BlockDefinitionWithParams,
  type BlockParamDef,
  type ParamRenderContext,
} from './blockProvider';
import { renderParamControl } from './ui/paramRenderers';
import { CODE_BLOCK_DEFS } from './codeBlockDefs';
import { getToolCapability as getToolCapabilityDef } from './decision/capability';
import { executeQuery, type WorkoutQueryData } from './decision/queryHandler';
import { createWorkoutContributor } from './decision/contributor';
import { initDecisionCenter } from './decision/decisionHost';
import { FILE_BUS_QUERIES_DIR, type DecisionHostApi, type QueryBusFile, type ToolCapability } from './decision/types';

/*
 * main.ts —— 插件入口文件（核心枢纽）
 * 本文件定义了 WorkoutPlugin 类，它继承自 Obsidian 的 Plugin 基类。
 * 插件的"生命周期"（加载、卸载）和各种功能入口（命令、侧边栏图标、
 * 代码块渲染、设置页、视图、事件监听）都在这里集中注册。
 * 可以把它理解成一座"调度中心"：它自己不画界面，而是负责把各个
 * 子模块（数据管理、弹窗、代码块、视图）连接起来并对外暴露功能。
 */
export default class WorkoutPlugin extends Plugin {
  // 数据管理器：负责读写训练记录 CSV、配置文件、语言设置等。几乎所有功能都依赖它。
  private dataManager!: DataManager;
  // 设置页对象（Obsidian 的 SettingTab），可能为空（尚未创建）。
  private settingsTab: SettingsTab | null = null;
  // 是否为通用插入命令的宿主（first-claim wins）
  private ownsUniversalInsert = false;
  // 决策中心宿主 API（initDecisionCenter 检测到 KOS-block 时持有；无宿主时为 null）
  private decisionHostApi: DecisionHostApi | null = null;

  // 插件加载时由 Obsidian 自动调用。这是初始化所有功能的入口。
  async onload(): Promise<void> {
    // 1) 创建并初始化数据管理器（读取/准备 CSV 与配置文件）
    this.dataManager = new DataManager(this);
    await this.dataManager.init();

    // 1.1) 把 App 引用注入代码块注册表，供重渲染后恢复编辑器焦点（修复光标丢失）
    setRegistryApp(this.app);

    // 2) 根据配置文件里的语言设置，切换 i18n 当前语言（t() 之后会返回对应语言文案）
    const settings = this.dataManager.getSettings();
    setLocale(settings.language);

    // 2.1) 旧版本迁移：若用户从未打开过肌肉管理引导，且存在 svgRegionIds 为空的默认肌肉，
    //      自动套用「default」档映射，使热力图开箱即用，避免用户困惑「热力图无颜色」。
    await this.ensureMuscleMappingInitialized();

    // 3) 依次注册插件的各个组成部分
    this.registerCommands();       // 命令面板里的命令（如"记录一组""记录训练方案"）
    this.registerRibbon();         // 左侧栏的图标按钮
    this.registerCodeBlocks();     // ```workout-log 代码块的接管渲染
    this.registerSettingsTab();    // 设置页
    this.registerEventListeners(); // 数据变化 / 文件修改时的自动刷新

    // 决策中心接入：注册 contributor + queries/ 文件总线 + 过期文件清理
    this.initDecisionCenterIntegration();
    this.registerQueryBus();
    void this.cleanupQueryBus();

    // 移动端适配：在 body 注入 .is-mobile 根类，供 styles.css 中所有 `.is-mobile` 作用域规则生效。
    // 弹窗 / 代码块 / 设置页 DOM 均在 body 之下，一处注入即可全局覆盖；桌面端不注入，零回归。
    if (this.app.isMobile) document.body.classList.add('is-mobile');
  }

  // 旧版本兼容：为尚未初始化肌肉映射的存量配置自动套用默认映射。
  // 仅在 muscleMappingInitialized === false 且存在空 svgRegionIds 时执行一次，
  // 完成后立即标记 true，避免重复迁移或覆盖用户已手动配置的映射。
  private async ensureMuscleMappingInitialized(): Promise<void> {
    const settings = this.dataManager.getSettings();
    if (settings.muscleMappingInitialized) return;
    const config = await this.dataManager.getConfig();
    const hasEmpty = config.muscles.some((m) => (m.svgRegionIds?.length ?? 0) === 0);
    if (!hasEmpty) {
      // 所有肌肉已有映射（可能是新装用户用预填默认值），仅补标记位
      settings.muscleMappingInitialized = true;
      await this.dataManager.saveSettings();
      return;
    }
    applyMappingTier(config, 'default');
    await this.dataManager.saveConfig(config);
    settings.muscleMappingInitialized = true;
    await this.dataManager.saveSettings();
  }

  // 插件卸载（禁用/重载）时调用。清理模块级状态，防止热重载残留。
  onunload(): void {
    document.body.classList.remove('is-mobile');
    resetRegistry();
    this.dataManager.dispose();
  }

  // 注册命令面板中的命令。每个 addCommand 会在 Obsidian 命令面板（Ctrl/Cmd+P）里出现一条。
  // callback 指定点击该命令时执行的功能（这里都转发给对应的 openXxx 方法）。
  private registerCommands(): void {
    // "记录一组"命令：打开单条记录录入弹窗
    this.addCommand({
      id: 'workout-record-set',
      name: t('command.recordSet'),
      icon: 'dumbbell',
      callback: () => this.openRecordModal(),
    });

    // "新增训练计划"命令：打开配置弹窗，从已有方案或手动添加训练项并预设每组字段
    this.addCommand({
      id: 'workout-record-plan',
      name: t('command.newPlan'),
      icon: 'list-checks',
      callback: () => this.openNewPlanModal(),
    });

    // "新建训练项"命令：打开训练项（动作）新建/编辑弹窗
    this.addCommand({
      id: 'workout-new-exercise',
      name: t('command.newExercise'),
      icon: 'plus-circle',
      callback: () => this.openNewExerciseModal(),
    });

    // "新建训练类型"命令：打开训练类型（带字段定义）新建/编辑弹窗
    this.addCommand({
      id: 'workout-new-type',
      name: t('command.newType'),
      icon: 'layers',
      callback: () => this.openNewTypeModal(),
    });

    // "设置"命令：打开插件设置页
    this.addCommand({
      id: 'workout-settings',
      name: t('command.settings'),
      icon: 'settings',
      callback: () => this.openSettings(),
    });

    // 跨插件通用插入器：first-claim wins 宿主策略。
    // 第一个注册 insert-block 命令的插件成为宿主；其余插件自动跳过、仅作为
    // BlockProvider 被合并展示。单插件独立装也可用，多插件合并也不写死任何一对。
    this.ownsUniversalInsert = tryRegisterInsertCommand(this, () => this.openInsertCodeBlockModal());
  }

  // 注册左侧边栏（ribbon）的图标按钮。
  private registerRibbon(): void {
    this.addRibbonIcon('dumbbell', t('command.recordSet'), () => {
      this.openRecordModal();
    });

    // 仅当本插件是通用插入命令宿主时才显示「插入代码块」ribbon。
    // 多插件共存时只有宿主显示 ribbon（避免重复按钮）；单插件独立装时自动成为宿主、显示 ribbon。
    if (this.ownsUniversalInsert) {
      this.addRibbonIcon('code', t('command.insertBlock'), () => {
        this.openInsertCodeBlockModal();
      });
    }
  }

  // 注册 ```workout-log 代码块的接管渲染逻辑。
  // 当用户笔记里出现 ```workout-log ... ``` 代码块时，Obsidian 会把代码块内容
  // 交给这里的处理函数，由插件渲染成带交互（点击记录/编辑/删除）的表格。
  private registerCodeBlocks(): void {
    const codeBlockHandler = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      const logs = this.dataManager.getLogs();
      const unit = this.dataManager.getSettings().unit;
      this.dataManager.getConfig().then((config) => {
        const getTrainingTypeFields = (category: string): FieldDef[] => {
          const type = config.trainingTypes.find((tt) => tt.id === category);
          return type?.fields || [];
        };

        void renderWorkoutLog(
          source,
          el,
          ctx,
          logs,
          getTrainingTypeFields,
          unit,
          config,
          (exercise, plan) => this.openRecordModal(exercise, plan),
          (log) => this.openEditRecordModal(log),
          (log) => void this.deleteRecord(log)
        ).catch(() => {});
      }).catch(() => {});
    };

    registerCodeBlock('workout-log', codeBlockHandler);
    this.registerMarkdownCodeBlockProcessor('workout-log', async (source, el, ctx) => {
      codeBlockHandler(source, el, ctx);
    });

    const dayHandler = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      const logs = this.dataManager.getLogs();
      this.dataManager.getConfig().then((config) => {
        void renderWorkoutDay(source, el, ctx, this.app, logs, config).catch(() => {});
      }).catch(() => {});
    };
    registerCodeBlock('workout-day', dayHandler);
    this.registerMarkdownCodeBlockProcessor('workout-day', async (source, el, ctx) => {
      dayHandler(source, el, ctx);
    });

    const heatmapHandler = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      const logs = this.dataManager.getLogs();
      this.dataManager.getConfig().then((config) => {
        void renderWorkoutHeatmap(source, el, ctx, logs, config).catch(() => {});
      }).catch(() => {});
    };
    registerCodeBlock('workout-heatmap', heatmapHandler);
    this.registerMarkdownCodeBlockProcessor('workout-heatmap', async (source, el, ctx) => {
      heatmapHandler(source, el, ctx);
    });

    const planHandler = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      void renderWorkoutPlan(source, el, ctx, this.dataManager).catch(() => {});
    };
    registerCodeBlock('workout-plan', planHandler);
    this.registerMarkdownCodeBlockProcessor('workout-plan', async (source, el, ctx) => {
      planHandler(source, el, ctx);
    });
  }

  private registerSettingsTab(): void {
    this.settingsTab = new SettingsTab(this.app, this, this.dataManager);
    this.addSettingTab(this.settingsTab);
  }

  private registerEventListeners(): void {
    this.dataManager.on('data-changed', (data) => {
      void (async () => {
        const row = data?.row;
        if (row) {
          const config = await this.dataManager.getConfig();
          const name = row.exerciseId ? getExerciseNameById(config.exercises, row.exerciseId) : '';
          rerenderBlocksForExercise(config, row.exerciseId, name);
        } else {
          rerenderAllBlocks();
        }
        rerenderBlocksByType('workout-day');
        rerenderBlocksByType('workout-heatmap');
        this.notifyDecisionChanged();
      })().catch(() => {});
    });

    this.dataManager.on('config-changed', () => {
      rerenderAllBlocks();
      rerenderBlocksByType('workout-day');
      rerenderBlocksByType('workout-heatmap');
      this.notifyDecisionChanged();
    });

    this.dataManager.on('settings-changed', () => {
      rerenderBlocksByType('workout-plan');
      rerenderBlocksByType('workout-log');
    });

    this.registerEvent(
      this.app.vault.on('modify', async (file) => {
        try {
          const selfWritten = this.dataManager.isSelfWriting() || this.dataManager.wasSelfWrittenRecently();
          if (file.path === this.dataManager.getCsvPath()) {
            if (!selfWritten) {
              await this.dataManager.reloadLogs();
              rerenderAllBlocks();
            }
          }
          if (file.path === this.dataManager.getConfigPath()) {
            if (!selfWritten) {
              await this.dataManager.reloadConfig();
              rerenderAllBlocks();
            }
          }
        } catch (e) {
          console.error('[workout] vault modify handler error:', e);
        }
      })
    );
  }

  /**
   * P0 工具合约：暴露本插件的能力清单（与 CLI capabilities 命令共用 capability.ts）。
   * 宿主插件 / AI 可经插件实例动态发现。
   */
  getToolCapability(): ToolCapability {
    return getToolCapabilityDef();
  }

  // —— 决策中心接入（P3 contributor + P0 文件总线）——

  /** 注册 DecisionContributor 并检测宿主（KOS-block）。数据变化后通过 notifyDecisionChanged 通知宿主刷新。 */
  private initDecisionCenterIntegration(): void {
    const contributor = createWorkoutContributor(this, this.dataManager);
    const result = initDecisionCenter(this, contributor);
    this.decisionHostApi = result.hostApi;
  }

  /** 数据/配置变更后请求宿主刷新决策面板（无宿主时静默）。 */
  private notifyDecisionChanged(): void {
    try {
      this.decisionHostApi?.requestRefresh('workout-block');
    } catch {
      /* 宿主刷新异常不影响本插件 */
    }
  }

  /** 监听 `.block/inbox/queries/` 目录，处理 AI 写入的 pending 查询文件（异步文件总线，P0 5B）。 */
  private registerQueryBus(): void {
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (!(file instanceof TFile)) return;
        if (!file.path.startsWith(`${FILE_BUS_QUERIES_DIR}/`) || file.extension !== 'json') return;
        void this.handleQueryBusFile(file);
      })
    );
  }

  /** 执行文件总线查询：读取 QueryBusFile → executeQuery → 覆写同文件为 fulfilled/error。 */
  private async handleQueryBusFile(file: TFile): Promise<void> {
    let qf: QueryBusFile | null = null;
    try {
      const text = await this.app.vault.cachedRead(file);
      const parsed = JSON.parse(text) as QueryBusFile;
      if (parsed.pluginId !== 'workout-block') return;
      if (parsed.status !== 'pending') return;
      qf = parsed;
    } catch {
      return; // 非本插件 / 非 pending / 解析失败：忽略
    }

    try {
      const data: WorkoutQueryData = {
        records: this.dataManager.getLogs(),
        config: await this.dataManager.getConfig(),
      };
      const response = executeQuery(qf, data);
      const updated: QueryBusFile = {
        ...qf,
        status: 'fulfilled',
        response,
        completedAt: new Date().toISOString(),
      };
      await this.app.vault.process(file, () => JSON.stringify(updated, null, 2));
    } catch (e) {
      const updated: QueryBusFile = {
        ...qf,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
        completedAt: new Date().toISOString(),
      };
      try {
        await this.app.vault.process(file, () => JSON.stringify(updated, null, 2));
      } catch {
        /* 写回失败时放弃（AI 端超时会自行判定失败） */
      }
    }
  }

  /** 启动时清理超过 1 小时的过期查询文件（P0 约定：AI 读后删除，此处兜底）。 */
  private async cleanupQueryBus(): Promise<void> {
    try {
      const now = Date.now();
      const stale = this.app.vault
        .getFiles()
        .filter((f) => f.path.startsWith(`${FILE_BUS_QUERIES_DIR}/`) && f.extension === 'json' && f.stat?.mtime && now - f.stat.mtime > 3600e3);
      for (const f of stale) {
        await this.app.vault.delete(f, true);
      }
    } catch {
      /* 清理失败不影响插件启动 */
    }
  }

  /**
   * BlockProvider 契约：暴露本插件可插入的 block 定义列表。
   * 其他 block 插件的通用插入器通过 app.plugins.plugins 扫描此方法，
   * 实现跨插件动态发现与合并展示（无需模块级注册表）。
   */
  getBlockRegistry(): BlockDefinitionWithParams[] {
    const config = this.dataManager.getConfigSync();
    return CODE_BLOCK_DEFS.map((def) => ({
      language: def.id,
      name: def.title,
      description: def.desc,
      icon: def.icon,
      // 契约 v2：pluginId 供宿主定向找本插件的参数渲染器；title 是 name 的契约别名
      pluginId: this.manifest.id,
      title: def.title,
      params: def.params.map((p) => {
        // 跨插件联动关键：把 dynamic 数据源「物化」成静态 options/optionLabels。
        // 任何宿主插件（含 finance-block 等其它 block 插件）拿到后都能直接渲染下拉，
        // 无需访问本插件配置。否则其它宿主会因无法解析 dynamic，把 select 渲染成空选项
        // （表现为「— 不设置 —」或纯文本框）。
        const resolved = p.dynamic ? this.resolveDynamicOptions(config, p.dynamic) : undefined;
        return {
          key: p.key,
          label: p.label,
          description: p.desc,
          type: p.type,
          optional: !p.required,
          placeholder: p.placeholder,
          options: resolved?.options ?? p.options,
          optionLabels: resolved?.labels ?? p.optionLabels,
          dynamic: p.dynamic,
        };
      }),
    }));
  }

  /**
   * 契约 v2（参数渲染委托）：渲染本插件声明的「自定义 type」参数控件。
   * 供跨插件宿主对不认识的 type 定向调用（block.pluginId → 本方法）；宿主见
   * blockProvider.getPluginParamRenderer。实现委托给 paramRenderers（纯渲染，无状态）。
   * workout 自定义类型：exercise（训练项搜索 combobox）。
   */
  renderParamField(container: HTMLElement, param: BlockParamDef, ctx: ParamRenderContext): void {
    renderParamControl(container, param, ctx, this.dataManager.getConfigSync());
  }

  /** 把 dynamic 数据源解析为具体 options（供 getBlockRegistry 跨插件暴露时物化）。 */
  private resolveDynamicOptions(
    config: WorkoutConfig,
    dynamic: 'exercise' | 'plan' | 'metric',
  ): { options: string[]; labels: Record<string, string> } | undefined {
    let values: string[] = [];
    if (dynamic === 'plan') {
      values = (config.plans ?? []).map((pl) => pl.name);
    } else if (dynamic === 'metric') {
      values = (config.statistics ?? []).map((m) => m.id);
    } else {
      return undefined;
    }
    if (values.length === 0) return undefined;
    const labels: Record<string, string> = {};
    for (const v of values) labels[v] = v;
    return { options: values, labels };
  }

  // 打开"插入代码块"弹窗：跨插件通用（合并所有 BlockProvider 的定义，按插件分组展示）。
  private openInsertCodeBlockModal(): void {
    new InsertCodeBlockModal(this.app, this.dataManager).open();
  }

  private openRecordModal(exercise?: string, plan?: string): void {
    new RecordModal(this.dataManager, { exercise, plan }).open();
  }

  private openNewPlanModal(): void {
    new NewPlanModal(this.dataManager).open();
  }

  private openNewExerciseModal(): void {
    new ExerciseModal(this.dataManager).open();
  }

  private openNewTypeModal(): void {
    new TypeModal(this.dataManager).open();
  }

  private openSettings(): void {
    this.app.setting.open();
    this.app.setting.openTabById(this.manifest.id);
  }

  private openEditRecordModal(log: LogRow): void {
    new RecordModal(this.dataManager, { editLog: log }).open();
  }

  private async deleteRecord(log: LogRow): Promise<void> {
    if (!(await confirmWithModal(this.app, t('codeblock.confirmDelete')))) {
      return;
    }
    await this.dataManager.deleteLog(log.id);
    new Notice(t('settings.softDeleteHint'));
  }
}
