import { Modal, Notice } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { getTrainingTypeName } from '../data/display';
import { StatDef, StatGranularity, WorkoutConfig } from '../data/types';
import { t } from '../i18n';
import { StatModal } from './StatModal';
import { confirmWithModal } from './Confirm';

/* StatManagerModal —— "数据统计"列表管理弹窗（镜像 TypeManagerModal）。
 * 列出所有统计条目，每条显示：名称 / 关联训练类型 / 时间粒度 / 启用开关，
 * 并提供"编辑 / 删除"按钮。点编辑打开 StatModal 编辑单个统计；删除前二次确认。 */

export class StatManagerModal extends Modal {
  private dataManager: DataManager;
  private config!: WorkoutConfig;
  private statsContainer!: HTMLDivElement;
  private stats: StatDef[] = [];
  // 搜索关键字（已转小写），用于实时过滤列表。
  private searchQuery = '';

  constructor(dataManager: DataManager) {
    super(dataManager.app);
    this.dataManager = dataManager;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('workout-manager-modal');

    this.config = await this.dataManager.getConfig();
    this.stats = this.config.statistics;

    contentEl.createEl('h2', { text: t('modal.statManager.title') });

    // 顶部搜索框（吸顶）：按名称 / 关联类型 / ID 实时过滤。
    const searchWrap = contentEl.createDiv();
    searchWrap.addClass('workout-manager-search');
    const search = searchWrap.createEl('input', { type: 'text', cls: 'workout-input' });
    search.placeholder = t('modal.statManager.search');
    search.addEventListener('input', () => {
      this.searchQuery = search.value.trim().toLowerCase();
      this.renderStats();
    });

    // 顶部工具栏：新增统计。
    const topToolbar = contentEl.createDiv();
    topToolbar.addClass('workout-btn-row');
    topToolbar.style.justifyContent = 'flex-start';
    const addTop = topToolbar.createEl('button', { text: t('modal.statManager.add') });
    addTop.addClass('mod-cta');
    addTop.addEventListener('click', () => this.openAddStat());

    this.statsContainer = contentEl.createDiv();
    this.statsContainer.addClass('workout-muscles-list');

    this.renderStats();

    const btnRow = contentEl.createDiv();
    btnRow.addClass('workout-btn-row');

    const closeBtn = btnRow.createEl('button', { text: t('common.close') });
    closeBtn.addClass('mod-muted');
    closeBtn.addEventListener('click', () => this.close());
  }

  private granularityLabel(g: StatGranularity): string {
    return g === 'daily' ? t('modal.statManager.daily')
      : g === 'weekly' ? t('modal.statManager.weekly')
      : t('modal.statManager.monthly');
  }

  private renderStats(): void {
    this.statsContainer.empty();

    if (this.stats.length === 0) {
      this.statsContainer.createEl('p', { text: t('settings.noStatistics') });
      return;
    }

    // 按搜索词过滤（名称 / 关联类型 / ID）；空列表与无匹配分别给出提示。
    const q = this.searchQuery;
    const visible = this.stats.filter((stat) => {
      if (!q) return true;
      if (stat.name.toLowerCase().includes(q) || stat.id.toLowerCase().includes(q)) return true;
      const typeNames = stat.associatedTypes
        .map((id) => {
          const type = this.config.trainingTypes.find((ty) => ty.id === id);
          return type ? (getTrainingTypeName(type) || type.id) : id;
        })
        .join(' ');
      return typeNames.toLowerCase().includes(q);
    });

    if (visible.length === 0) {
      this.statsContainer.createEl('p', { text: t('common.noMatch') });
      return;
    }

    for (const stat of visible) {
      const row = this.statsContainer.createDiv();
      row.addClass('workout-card');

      const infoCol = row.createDiv();
      infoCol.addClass('workout-card-info');
      infoCol.createEl('div', { text: stat.name, cls: 'workout-card-title' });

      const btnCol = row.createDiv();
      btnCol.addClass('workout-card-actions');

      const typeNames = stat.associatedTypes
        .map((id) => {
          const type = this.config.trainingTypes.find((ty) => ty.id === id);
          return type ? (getTrainingTypeName(type) || type.id) : id;
        })
        .join(', ');
      const detailLines = [
        `${t('modal.statManager.types')}: ${typeNames || t('modal.statManager.none')}`,
        `${t('modal.statManager.granularity')}: ${this.granularityLabel(stat.granularity)}`,
      ];
      for (const detail of detailLines) {
        infoCol.createEl('div', { text: detail, cls: 'workout-card-meta' });
      }

      // 启用开关（列表内直接切换）—— 设计稿为普通勾选框，不使用 workout-switch 布尔滑块
      const toggleWrap = btnCol.createEl('label');
      toggleWrap.addClass('workout-inline-check');
      const toggle = toggleWrap.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
      toggle.checked = stat.enabled;
      toggle.addEventListener('change', async () => {
        stat.enabled = toggle.checked;
        await this.saveStats();
      });
      toggleWrap.appendText(t('modal.statManager.enabled'));

      const editBtn = btnCol.createEl('button', { text: t('modal.statManager.edit') });
      editBtn.addClass('workout-action-btn');
      editBtn.addEventListener('click', () => {
        const editModal = new StatModal(this.dataManager, { editStat: stat });
        editModal.onClose = () => this.refresh();
        editModal.open();
      });

      const deleteBtn = btnCol.createEl('button', { text: t('modal.statManager.delete') });
      deleteBtn.addClass('workout-danger-btn');
      deleteBtn.addEventListener('click', () => this.deleteStat(stat));
    }
  }

  // 打开"新增统计"弹窗，关闭后刷新列表。
  private openAddStat(): void {
    const editModal = new StatModal(this.dataManager);
    editModal.onClose = () => this.refresh();
    editModal.open();
  }

  private async saveStats(): Promise<void> {
    const config = await this.dataManager.getConfig();
    config.statistics = this.stats;
    await this.dataManager.saveConfig(config);
  }

  private async deleteStat(stat: StatDef): Promise<void> {
    if (!(await confirmWithModal(this.app, `${t('settings.confirmDelete')}：${stat.name}?`))) return;
    this.stats = this.stats.filter((s) => s.id !== stat.id);
    await this.saveStats();
    new Notice(`${stat.name} ${t('common.delete')}`);
    this.refresh();
  }

  private async refresh(): Promise<void> {
    this.config = await this.dataManager.getConfig();
    this.stats = this.config.statistics;
    this.renderStats();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
