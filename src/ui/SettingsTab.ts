import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
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
import { VaultFolderSuggestModal } from './VaultFolderSuggestModal';
import { VaultPathSuggest } from './VaultPathSuggest';
import { confirmWithModal } from './Confirm';

/* SettingsTab —— 插件的设置页面。
 * 它继承 Obsidian 的 PluginSettingTab，是 Obsidian「设置」里本插件的专属页面。
 *
 * 渲染采用声明式设置 API（Obsidian ≥ 1.13.0，即本插件声明的 minAppVersion）：
 * 通过 getSettingDefinitions() 声明式渲染，支持设置搜索、拖拽排序、文件夹建议器等原生控件，
 * 本文件的 display() 在该版本下不会被调用。
 * 为兼容更低版本保留命令式 display() 回退路径（仅当未来下调 minAppVersion 时才会生效）。
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
  // 返回搜索可索引、可声明式渲染的设置定义。display() 在该版本下不再被调用，
  // 故此处需用原生控件完整覆盖 display() 中的全部设置项，并保证交互等价。

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

  // 声明式定义：完整对应 display() 的内容。
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
      // 待对应功能开发完成后再放开（与 display() 回退路径保持一致）。
    ];
  }

  // ───────────────────────── 命令式回退（< 1.13.0） ─────────────────────────
  // display() 是设置页的"绘制"方法，Obsidian 每次打开/重绘设置页都会调用它。
  // 注意：必须先 empty() 清掉旧内容，再重新渲染，否则重复打开会叠加。
  // ≥ 1.13.0 下本方法不会被调用（由 getSettingDefinitions() 接管）。
  display(): void {
    this.renderContent();
  }

  // 渲染主体（从 display() 抽离）。语言切换等需要重绘时直接调用本方法，
  // 避免再次调用被弃用的 display() 符号。
  private renderContent(): void {
    const { containerEl } = this;
    containerEl.empty();
    // 页面大标题（文案来自多语言 i18n 的 t()）。
    new Setting(containerEl).setName(t('pluginName')).setHeading();

    // 配置是异步读取的（来自磁盘上的 JSON），拿到后再分段渲染各区块。
    this.dataManager.getConfig().then((config) => {
      this.renderDataPathSection(containerEl);
      this.renderManagersSection(containerEl, config);
      this.renderMaintenanceSection(containerEl);
      this.renderGeneralSection(containerEl);
      // 联动开关区块（Dataview / Daily Notes / Templater）暂时隐藏，
      // 待第三方联动功能开发完成后再放开。保留 renderIntegrationSection 以便后续恢复。
      // this.renderIntegrationSection(containerEl);
    }).catch(() => {});
  }

  // 区块一：数据文件路径。包含"CSV 目录"和"配置 JSON 目录"两项，
  // 既支持手动输入，也支持点"浏览"按钮用 VaultFolderSuggestModal 选文件夹。
  private renderDataPathSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv();
    new Setting(section).setName(t('settings.dataPath')).setHeading();

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
      new VaultPathSuggest(this.app, text.inputEl, (value: string) => {
        void (async () => {
          this.dataManager.getSettings().csvDirectory = value;
          await this.dataManager.saveSettings();
        })();
      });

      // 用户每次改文字都即时保存（onChange）。
      text.onChange((value) => {
        void (async () => {
          this.dataManager.getSettings().csvDirectory = value;
          await this.dataManager.saveSettings();
        })();
      });
    });
    // addButton() 在该设置项右侧加一个按钮；这里点"浏览"打开文件夹选择弹窗。
    csvSetting.addButton((btn) =>
      btn.setButtonText(t('settings.browse')).onClick(() => {
        new VaultFolderSuggestModal(this.app, (value) => {
          void (async () => {
            csvInput?.setValue(value);
            this.dataManager.getSettings().csvDirectory = value;
            await this.dataManager.saveSettings();
          })();
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

      new VaultPathSuggest(this.app, text.inputEl, (value: string) => {
        void (async () => {
          this.dataManager.getSettings().configDirectory = value;
          await this.dataManager.saveSettings();
        })();
      });

      text.onChange((value) => {
        void (async () => {
          this.dataManager.getSettings().configDirectory = value;
          await this.dataManager.saveSettings();
        })();
      });
    });
    configSetting.addButton((btn) =>
      btn.setButtonText(t('settings.browse')).onClick(() => {
        new VaultFolderSuggestModal(this.app, (value) => {
          void (async () => {
            configInput?.setValue(value);
            this.dataManager.getSettings().configDirectory = value;
            await this.dataManager.saveSettings();
          })();
        }).open();
      })
    );
  }

  // 区块二：训练设置。把五个「打开管理」入口平铺成一个列表（不再按分类各自加标题），
  // 每行左侧有拖拽手柄，可用鼠标拖动改变显示顺序；新顺序存入 settings.managerOrder。
  // 说明：排序仅影响设置页里这些条目的显示顺序，不改变任何功能逻辑。
  private renderManagersSection(containerEl: HTMLElement, config: WorkoutConfig): void {
    const section = containerEl.createDiv();
    new Setting(section).setName(t('settings.trainingSettings')).setHeading();

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
    const listEl = section.createDiv({ cls: 'workout-manager-list' });

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
          btn.setIcon('arrow-up').setTooltip(t('settings.moveUp')).onClick(() => { void move(-1); });
          btn.buttonEl.addClass('workout-manager-move');
        })
        .addButton((btn) => {
          btn.setIcon('arrow-down').setTooltip(t('settings.moveDown')).onClick(() => { void move(1); });
          btn.buttonEl.addClass('workout-manager-move');
        });

      // 桌面端：拖拽手柄 + 拖拽事件；移动端不使用拖拽。
      if (!isMobile) {
        const handle = row.createDiv({
          cls: 'workout-manager-handle',
          attr: { 'aria-label': t('settings.dragToReorder'), title: t('settings.dragToReorder') },
        });
        // 六个点的拖拽图标（内联 SVG，随主题 currentColor 着色）。
        // 用 createElementNS 构建，避免直接写 innerHTML（obsidianmd 规则禁止）。
        const svgNS = 'http://www.w3.org/2000/svg';
        const dragSvg = document.createElementNS(svgNS, 'svg');
        dragSvg.setAttribute('viewBox', '0 0 12 16');
        dragSvg.setAttribute('width', '12');
        dragSvg.setAttribute('height', '16');
        dragSvg.setAttribute('fill', 'currentColor');
        for (const [cx, cy] of [[3, 3], [9, 3], [3, 8], [9, 8], [3, 13], [9, 13]]) {
          const dot = document.createElementNS(svgNS, 'circle');
          dot.setAttribute('cx', String(cx));
          dot.setAttribute('cy', String(cy));
          dot.setAttribute('r', '1.5');
          dragSvg.appendChild(dot);
        }
        handle.appendChild(dragSvg);
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
        row.addEventListener('drop', (e: DragEvent) => {
          void (async () => {
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
          })();
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
    const section = containerEl.createDiv();
    new Setting(section).setName(t('settings.maintenance')).setHeading();

    new Setting(section)
      .setName(t('settings.compactCsv'))
      .setDesc(t('settings.compactCsvDesc'))
      .addButton((btn) =>
        btn
          .setButtonText(t('settings.compactCsv'))
          .setClass('mod-destructive')
          .onClick(async () => {
            await this.compactCsv();
          })
      );
  }

  // 压缩清理 CSV 的共享逻辑：确认 -> 压缩 -> 提示。命令式按钮与声明式 action 复用。
  private async compactCsv(): Promise<void> {
    if (!(await confirmWithModal(this.app, t('settings.confirmCompact')))) return;
    const removed = await this.dataManager.compactLogs();
    new Notice(t('settings.compactDone', { n: String(removed) }));
  }

  // 区块六：通用设置。提醒阈值、重量单位、语言、上次值记忆。
  private renderGeneralSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv();
    new Setting(section).setName(t('settings.general')).setHeading();

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
            // 重绘本页以刷新全部文案（不直接调用被弃用的 display()）。
            this.renderContent();
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
    const section = containerEl.createDiv();
    new Setting(section).setName(t('settings.integrations')).setHeading();

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
