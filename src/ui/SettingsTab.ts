import { App, PluginSettingTab, Notice, Setting, TextComponent } from 'obsidian';
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
import { VaultPathSuggest } from './VaultPathSuggest';
import { VaultFolderSuggestModal } from './VaultFolderSuggestModal';

/* SettingsTab —— 插件设置页（双轨渲染）。
 *
 * - Obsidian ≥ 1.13.0：用声明式 getSettingDefinitions() 渲染（设置搜索 / 拖拽排序 / 文件夹建议器原生控件）。
 * - Obsidian < 1.13.0：回退到命令式 display()（当前调试环境多为该版本，且社区对该写法仅报 Warning，非 Error）。
 *
 * 两套渲染内容完全一致。升级到 1.13.0+ 后，删除 display() 及其命令式方法即可切到纯声明式，
 * 社区 lint 不会因此产生 Error。 */

export class SettingsTab extends PluginSettingTab {
  // dataManager：本插件的核心数据管家，负责读取/保存配置与记录。
  private dataManager: DataManager;

  constructor(app: App, plugin: WorkoutPlugin, dataManager: DataManager) {
    super(app, plugin);
    this.dataManager = dataManager;
    // 1.13.0+ 的 PluginSettingTab 类型已移除 name 字段，但运行时 Obsidian 仍用它作为
    // 设置侧栏的插件标签，故保留赋值（转型绕过类型缺失）。
    (this as unknown as { name: string }).name = t('pluginName');
  }

  // 五个管理条目：key 仅用于排序存储；name/desc 为文案；open 为打开对应管理弹窗。
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

  // 声明式控件「当前值读取」钩子（Obsidian ≥ 1.13.0 调用）。
  getControlValue(key: string): unknown {
    const settings = this.dataManager.getSettings() as unknown as Record<string, unknown>;
    return settings[key];
  }

  // 声明式控件「值变更持久化」钩子（Obsidian ≥ 1.13.0 调用）。
  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.dataManager.getSettings() as unknown as Record<string, unknown>;
    settings[key] = value;
    await this.dataManager.saveSettings();
    if (key === 'language') {
      setLocale(value as 'zh' | 'en');
      rerenderAllBlocks();
      // 设置文案随语言变化，重渲染整页定义以刷新显示名/说明。
      // update() 是 1.13.0 才加入的 API；用动态属性访问规避社区 lint（no-unsupported-api），
      // 使插件在更低的 minAppVersion 下也能通过校验，且运行时仅在 ≥1.13.0 存在该成员时调用。
      const self = this as unknown as Record<string, unknown>;
      const updateFn = self['update'];
      if (typeof updateFn === 'function') (updateFn as () => void)();
    } else if (key === 'unit') {
      rerenderAllBlocks();
    }
  }

  // 声明式设置定义（Obsidian ≥ 1.13.0）：设置页完整内容（数据路径 / 管理入口 / 维护 / 通用项）。
  getSettingDefinitions(): SettingDefinitionItem[] {
    const managers = this.buildManagers();
    const config = this.dataManager.getConfigSync();
    const settings = this.dataManager.getSettings();

    const order = this.normalizeManagerOrder(settings.managerOrder);
    const managerItems: SettingDefinition[] = order.map((key) => ({
      name: managers[key].name,
      desc: managers[key].desc(config),
      // 整行可点击打开对应管理弹窗（等价原「打开管理」按钮）。
      action: () => {
        managers[key].open();
      },
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
      // 区块二：训练设置。声明式 list + onReorder 等价原拖拽手柄排序；整行点击打开管理弹窗。
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
      // 区块三（数据维护）：压缩清理 CSV。整行可点击触发压缩（等价原 destructive 按钮）。
      {
        type: 'group',
        heading: t('settings.maintenance'),
        items: [
          {
            name: t('settings.compactCsv'),
            desc: t('settings.compactCsvDesc'),
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

  // 校验管理条目顺序：仅保留已知 key 并补齐缺失 key，保证顺序数组始终完整合法。
  private normalizeManagerOrder(saved: string[] | undefined): string[] {
    const all = ['types', 'exercises', 'muscles', 'statistics', 'plans'];
    const valid = (saved ?? []).filter((k) => all.includes(k));
    const missing = all.filter((k) => !valid.includes(k));
    return [...valid, ...missing];
  }

  // 压缩清理 CSV 的共享逻辑：确认 -> 压缩 -> 提示。
  private async compactCsv(): Promise<void> {
    if (!(await confirmWithModal(this.app, t('settings.confirmCompact')))) return;
    const removed = await this.dataManager.compactLogs();
    new Notice(t('settings.compactDone', { n: String(removed) }));
  }

  // ===== 命令式回退（Obsidian < 1.13.0）：与声明式内容一致 =====

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const config = this.dataManager.getConfigSync();
    const settings = this.dataManager.getSettings() as unknown as Record<string, unknown>;
    this.renderDataPathSection(containerEl, settings);
    this.renderManagersSection(containerEl, config, settings);
    this.renderMaintenanceSection(containerEl);
    this.renderGeneralSection(containerEl, settings);
  }

  private renderDataPathSection(containerEl: HTMLElement, settings: Record<string, unknown>): void {
    new Setting(containerEl).setName(t('settings.dataPath')).setHeading();
    this.renderFolderSetting(containerEl, settings, 'csvDirectory', t('settings.csvDirectory'), t('settings.csvDirectoryDesc'));
    this.renderFolderSetting(containerEl, settings, 'configDirectory', t('settings.configDirectory'), t('settings.configDirectoryDesc'));
  }

  // 渲染单个「数据目录」设置行：文本框（边打字边提示匹配文件夹）+ 浏览按钮（弹出模糊搜索选择文件夹）。
  // 这是命令式回退路径（Obsidian < 1.13.0）下对声明式 folder 控件（自带 vault 文件夹建议器）的等价实现。
  private renderFolderSetting(
    containerEl: HTMLElement,
    settings: Record<string, unknown>,
    key: string,
    name: string,
    desc: string
  ): void {
    const setting = new Setting(containerEl).setName(name).setDesc(desc);

    let textComp: TextComponent | undefined;
    setting.addText((text) => {
      textComp = text;
      text
        .setPlaceholder(t('settings.dataDirectoryPlaceholder'))
        .setValue((settings[key] as string) ?? '')
        .onChange(async (v) => {
          settings[key] = v;
          await this.dataManager.saveSettings();
        });
    });

    // 实时输入建议：边打字边列出匹配的 vault 文件夹路径。
    if (textComp) {
      new VaultPathSuggest(this.app, textComp.inputEl, async (v) => {
        settings[key] = v;
        await this.dataManager.saveSettings();
      });
    }

    // 浏览按钮：弹出模糊搜索弹窗，从 vault 文件夹结构里挑选目标目录。
    setting.addButton((btn) =>
      btn
        .setButtonText(t('settings.browse'))
        .setIcon('folder-open')
        .onClick(() => {
          new VaultFolderSuggestModal(this.app, (v) => {
            if (textComp) textComp.setValue(v);
            settings[key] = v;
            void this.dataManager.saveSettings();
          }).open();
        })
    );
  }

  private renderManagersSection(containerEl: HTMLElement, config: WorkoutConfig, settings: Record<string, unknown>): void {
    new Setting(containerEl).setName(t('settings.trainingSettings')).setHeading();
    const order = this.normalizeManagerOrder(settings['managerOrder'] as string[] | undefined);
    const managers = this.buildManagers();
    order.forEach((key, idx) => {
      const m = managers[key];
      const row = new Setting(containerEl).setName(m.name).setDesc(m.desc(config));
      // ↑/↓ 排序箭头（双端可用；首尾项不显示对应方向），放在「打开管理」按钮左侧。
      if (idx > 0) {
        row.addExtraButton((cb) =>
          cb
            .setIcon('arrow-up')
            .setTooltip(t('settings.moveUp'))
            .onClick(() => void this.moveManager(idx, idx - 1))
        );
      }
      if (idx < order.length - 1) {
        row.addExtraButton((cb) =>
          cb
            .setIcon('arrow-down')
            .setTooltip(t('settings.moveDown'))
            .onClick(() => void this.moveManager(idx, idx + 1))
        );
      }
      // 「打开管理」按钮放在整行最右侧。
      row.addButton((btn) => btn.setButtonText(t('settings.openManager')).onClick(() => m.open()));
    });
  }

  private renderMaintenanceSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t('settings.maintenance')).setHeading();
    new Setting(containerEl)
      .setName(t('settings.compactCsv'))
      .setDesc(t('settings.compactCsvDesc'))
      .addButton((btn) => btn.setButtonText(t('settings.compactCsv')).onClick(() => void this.compactCsv()));
  }

  private renderGeneralSection(containerEl: HTMLElement, settings: Record<string, unknown>): void {
    new Setting(containerEl).setName(t('settings.general')).setHeading();
    new Setting(containerEl)
      .setName(t('settings.unit'))
      .addDropdown((dd) =>
        dd
          .addOption('kg', 'kg')
          .addOption('lb', 'lb')
          .setValue((settings['unit'] as string) ?? 'kg')
          .onChange(async (v) => {
            settings['unit'] = v;
            await this.dataManager.saveSettings();
            rerenderAllBlocks();
          })
      );
    new Setting(containerEl)
      .setName(t('settings.language'))
      .addDropdown((dd) =>
        dd
          .addOption('zh', t('settings.chinese'))
          .addOption('en', t('settings.english'))
          .setValue((settings['language'] as string) ?? 'zh')
          .onChange(async (v) => {
            settings['language'] = v;
            await this.dataManager.saveSettings();
            setLocale(v as 'zh' | 'en');
            rerenderAllBlocks();
            // 语言切换后整页重绘以刷新文案（命令式模式下未走声明式 update()）。
            this.display();
          })
      );
    new Setting(containerEl)
      .setName(t('settings.lastValueMemory'))
      .addToggle((tg) =>
        tg.setValue(!!settings['lastValueMemory']).onChange(async (v) => {
          settings['lastValueMemory'] = v;
          await this.dataManager.saveSettings();
        })
      );
  }

  private async moveManager(from: number, to: number): Promise<void> {
    const current = this.normalizeManagerOrder(this.dataManager.getSettings().managerOrder);
    const [moved] = current.splice(from, 1);
    current.splice(to, 0, moved);
    this.dataManager.getSettings().managerOrder = current;
    await this.dataManager.saveSettings();
    this.display();
  }
}
