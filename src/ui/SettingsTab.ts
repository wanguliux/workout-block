import { App, PluginSettingTab, Notice } from 'obsidian';
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
 * 渲染采用声明式设置 API（Obsidian ≥ 1.13.0，即本插件声明的 minAppVersion）：
 * 通过 getSettingDefinitions() 声明式渲染，支持设置搜索、拖拽排序、文件夹建议器等原生控件。
 * 命令式 display() 已被 Obsidian 1.13.0+ 废弃，故此处完全采用声明式渲染、不再保留 display() 回退。
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
    const config = this.dataManager.getConfigSync();
    const settings = this.dataManager.getSettings();

    // 五个管理条目：key 仅用于排序存储；name/desc 为文案；open 为按钮点击后弹出的管理弹窗。
    const managers: Record<string, { name: string; desc: (c: WorkoutConfig) => string; open: () => void }> = {
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
      // 区块六：通用设置。
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
      // 区块六（第三方联动）：Dataview / Daily Notes / Templater 开关暂隐藏，
      // 待对应功能开发完成后再放开。
    ];
  }

  // 校验管理条目顺序：仅保留已知 key 并补齐缺失 key，保证顺序数组始终完整且合法。
  private normalizeManagerOrder(saved: string[] | undefined): string[] {
    const all = ['types', 'exercises', 'muscles', 'statistics', 'plans'];
    const valid = (saved ?? []).filter((k) => all.includes(k));
    const missing = all.filter((k) => !valid.includes(k));
    return [...valid, ...missing];
  }

  // 压缩清理 CSV 的共享逻辑：确认 -> 压缩 -> 提示。声明式 action 复用。
  private async compactCsv(): Promise<void> {
    if (!(await confirmWithModal(this.app, t('settings.confirmCompact')))) return;
    const removed = await this.dataManager.compactLogs();
    new Notice(t('settings.compactDone', { n: String(removed) }));
  }
}
