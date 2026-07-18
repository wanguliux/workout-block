import { Plugin, Notice } from 'obsidian';
import { DataManager } from './data/DataManager';
import { getExerciseNameById } from './data/display';
import { setLocale, t } from './i18n';
import { registerCodeBlock, rerenderAllBlocks, rerenderBlocksForExercise, rerenderBlocksByType, setRegistryApp } from './codeblock/registry';
import { renderWorkoutLog } from './codeblock/workoutLog';
import { renderWorkoutDay } from './codeblock/workoutDay';
import { renderWorkoutHeatmap } from './codeblock/workoutHeatmap';
import { renderWorkoutPlan } from './codeblock/workoutPlan';
import { LogRow, FieldDef } from './data/types';
import { applyMappingTier } from './data/muscleMapping';
import { RecordModal } from './ui/RecordModal';
import { confirmWithModal } from './ui/Confirm';
import { NewPlanModal } from './ui/NewPlanModal';
import { ExerciseModal } from './ui/ExerciseModal';
import { TypeModal } from './ui/TypeModal';
import { SettingsTab } from './ui/SettingsTab';
import { InsertCodeBlockModal } from './ui/InsertCodeBlockModal';

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

  // 插件卸载（禁用/重载）时调用。这里只需做简单的清理日志；子模块会在 Obsidian 内部被自动回收。
  onunload(): void {
    document.body.classList.remove('is-mobile');
  }

  // 注册命令面板中的命令。每个 addCommand 会在 Obsidian 命令面板（Ctrl/Cmd+P）里出现一条。
  // callback 指定点击该命令时执行的函数（这里都转发给对应的 openXxx 方法）。
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
  }

  // 注册左侧边栏（ribbon）的图标按钮。点击后同样打开单条记录录入弹窗。
  private registerRibbon(): void {
    this.addRibbonIcon('dumbbell', t('command.recordSet'), () => {
      this.openRecordModal();
    });
    this.addRibbonIcon('code', t('command.insertCodeblock'), () => {
      this.openInsertCodeBlockModal();
    });
  }

  // 注册 ```workout-log 代码块的接管渲染逻辑。
  // 当用户笔记里出现 ```workout-log ... ``` 代码块时，Obsidian 会把代码块内容
  // 交给这里的处理函数，由插件渲染成带交互（点击记录/编辑/删除）的表格。
  private registerCodeBlocks(): void {
    // codeBlockHandler 是真正的渲染逻辑：读取所有记录、单位、配置，然后交给 renderWorkoutLog 渲染。
    //   source: 代码块的原始文本（用户写在 ``` 之间的内容）
    //   el:     插件用来往页面里插入渲染结果的 DOM 容器
    //   ctx:    Obsidian 的渲染上下文（一般无需关心）
    const codeBlockHandler = (source: string, el: HTMLElement, ctx: any) => {
      const logs = this.dataManager.getLogs();
      const unit = this.dataManager.getSettings().unit;
      this.dataManager.getConfig().then((config) => {
        // 根据训练类型(category)找到该类型下定义的所有字段(FieldDef[])，用于表格列展示
        const getTrainingTypeFields = (category: string): FieldDef[] => {
          const type = config.trainingTypes.find((tt) => tt.id === category);
          return type?.fields || [];
        };

        // 调用真正渲染代码块的函数，并传入若干回调（点击行时打开哪个弹窗）
        void renderWorkoutLog(
          source,
          el,
          ctx,
          logs,
          getTrainingTypeFields,
          unit,
          config,
          (exercise, plan) => this.openRecordModal(exercise, plan), // 点击"记录"按钮
          (log) => this.openEditRecordModal(log),                   // 点击"编辑"
          (log) => this.deleteRecord(log)                          // 点击"删除"
        ).catch(() => {});
      }).catch(() => {});
    };

    // 把上面这个处理函数登记到代码块注册表（供后续 rerenderAllBlocks 统一重渲染使用）
    registerCodeBlock('workout-log', codeBlockHandler);

    // 官方方式：告诉 Obsidian，workout-log 这个代码块类型由我们接管渲染
    this.registerMarkdownCodeBlockProcessor('workout-log', async (source, el, ctx) => {
      codeBlockHandler(source, el, ctx);
    });

    // 同样的模式注册 workout-day 代码块（当日训练总览表）。
    const dayHandler = (source: string, el: HTMLElement, ctx: any) => {
      const logs = this.dataManager.getLogs();
      this.dataManager.getConfig().then((config) => {
        void renderWorkoutDay(source, el, ctx, this.app, logs, config).catch(() => {});
      }).catch(() => {});
    };
    registerCodeBlock('workout-day', dayHandler);
    this.registerMarkdownCodeBlockProcessor('workout-day', async (source, el, ctx) => {
      dayHandler(source, el, ctx);
    });

    // 注册 workout-heatmap 代码块（全身肌肉热力图）
    const heatmapHandler = (source: string, el: HTMLElement, ctx: any) => {
      const logs = this.dataManager.getLogs();
      this.dataManager.getConfig().then((config) => {
        void renderWorkoutHeatmap(source, el, ctx, logs, config).catch(() => {});
      }).catch(() => {});
    };
    registerCodeBlock('workout-heatmap', heatmapHandler);
    this.registerMarkdownCodeBlockProcessor('workout-heatmap', async (source, el, ctx) => {
      heatmapHandler(source, el, ctx);
    });

    // 注册 workout-plan 代码块（训练计划完成面板）。无 plan 参数时渲染「选择计划」下拉，
    // 选中后写回代码块；有 plan 时渲染完成面板（每组 [编辑][完成] + 进度）。
    const planHandler = (source: string, el: HTMLElement, ctx: any) => {
      void renderWorkoutPlan(source, el, ctx, this.dataManager).catch(() => {});
    };
    registerCodeBlock('workout-plan', planHandler);
    this.registerMarkdownCodeBlockProcessor('workout-plan', async (source, el, ctx) => {
      planHandler(source, el, ctx);
    });
  }

  // 注册设置页（Settings → 找到本插件）。SettingsTab 负责插件的可视化配置界面。
  private registerSettingsTab(): void {
    this.settingsTab = new SettingsTab(this.app, this, this.dataManager);
    this.addSettingTab(this.settingsTab);
  }

  // 注册事件监听：当数据或配置变化时，自动重渲染相关 workout-log 代码块，保证页面显示最新数据。
  private registerEventListeners(): void {
    // 数据（记录）变化后：若知道是哪条记录变了，只重渲染显示该训练项的表格；
    // 否则（如批量导入）退化为全量重渲染。这样添加一条记录就不会重建所有表格。
    // 传入 config 是为了让 rerenderBlocksForExercise 按稳定的 exerciseId 匹配代码块，
    // 避免多语言下源码写中文名、记录存英文显示名时重渲染不到对应表格。
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
        // workout-day 按日聚合所有训练项，任何一条记录变化都可能改变某日的展示，统一重渲染
        rerenderBlocksByType('workout-day');
        // 训练记录变化影响热力图数据，统一重渲染
        rerenderBlocksByType('workout-heatmap');
      })().catch(() => {});
    });

    // 配置（训练项/类型/语言）变化后，标签与字段都可能变，需要全量重渲染
    this.dataManager.on('config-changed', () => {
      rerenderAllBlocks();
      // 训练项/肌肉/统计配置变化同样影响 workout-day 的展示，统一重渲染
      rerenderBlocksByType('workout-day');
      // 肌肉映射与统计配置变化影响热力图，统一重渲染
      rerenderBlocksByType('workout-heatmap');
    });

    // 单位/语言等设置变化后，单位相关的代码块（完成面板、记录表）需刷新以反映新单位
    this.dataManager.on('settings-changed', () => {
      rerenderBlocksByType('workout-plan');
      rerenderBlocksByType('workout-log');
    });

    // 监听仓库文件被修改的事件：仅当用户「在插件之外」手动改了 CSV / 配置文件时才需要
    // 整体重读 + 重渲染。插件自身写盘期间（或刚写完后很短窗口内）selfWriting / wasSelfWrittenRecently
    // 为真，此时 data-changed 已经做了精准重渲染，这里直接跳过，避免重复开销与卡顿。
    // 注意：vault.on('modify') 在写盘完成后才异步派发，届时 selfWriting 已被复位为 false，
    // 故必须叠加 wasSelfWrittenRecently 时间戳兜底，否则自身删除/编辑写盘会触发整文件重读 +
    // 全量重渲染（含 320KB 肌肉 SVG 热力图），导致删除记录后 Obsidian 主线程卡死、无法立即编辑。
    this.app.vault.on('modify', async (file) => {
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
    });
  }

  // 打开"插入代码块"弹窗：列出全部训练代码块，选择后带参插入到光标处。
  private openInsertCodeBlockModal(): void {
    new InsertCodeBlockModal(this.dataManager).open();
  }

  // 打开"记录一组"弹窗。可选传入 exercise（预选训练项）和 plan（所属训练方案名）。
  private openRecordModal(exercise?: string, plan?: string): void {
    new RecordModal(this.dataManager, { exercise, plan }).open();
  }

  // 打开"新增训练计划"弹窗（配置形态：选择方案 / 手动添加、预设每组字段、设定计划时间）
  private openNewPlanModal(): void {
    new NewPlanModal(this.dataManager).open();
  }

  // 打开"新建训练项"弹窗
  private openNewExerciseModal(): void {
    new ExerciseModal(this.dataManager).open();
  }

  // 打开"新建训练类型"弹窗
  private openNewTypeModal(): void {
    new TypeModal(this.dataManager).open();
  }

  // 打开设置页：先打开 Obsidian 设置，再定位到本插件对应的标签页
  private openSettings(): void {
    this.app.setting.open();
    this.app.setting.openTabById(this.manifest.id);
  }

  // 打开"编辑已有记录"弹窗：把要编辑的记录 editLog 传给 RecordModal
  private openEditRecordModal(log: LogRow): void {
    new RecordModal(this.dataManager, { editLog: log }).open();
  }

  // 删除一条记录：先用浏览器原生 confirm 确认，再调用 dataManager 删除（dataManager 会触发 data-changed 重渲染）
  private async deleteRecord(log: LogRow): Promise<void> {
    if (!(await confirmWithModal(this.app, t('codeblock.confirmDelete')))) {
      return;
    }
    await this.dataManager.deleteLog(log.id);
    // 软删除：记录已即时从界面移除，但磁盘文件需到设置页「压缩清理 CSV」才真正回收体积。
    new Notice(t('settings.softDeleteHint'));
  }
}
