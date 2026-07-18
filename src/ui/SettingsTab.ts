import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import { rerenderAllBlocks } from '../codeblock/registry';
import { DataManager } from '../data/DataManager';
import { WorkoutConfig } from '../data/types';
import { setLocale, t } from '../i18n';
import { ExerciseManagerModal } from './ExerciseManagerModal';
import { MuscleManagerModal } from './MuscleManagerModal';
import { StatManagerModal } from './StatManagerModal';
import { TypeManagerModal } from './TypeManagerModal';
import { TrainingPlanManagerModal } from './TrainingPlanManagerModal';
import { VaultFolderSuggestModal } from './VaultFolderSuggestModal';
import { VaultPathSuggest } from './VaultPathSuggest';
import { confirmWithModal } from './Confirm';

/* SettingsTab —— 插件的设置页面。
 * 它继承 Obsidian 的 PluginSettingTab，是 Obsidian「设置」里本插件的专属页面。
 * 页面用 Obsidian 的 Setting 类逐项构建（每项 = 一行：标题 + 说明 + 控件）。
 * 这里负责：数据文件路径、训练类型/训练项/肌肉的管理入口、单位/语言/阈值等通用项、
 * 以及 Dataview / Daily Notes / Templater 的联动开关。任何修改都会保存到 DataManager 并刷新。 */

export class SettingsTab extends PluginSettingTab {
  // dataManager：本插件的核心数据管家，负责读取/保存配置与记录。
  private dataManager: DataManager;

  constructor(app: App, plugin: any, dataManager: DataManager) {
    super(app, plugin);
    this.dataManager = dataManager;
    // 设置页左侧导航里本插件的显示名（随语言切换）。
    this.name = t('pluginName');
  }

  // display() 是设置页的"绘制"方法，Obsidian 每次打开/重绘设置页都会调用它。
  // 注意：必须先 empty() 清掉旧内容，再重新渲染，否则重复打开会叠加。
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    // 页面大标题（文案来自多语言 i18n 的 t()）。
    containerEl.createEl('h2', { text: t('pluginName') });

    // 配置是异步读取的（来自磁盘上的 JSON），拿到后再分段渲染各区块。
    this.dataManager.getConfig().then((config) => {
      this.renderDataPathSection(containerEl);
      this.renderManagersSection(containerEl, config);
      this.renderMaintenanceSection(containerEl);
      this.renderGeneralSection(containerEl);
      // 联动开关区块（Dataview / Daily Notes / Templater）暂时隐藏，
      // 待第三方联动功能开发完成后再放开。保留 renderIntegrationSection 以便后续恢复。
      // this.renderIntegrationSection(containerEl);
    });
  }

  // 区块一：数据文件路径。包含"CSV 目录"和"配置 JSON 目录"两项，
  // 既支持手动输入，也支持点"浏览"按钮用 VaultFolderSuggestModal 选文件夹。
  private renderDataPathSection(containerEl: HTMLElement): void {
    const section = containerEl.createEl('div');
    section.createEl('h3', { text: t('settings.dataPath') });

    // CSV 目录设置项。Setting 构造 = 一行设置；setName 是标题，setDesc 是灰色说明。
    const csvSetting = new Setting(section)
      .setName(t('settings.csvDirectory'))
      .setDesc(t('settings.csvDirectoryDesc'));

    // 保存输入框引用，便于"浏览"选完文件夹后回填文字。
    let csvInput: { inputEl: HTMLInputElement; setValue(value: string): unknown } | null = null;
    // addText() 在设置项里加一个单行文本输入框，用于填写目录路径。
    csvSetting.addText((text) => {
      csvInput = text;
      text
        .setPlaceholder(t('settings.dataDirectoryPlaceholder'))
        .setValue(this.dataManager.getSettings().csvDirectory);

      // VaultPathSuggest：输入时弹出 Vault 内文件夹的自动补全建议。
      new VaultPathSuggest(this.app, text.inputEl, async (value: string) => {
        this.dataManager.getSettings().csvDirectory = value;
        await this.dataManager.saveSettings();
      });

      // 用户每次改文字都即时保存（onChange）。
      text.onChange(async (value) => {
        this.dataManager.getSettings().csvDirectory = value;
        await this.dataManager.saveSettings();
      });
    });
    // addButton() 在该设置项右侧加一个按钮；这里点"浏览"打开文件夹选择弹窗。
    csvSetting.addButton((btn) =>
      btn.setButtonText(t('settings.browse')).onClick(() => {
        new VaultFolderSuggestModal(this.app, async (value) => {
          csvInput?.setValue(value);
          this.dataManager.getSettings().csvDirectory = value;
          await this.dataManager.saveSettings();
        }).open();
      })
    );

    // 配置 JSON 目录设置项，结构和上面的 CSV 目录完全对称。
    const configSetting = new Setting(section)
      .setName(t('settings.configDirectory'))
      .setDesc(t('settings.configDirectoryDesc'));

    let configInput: { inputEl: HTMLInputElement; setValue(value: string): unknown } | null = null;
    configSetting.addText((text) => {
      configInput = text;
      text
        .setPlaceholder(t('settings.dataDirectoryPlaceholder'))
        .setValue(this.dataManager.getSettings().configDirectory);

      new VaultPathSuggest(this.app, text.inputEl, async (value: string) => {
        this.dataManager.getSettings().configDirectory = value;
        await this.dataManager.saveSettings();
      });

      text.onChange(async (value) => {
        this.dataManager.getSettings().configDirectory = value;
        await this.dataManager.saveSettings();
      });
    });
    configSetting.addButton((btn) =>
      btn.setButtonText(t('settings.browse')).onClick(() => {
        new VaultFolderSuggestModal(this.app, async (value) => {
          configInput?.setValue(value);
          this.dataManager.getSettings().configDirectory = value;
          await this.dataManager.saveSettings();
        }).open();
      })
    );
  }

  // 区块二：训练设置。把五个「打开管理」入口平铺成一个列表（不再按分类各自加标题），
  // 每行左侧有拖拽手柄，可用鼠标拖动改变显示顺序；新顺序存入 settings.managerOrder。
  // 说明：排序仅影响设置页里这些条目的显示顺序，不改变任何功能逻辑。
  private renderManagersSection(containerEl: HTMLElement, config: WorkoutConfig): void {
    const section = containerEl.createEl('div');
    section.createEl('h3', { text: t('settings.trainingSettings') });

    // 五个管理条目：key 仅用于排序存储；name/desc 为文案；open 为按钮点击后弹出的管理弹窗。
    const managers: Record<string, { name: string; desc: string; open: () => void }> = {
      types: {
        name: t('settings.typeManager'),
        desc: `${t('settings.totalTypes')}: ${config.trainingTypes.length}`,
        open: () => new TypeManagerModal(this.dataManager).open(),
      },
      exercises: {
        name: t('settings.exerciseManager'),
        desc: `${t('settings.totalExercises')}: ${config.exercises.length}`,
        open: () => new ExerciseManagerModal(this.dataManager).open(),
      },
      muscles: {
        name: t('settings.muscleManager'),
        desc: `${t('settings.totalMuscles')}: ${config.muscles.length}`,
        open: () => new MuscleManagerModal(this.dataManager).open(),
      },
      statistics: {
        name: t('settings.statisticsManager'),
        desc: `${t('settings.totalStatistics')}: ${config.statistics.length}`,
        open: () => new StatManagerModal(this.dataManager).open(),
      },
      plans: {
        name: t('settings.trainingPlans.manage'),
        desc: `${t('settings.totalPlans')}: ${config.plans?.length ?? 0}`,
        open: () => new TrainingPlanManagerModal(this.dataManager).open(),
      },
    };

    // 读取并校验已保存顺序，剔除未知 key、补齐缺失 key，保证顺序数组始终完整合法。
    const order = this.normalizeManagerOrder(this.dataManager.getSettings().managerOrder);

    // 平铺容器：所有条目渲染于此，便于拖拽时直接重排 DOM（条目间纯间距分隔，无分隔线）。
    const listEl = section.createEl('div', { cls: 'workout-manager-list' });

    // 拖拽中的源行引用。
    let dragEl: HTMLElement | null = null;

    const isMobile = this.app.isMobile;

    const renderRow = (key: string): void => {
      const def = managers[key];
      const setting = new Setting(listEl)
        .setName(def.name)
        .setDesc(def.desc)
        .addButton((btn) =>
          btn.setButtonText(t('settings.openManager')).onClick(() => def.open())
        );

      const row = setting.settingEl;
      row.classList.add('workout-manager-row');
      row.setAttribute('data-key', key);

      // 排序：上移 / 下移按钮，移动端与桌面端都常驻可用（移动端以按钮替代拖拽）。
      const move = async (dir: -1 | 1): Promise<void> => {
        const rows = Array.from(listEl.querySelectorAll<HTMLElement>('.workout-manager-row'));
        const i = rows.indexOf(row);
        const j = i + dir;
        if (j < 0 || j >= rows.length) return;
        if (dir === -1) listEl.insertBefore(row, rows[j]);
        else rows[j].after(row);
        const newOrder = Array.from(listEl.querySelectorAll<HTMLElement>('.workout-manager-row'))
          .map((el) => el.getAttribute('data-key'))
          .filter((k): k is string => !!k);
        this.dataManager.getSettings().managerOrder = newOrder;
        await this.dataManager.saveSettings();
      };
      setting
        .addButton((btn) => {
          btn.setIcon('arrow-up').setTooltip(t('settings.moveUp')).onClick(() => move(-1));
          btn.buttonEl.addClass('workout-manager-move');
        })
        .addButton((btn) => {
          btn.setIcon('arrow-down').setTooltip(t('settings.moveDown')).onClick(() => move(1));
          btn.buttonEl.addClass('workout-manager-move');
        });

      // 桌面端：拖拽手柄 + 拖拽事件；移动端不使用拖拽。
      if (!isMobile) {
        const handle = row.createEl('div', {
          cls: 'workout-manager-handle',
          attr: { 'aria-label': t('settings.dragToReorder'), title: t('settings.dragToReorder') },
        });
        // 六个点的拖拽图标（内联 SVG，随主题 currentColor 着色）。
        handle.innerHTML =
          '<svg viewBox="0 0 12 16" width="12" height="16" fill="currentColor">' +
          '<circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/>' +
          '<circle cx="3" cy="8" r="1.5"/><circle cx="9" cy="8" r="1.5"/>' +
          '<circle cx="3" cy="13" r="1.5"/><circle cx="9" cy="13" r="1.5"/></svg>';
        // createEl 默认追加到行尾，把手柄移到行首。
        row.insertBefore(handle, row.firstChild);
        handle.draggable = true;

        handle.addEventListener('dragstart', (e: DragEvent) => {
          dragEl = row;
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', key);
            // 以整行为拖拽影像，手柄拖起时整行跟随光标。
            e.dataTransfer.setDragImage(row, 0, 0);
          }
          row.classList.add('workout-manager-row--dragging');
        });
        handle.addEventListener('dragend', () => {
          dragEl = null;
          row.classList.remove('workout-manager-row--dragging');
          listEl
            .querySelectorAll('.workout-manager-row--over')
            .forEach((el) => el.classList.remove('workout-manager-row--over'));
        });

        // 拖拽相关事件挂在 row 上：手柄拖动时 row 是拖拽影像，命中检测与插入位置都基于 row。
        row.addEventListener('dragover', (e: DragEvent) => {
          if (!dragEl || dragEl === row) return;
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          row.classList.add('workout-manager-row--over');
        });
        row.addEventListener('dragleave', () => {
          row.classList.remove('workout-manager-row--over');
        });
        row.addEventListener('drop', async (e: DragEvent) => {
          e.preventDefault();
          if (!dragEl || dragEl === row) return;
          const rect = row.getBoundingClientRect();
          const after = e.clientY > rect.top + rect.height / 2;
          if (after) {
            row.after(dragEl);
          } else {
            row.before(dragEl);
          }
          // 重排后读取新顺序并保存，下次打开设置页沿用。
          const newOrder = Array.from(
            listEl.querySelectorAll<HTMLElement>('.workout-manager-row')
          )
            .map((el) => el.getAttribute('data-key'))
            .filter((k): k is string => !!k);
          this.dataManager.getSettings().managerOrder = newOrder;
          await this.dataManager.saveSettings();
        });
      }
    };

    order.forEach((key) => renderRow(key));
  }

  // 校验管理条目顺序：仅保留已知 key 并补齐缺失 key，保证顺序数组始终完整且合法。
  private normalizeManagerOrder(saved: string[] | undefined): string[] {
    const all = ['types', 'exercises', 'muscles', 'statistics', 'plans'];
    const valid = (saved ?? []).filter((k) => all.includes(k));
    const missing = all.filter((k) => !valid.includes(k));
    return [...valid, ...missing];
  }

  // 区块（数据维护）：压缩清理 CSV。删除记录采用软删除（仅标记、不重写），
  // 文件体积不会立即回收；本区块提供按钮，在用户主动触发时整文件压缩、彻底移除被删记录。
  private renderMaintenanceSection(containerEl: HTMLElement): void {
    const section = containerEl.createEl('div');
    section.createEl('h3', { text: t('settings.maintenance') });

    new Setting(section)
      .setName(t('settings.compactCsv'))
      .setDesc(t('settings.compactCsvDesc'))
      .addButton((btn) =>
        btn
          .setButtonText(t('settings.compactCsv'))
          .setWarning()
          .onClick(async () => {
            if (!(await confirmWithModal(this.app, t('settings.confirmCompact')))) return;
            const removed = await this.dataManager.compactLogs();
            new Notice(t('settings.compactDone', { n: String(removed) }));
          })
      );
  }

  // 区块六：通用设置。提醒阈值、重量单位、语言、上次值记忆。
  private renderGeneralSection(containerEl: HTMLElement): void {
    const section = containerEl.createEl('div');
    section.createEl('h3', { text: t('settings.general') });

    // 重量单位：下拉框（addDropdown）。可选 kg / lb，改后保存并刷新所有代码块。
    new Setting(section)
      .setName(t('settings.unit'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('kg', 'kg')
          .addOption('lb', 'lb')
          .setValue(this.dataManager.getSettings().unit)
          .onChange(async (value) => {
            this.dataManager.getSettings().unit = value as 'kg' | 'lb';
            await this.dataManager.saveSettings();
            rerenderAllBlocks();
          })
      );

    // 语言：下拉框，可选中文 / 英文。改后保存 + 切换语言 + 重绘本页以即时生效。
    new Setting(section)
      .setName(t('settings.language'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('zh', t('settings.chinese'))
          .addOption('en', t('settings.english'))
          .setValue(this.dataManager.getSettings().language)
          .onChange(async (value) => {
            this.dataManager.getSettings().language = value as 'zh' | 'en';
            await this.dataManager.saveSettings();
            setLocale(value as 'zh' | 'en');
            rerenderAllBlocks();
            this.display();
          })
      );

    // 上次值记忆：开关（addToggle）。打开后下次录训练会自动带出上次填的值。
    new Setting(section)
      .setName(t('settings.lastValueMemory'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.dataManager.getSettings().lastValueMemory)
          .onChange(async (value) => {
            this.dataManager.getSettings().lastValueMemory = value;
            await this.dataManager.saveSettings();
          })
      );
  }

  // 区块六：第三方联动开关。Dataview / Daily Notes / Templater 各自一个开关。
  private renderIntegrationSection(containerEl: HTMLElement): void {
    const section = containerEl.createEl('div');
    section.createEl('h3', { text: t('settings.integrations') });

    // 联动 Dataview 插件的开关。
    new Setting(section)
      .setName(t('settings.dataview'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.dataManager.getSettings().dataviewIntegration)
          .onChange(async (value) => {
            this.dataManager.getSettings().dataviewIntegration = value;
            await this.dataManager.saveSettings();
          })
      );

    // 联动 Daily Notes（日记）的开关。
    new Setting(section)
      .setName(t('settings.dailyNotes'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.dataManager.getSettings().dailyNotesIntegration)
          .onChange(async (value) => {
            this.dataManager.getSettings().dailyNotesIntegration = value;
            await this.dataManager.saveSettings();
          })
      );

    // 联动 Templater 插件的开关。
    new Setting(section)
      .setName(t('settings.templater'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.dataManager.getSettings().templaterIntegration)
          .onChange(async (value) => {
            this.dataManager.getSettings().templaterIntegration = value;
            await this.dataManager.saveSettings();
          })
      );
  }
}
