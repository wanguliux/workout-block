import { Modal, Notice } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { formatTimeRule } from '../data/display';
import { TrainingPlanInstance } from '../data/types';
import { t } from '../i18n';
import { NewPlanModal } from './NewPlanModal';
import { confirmWithModal } from './Confirm';

/* TrainingPlanManagerModal —— "训练计划"列表管理弹窗。
 * 与训练项/类型/肌肉/统计的管理弹窗保持一致：设置页点「打开管理」后弹出，
 * 只有在这个弹窗里才能进行计划的 新增 / 编辑 / 删除。删除仅移除计划定义，
 * 不影响已产生的训练记录（CSV 历史保留）。 */

export class TrainingPlanManagerModal extends Modal {
  private dataManager: DataManager;
  private listContainer!: HTMLDivElement;
  private plans: TrainingPlanInstance[] = [];
  // 搜索关键字（已转小写），用于实时过滤列表。
  private searchQuery = '';

  constructor(dataManager: DataManager) {
    super(dataManager.app);
    this.dataManager = dataManager;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('workout-manager-modal');

    const config = await this.dataManager.getConfig();
    this.plans = config.plans ?? [];

    contentEl.createEl('h2', { text: t('settings.trainingPlans.manage') });

    // 顶部搜索框（吸顶）：按名称 / 来源实时过滤。
    const searchWrap = contentEl.createDiv();
    searchWrap.addClass('workout-manager-search');
    const search = searchWrap.createEl('input', { type: 'text', cls: 'workout-input' });
    search.placeholder = t('settings.trainingPlans.search');
    search.addEventListener('input', () => {
      this.searchQuery = search.value.trim().toLowerCase();
      this.renderList();
    });

    // 顶部工具栏：新增训练计划。
    const topToolbar = contentEl.createDiv();
    topToolbar.addClass('workout-btn-row');
    topToolbar.setCssStyles({ justifyContent: 'flex-start' });
    const addTop = topToolbar.createEl('button', { text: t('settings.trainingPlans.add') });
    addTop.addClass('mod-cta');
    addTop.addEventListener('click', () => this.openAddPlan());

    this.listContainer = contentEl.createDiv();
    this.listContainer.addClass('workout-muscles-list');

    this.renderList();

    const btnRow = contentEl.createDiv();
    btnRow.addClass('workout-btn-row');

    const closeBtn = btnRow.createEl('button', { text: t('common.close') });
    closeBtn.addClass('mod-muted');
    closeBtn.addEventListener('click', () => this.close());
  }

  // 渲染计划列表：无数据显示空提示，否则逐条画出名称、时间规则、训练项数、来源与编辑/删除按钮。
  private renderList(): void {
    this.listContainer.empty();

    if (this.plans.length === 0) {
      this.listContainer.createEl('p', { text: t('settings.trainingPlans.noPlans') });
      return;
    }

    // 按搜索词过滤（名称 / 来源）；空列表与无匹配分别给出提示。
    const q = this.searchQuery;
    const visible = this.plans.filter((plan) => {
      if (!q) return true;
      const name = plan.name.toLowerCase();
      const source = (plan.sourceNote || '').toLowerCase();
      return name.includes(q) || source.includes(q);
    });

    if (visible.length === 0) {
      this.listContainer.createEl('p', { text: t('common.noMatch') });
      return;
    }

    for (const plan of visible) {
      const enabledCount = plan.items.filter((i) => i.enabled).length;
      const row = this.listContainer.createDiv();
      row.addClass('workout-card');

      const infoCol = row.createDiv();
      infoCol.addClass('workout-card-info');

      infoCol.createDiv({ text: plan.name, cls: 'workout-card-title' });

      const detailLines = [
        `${t('settings.trainingPlans.schedule')}: ${formatTimeRule(plan.timeRule)}`,
        `${t('settings.trainingPlans.itemCount')}: ${enabledCount}`,
        `${t('settings.trainingPlans.source')}: ${plan.sourceNote || t('settings.trainingPlans.manual')}`,
      ];
      for (const detail of detailLines) {
        infoCol.createDiv({ text: detail, cls: 'workout-card-meta' });
      }

      const btnCol = row.createDiv();
      btnCol.addClass('workout-card-actions');

      const editBtn = btnCol.createEl('button', { text: t('settings.trainingPlans.edit') });
      editBtn.addClass('workout-action-btn');
      editBtn.addEventListener('click', () => {
        const modal = new NewPlanModal(this.dataManager, { editPlan: plan });
        modal.onClose = () => { void this.refresh(); };
        modal.open();
      });

      const deleteBtn = btnCol.createEl('button', { text: t('settings.trainingPlans.delete') });
      deleteBtn.addClass('workout-danger-btn');
      deleteBtn.addEventListener('click', () => { void this.deletePlan(plan); });
    }
  }

  // 打开"新增训练计划"弹窗，关闭后刷新列表。
  private openAddPlan(): void {
    const modal = new NewPlanModal(this.dataManager);
    modal.onClose = () => { void this.refresh(); };
    modal.open();
  }

  // 删除计划：确认后执行删除并刷新列表（不删 CSV 历史记录）。
  private async deletePlan(plan: TrainingPlanInstance): Promise<void> {
    if (!(await confirmWithModal(this.app, t('settings.trainingPlans.confirmDelete', { name: plan.name })))) {
      return;
    }
    await this.dataManager.deletePlan(plan.name);
    new Notice(`${plan.name} ${t('common.delete')}`);
    await this.refresh();
  }

  // 重新读取配置并刷新列表。
  private async refresh(): Promise<void> {
    const config = await this.dataManager.getConfig();
    this.plans = config.plans ?? [];
    this.renderList();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
