import { App, PluginSettingTab, Notice, Setting } from 'obsidian';
import type { SettingDefinitionItem, SettingDefinition } from 'obsidian';
import type WorkoutPlugin from '../main';
import { rerenderAllBlocks } from '../codeblock/registry';
import { DataManager } from '../data/DataManager';
import { WorkoutConfig } from '../data/types';
import { setLocale, t } from '../i18n';
import { ExerciseManagerModal } from './ExerciseManagerModal';
import { MuscleManagerModal } from './MuscleManagerModal';
import { StatManagerModal } from './StatManagerModal';
import { TypeManagerModal } from './TypeManagerModal';
import { TrainingPlanManagerModal } from './TrainingPlanManagerModal';
import { confirmWithModal } from './Confirm';

/* SettingsTab —— 插件的设置页面。
 * 它继承 Obsidian 的 PluginSettingTab，是 Obsidian「设置」里本插件的专属页面。
 *
 * 渲染采用「双轨」：
 *  - ≥ 1.13.0：用声明式 getSettingDefinitions() 渲染（支持设置搜索、拖拽排序、文件夹建议器等原生控件），
 *    本文件的 display() 在该版本下不会被调用。
 *  - < 1.13.0：回退到命令式 display()，保持一致的设置体验。
 * 两套渲染的内容与行为一致，仅实现方式不同（声明式 vs 命令式）。minAppVersion 已声明为 1.13.0，
 * 但为兼容仍用开发模式 / BRAT 加载到旧版本的用户，保留 display() 回退。
 *
 * 这里负责：数据文件路径、训练类型/训练项/肌肉的管理入口、单位/语言/阈值等通用项、
 * 以及 Dataview / Daily Notes / Templater 的联动开关（暂隐藏，待功能完成）。 */

export class SettingsTab extends PluginSettingTab {
  // dataManager：本插件的核心数据管家，负责读取/保存配置与记录。
  private dataManager: DataManager;

  constructor(app: App, plugin: WorkoutPlugin, dataManager: DataManager) {
    super(app, plugin);
    this.dataManager = dataManager;
    // 设置页左侧导航里本插件的显示名（随语言切换）。
    // 注：1.13.0+ 的 PluginSettingTab 类型已移除 name 字段，但运行时侧栏
    // 仍可能依赖该字段作为显示名，故保留赋值以兼容。
    (this as unknown as { name: string }).name = t('pluginName');
  }

  // 五个管理条目：key 仅用于排序存储；name/desc 为文案；open 为按钮点击后弹出的管理弹窗。
  // 声明式（getSettingDefinitions）与命令式（display）共用，保证两套渲染内容一致。
  private buildManagers(): Record<string, { name: string; desc: (c: WorkoutConfig) => string; open: () => void }> {
    return {
      types: {
        name: t('settings.typeManager'),
        desc: (c) => `${t('settings.totalTypes')}: ${c.trainingTypes.length}`,
        open: () => new TypeManagerModal(this.dataManager).open(),
      },
      exercises: {
        name: t('settings.exerciseManager'),
        desc: (c) => `${t('settings.totalExercises')}: ${c.exercises.length}`,
        open: () => new ExerciseManagerModal(this.dataManager).open(),
      },
      muscles: {
        name: t('settings.muscleManager'),
        desc: (c) => `${t('settings.totalMuscles')}: ${c.muscles.length}`,
        open: () => new MuscleManagerModal(this.dataManager).open(),
      },
      statistics: {
        name: t('settings.statisticsManager'),
        desc: (c) => `${t('settings.totalStatistics')}: ${c.statistics.length}`,
        open: () => new StatManagerModal(this.dataManager).open(),
      },
      plans: {
        name: t('settings.trainingPlans.manage'),
        desc: (c) => `${t('settings.totalPlans')}: ${c.plans?.length ?? 0}`,
        open: () => new TrainingPlanManagerModal(this.dataManager).open(),
      },
    };
  }

  // ───────────────────────── 声明式设置 API（≥ 1.13.0） ─────────────────────────
  // 返回搜索可索引、可声明式渲染的设置定义；1.13.0+ 下 Obsidian 直接用本定义渲染设置页，
  // 不再调用 display()，故以下即用原生控件完整描述设置项及其交互。

  // 供声明式控件的「当前值读取」钩子。框架按 control.key 调用，
  // 我们直接从内存设置里取对应字段。
  getControlValue(key: string): unknown {
    const settings = this.dataManager.getSettings() as unknown as Record<string, unknown>;
    return settings[key];
  }

  // 供声明式控件的「值变更持久化」钩子。框架按 control.key 调用；
  // 写入内存设置并落盘，附带必要的副作用（语言切换 / 单位切换需重渲染代码块）。
  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.dataManager.getSettings() as unknown as Record<string, unknown>;
    settings[key] = value;
    await this.dataManager.saveSettings();
    if (key === 'language') {
      setLocale(value as 'zh' | 'en');
      rerenderAllBlocks();
      // 设置文案随语言变化，重渲染整页定义以刷新显示名/说明。
      this.update();
    } else if (key === 'unit') {
      // 重量单位变化影响记录表与完成面板的单位显示。
      rerenderAllBlocks();
    }
  }

  // 声明式定义：设置页完整内容（数据路径 / 管理入口 / 维护 / 通用项）。
  getSettingDefinitions(): SettingDefinitionItem[] {
    const managers = this.buildManagers();
    const config = this.dataManager.getConfigSync();
    const settings = this.dataManager.getSettings();

    // 读取并校验已保存顺序，剔除未知 key、补齐缺失 key，保证顺序数组始终完整合法。
    const order = this.normalizeManagerOrder(settings.managerOrder);
    const managerItems: SettingDefinition[] = order.map((key) => ({
      name: managers[key].name,
      desc: managers[key].desc(config),
      // 整行可点击打开对应管理弹窗（等价原「打开管理」按钮）。
      action: () => managers[key].open(),
    }));

    return [
      // 区块一：数据文件路径（folder 控件自带 vault 文件夹建议器，等价原 VaultPathSuggest + 浏览按钮）。
      {
        type: 'group',
        heading: t('settings.dataPath'),
        items: [
          {
            name: t('settings.csvDirectory'),
            desc: t('settings.csvDirectoryDesc'),
            control: { type: 'folder', key: 'csvDirectory', placeholder: t('settings.dataDirectoryPlaceholder') },
          },
          {
            name: t('settings.configDirectory'),
            desc: t('settings.configDirectoryDesc'),
            control: { type: 'folder', key: 'configDirectory', placeholder: t('settings.dataDirectoryPlaceholder') },
          },
        ],
      },
      // 区块二：训练设置。声明式 list + onReorder 等价原拖拽手柄排序。
      {
        type: 'list',
        heading: t('settings.trainingSettings'),
        items: managerItems,
        onReorder: (oldIndex: number, newIndex: number) => {
          const current = this.normalizeManagerOrder(this.dataManager.getSettings().managerOrder);
          const [moved] = current.splice(oldIndex, 1);
          current.splice(newIndex, 0, moved);
          this.dataManager.getSettings().managerOrder = current;
          void this.dataManager.saveSettings();
        },
      },
      // 区块三（数据维护）：压缩清理 CSV。
      {
        type: 'group',
        heading: t('settings.maintenance'),
        items: [
          {
            name: t('settings.compactCsv'),
            desc: t('settings.compactCsvDesc'),
            // 整行可点击触发压缩（等价原 destructive 按钮）。
            action: () => {
              void this.compactCsv();
            },
          },
        ],
      },
      // 区块四：通用设置。
      {
        type: 'group',
        heading: t('settings.general'),
        items: [
          {
            name: t('settings.unit'),
            control: { type: 'dropdown', key: 'unit', options: { kg: 'kg', lb: 'lb' } },
          },
          {
            name: t('settings.language'),
            control: {
              type: 'dropdown',
              key: 'language',
              options: { zh: t('settings.chinese'), en: t('settings.english') },
            },
          },
          {
            name: t('settings.lastValueMemory'),
            control: { type: 'toggle', key: 'lastValueMemory' },
          },
        ],
      },
      // 区块（第三方联动）：Dataview / Daily Notes / Templater 开关暂隐藏，
      // 待对应功能开发完成后再放开。
    ];
  }

  // ───────────────────────── 命令式回退（< 1.13.0） ─────────────────────────
  // 以下内容仅用于 Obsidian 早于 1.13.0 的环境：该版本不识别 getSettingDefinitions()，
  // 会改回调用本命令式 display()。≥ 1.13.0 时 Obsidian 优先用声明式定义，本方法不会被调用。
  // eslint-disable-next-line obsidianmd/settings-tab/no-deprecated-display
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // 区块一：数据文件路径（addText 直接输入路径，跨版本兼容，不依赖已移除的文件夹建议器）。
    new Setting(containerEl).setName(t('settings.dataPath')).setHeading();
    this.renderDataPathSection(containerEl);

    // 区块二：训练设置（管理列表 + ↑/↓ 排序，双端可用）。
    new Setting(containerEl).setName(t('settings.trainingSettings')).setHeading();
    this.renderManagersSection(containerEl);

    // 区块三：数据维护。
    new Setting(containerEl).setName(t('settings.maintenance')).setHeading();
    this.renderMaintenanceSection(containerEl);

    // 区块四：通用设置。
    new Setting(containerEl).setName(t('settings.general')).setHeading();
    this.renderGeneralSection(containerEl);

    // 第三方联动开关暂隐藏，待功能完成。
  }

  private renderDataPathSection(el: HTMLElement): void {
    const settings = this.dataManager.getSettings();
    new Setting(el)
      .setName(t('settings.csvDirectory'))
      .setDesc(t('settings.csvDirectoryDesc'))
      .addText((text) =>
        text
          .setPlaceholder(t('settings.dataDirectoryPlaceholder'))
          .setValue(settings.csvDirectory ?? '')
          .onChange(async (v) => {
            settings.csvDirectory = v;
            await this.dataManager.saveSettings();
          })
      );
    new Setting(el)
      .setName(t('settings.configDirectory'))
      .setDesc(t('settings.configDirectoryDesc'))
      .addText((text) =>
        text
          .setPlaceholder(t('settings.dataDirectoryPlaceholder'))
          .setValue(settings.configDirectory ?? '')
          .onChange(async (v) => {
            settings.configDirectory = v;
            await this.dataManager.saveSettings();
          })
      );
  }

  private renderManagersSection(el: HTMLElement): void {
    const config = this.dataManager.getConfigSync();
    const settings = this.dataManager.getSettings();
    const managers = this.buildManagers();
    const order = this.normalizeManagerOrder(settings.managerOrder);

    order.forEach((key, idx) => {
      const m = managers[key];
      const row = new Setting(el).setName(m.name).setDesc(m.desc(config));
      // ↑/↓ 排序按钮（双端可用；首尾项不显示对应方向）。
      // 先添加排序按钮，再添加「打开管理」，确保「打开管理」位于整行最右侧。
      if (idx > 0) {
        row.addExtraButton((cb) =>
          cb
            .setIcon('arrow-up')
            .setTooltip(t('settings.moveUp'))
            .onClick(async () => {
              await this.moveManager(idx, idx - 1);
            })
        );
      }
      if (idx < order.length - 1) {
        row.addExtraButton((cb) =>
          cb
            .setIcon('arrow-down')
            .setTooltip(t('settings.moveDown'))
            .onClick(async () => {
              await this.moveManager(idx, idx + 1);
            })
        );
      }
      // 「打开管理」按钮，放在排序箭头右侧，即整行最右。
      row.addButton((btn) => btn.setButtonText(t('settings.openManager')).onClick(() => m.open()));
    });
  }

  private renderMaintenanceSection(el: HTMLElement): void {
    new Setting(el)
      .setName(t('settings.compactCsv'))
      .setDesc(t('settings.compactCsvDesc'))
      .addButton((btn) =>
        btn
          .setWarning()
          .setButtonText(t('settings.compactCsv'))
          .onClick(() => void this.compactCsv())
      );
  }

  private renderGeneralSection(el: HTMLElement): void {
    const settings = this.dataManager.getSettings();
    new Setting(el)
      .setName(t('settings.unit'))
      .addDropdown((dd) =>
        dd
          .addOption('kg', 'kg')
          .addOption('lb', 'lb')
          .setValue(settings.unit)
          .onChange(async (v) => {
            settings.unit = v as 'kg' | 'lb';
            await this.dataManager.saveSettings();
            rerenderAllBlocks();
          })
      );
    new Setting(el)
      .setName(t('settings.language'))
      .addDropdown((dd) =>
        dd
          .addOption('zh', t('settings.chinese'))
          .addOption('en', t('settings.english'))
          .setValue(settings.language)
          .onChange(async (v) => {
            settings.language = v as 'zh' | 'en';
            await this.dataManager.saveSettings();
            setLocale(v as 'zh' | 'en');
            rerenderAllBlocks();
            this.display();
          })
      );
    new Setting(el)
      .setName(t('settings.lastValueMemory'))
      .addToggle((tg) =>
        tg.setValue(settings.lastValueMemory).onChange(async (v) => {
          settings.lastValueMemory = v;
          await this.dataManager.saveSettings();
        })
      );
  }

  // 管理条目排序：把 from 位置项移到 to 位置，落盘后重渲染本页。
  private async moveManager(from: number, to: number): Promise<void> {
    const current = this.normalizeManagerOrder(this.dataManager.getSettings().managerOrder);
    const [moved] = current.splice(from, 1);
    current.splice(to, 0, moved);
    this.dataManager.getSettings().managerOrder = current;
    await this.dataManager.saveSettings();
    this.display();
  }

  // 校验管理条目顺序：仅保留已知 key 并补齐缺失 key，保证顺序数组始终完整且合法。
  private normalizeManagerOrder(saved: string[] | undefined): string[] {
    const all = ['types', 'exercises', 'muscles', 'statistics', 'plans'];
    const valid = (saved ?? []).filter((k) => all.includes(k));
    const missing = all.filter((k) => !valid.includes(k));
    return [...valid, ...missing];
  }

  // 压缩清理 CSV 的共享逻辑：确认 -> 压缩 -> 提示。声明式 action 与命令式按钮复用。
  private async compactCsv(): Promise<void> {
    if (!(await confirmWithModal(this.app, t('settings.confirmCompact')))) return;
    const removed = await this.dataManager.compactLogs();
    new Notice(t('settings.compactDone', { n: String(removed) }));
  }
}
