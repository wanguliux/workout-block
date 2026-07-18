import { Modal, Notice } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { applyMappingTier, MappingTier } from '../data/muscleMapping';
import { getExerciseName, getMuscleName } from '../data/display';
import { Muscle } from '../data/types';
import { t } from '../i18n';
import { MuscleEditModal } from './MuscleEditModal';
import { confirmWithModal } from './Confirm';

/* MuscleManagerModal —— "肌肉"列表管理弹窗。
 * 首次打开时显示引导卡，让用户选择默认/精简/手动三档导入映射。
 * 之后列出所有肌肉，支持编辑、删除、重新套用预设。 */

export class MuscleManagerModal extends Modal {
  private dataManager: DataManager;
  private musclesContainer!: HTMLDivElement;
  private muscles: Muscle[] = [];
  private searchQuery = '';
  private searchWrap!: HTMLDivElement;

  constructor(dataManager: DataManager) {
    super(dataManager.app);
    this.dataManager = dataManager;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('workout-manager-modal');

    const config = await this.dataManager.getConfig();
    this.muscles = config.muscles;

    contentEl.createEl('h2', { text: t('modal.muscleManager.title') });

    // 顶部搜索框（吸顶）。首次引导阶段先隐藏，进入列表后再显示。
    this.searchWrap = contentEl.createDiv();
    this.searchWrap.addClass('workout-manager-search');
    this.searchWrap.setCssStyles({ display: 'none' });
    const search = this.searchWrap.createEl('input', { type: 'text', cls: 'workout-input' });
    search.placeholder = t('modal.muscleManager.search');
    search.addEventListener('input', () => {
      this.searchQuery = search.value.trim().toLowerCase();
      this.renderMuscles();
    });

    this.musclesContainer = contentEl.createDiv();
    this.musclesContainer.addClass('workout-muscles-list');

    if (!this.dataManager.getSettings().muscleMappingInitialized) {
      this.renderOnboarding();
    } else {
      this.renderMuscles();
    }
  }

  // 首次引导：三档选择
  private renderOnboarding(): void {
    this.searchWrap.setCssStyles({ display: 'none' });
    this.musclesContainer.empty();

    const card = this.musclesContainer.createDiv();
    card.addClass('workout-heatmap-empty');
    card.createEl('p', { text: t('modal.muscleManager.onboardingTitle') });
    card.createEl('p', {
      text: t('modal.muscleManager.onboardingDesc'),
      cls: 'workout-manager-detail',
    });

    const tiers: { tier: MappingTier; labelKey: string; descKey: string }[] = [
      { tier: 'default', labelKey: 'modal.muscleManager.tierDefault', descKey: 'modal.muscleManager.tierDefaultDesc' },
      { tier: 'minimal', labelKey: 'modal.muscleManager.tierMinimal', descKey: 'modal.muscleManager.tierMinimalDesc' },
      { tier: 'manual', labelKey: 'modal.muscleManager.tierManual', descKey: 'modal.muscleManager.tierManualDesc' },
    ];

    for (const { tier, labelKey, descKey } of tiers) {
      const row = card.createDiv();
      row.addClass('workout-row');
      const btn = row.createEl('button', { text: t(labelKey) });
      btn.addClass('mod-cta');
      btn.setCssStyles({ marginRight: '8px' });
      btn.addEventListener('click', () => { void this.applyTier(tier); });
      row.createSpan({ text: t(descKey), cls: 'workout-manager-detail' });
    }
  }

  private async applyTier(tier: MappingTier): Promise<void> {
    const config = await this.dataManager.getConfig();
    applyMappingTier(config, tier);
    await this.dataManager.saveConfig(config);
    this.dataManager.getSettings().muscleMappingInitialized = true;
    await this.dataManager.saveSettings();
    this.muscles = config.muscles;
    new Notice(t('modal.muscleManager.mappingApplied'));
    this.renderMuscles();
  }

  private renderMuscles(): void {
    this.searchWrap.setCssStyles({ display: '' });
    this.musclesContainer.empty();

    const toolbar = this.musclesContainer.createDiv();
    toolbar.addClass('workout-btn-row');
    toolbar.setCssStyles({ justifyContent: 'flex-start' });

    const addBtn = toolbar.createEl('button', { text: t('modal.muscleManager.add') });
    addBtn.addClass('mod-cta');
    addBtn.addEventListener('click', () => this.openAddMuscle());

    const reinitBtn = toolbar.createEl('button', { text: t('modal.muscleManager.reapplyPreset') });
    reinitBtn.addClass('mod-muted');
    reinitBtn.addEventListener('click', () => this.renderOnboarding());

    const list = this.musclesContainer.createDiv();
    list.addClass('workout-muscles-list');

    // 按搜索词过滤（名称或 ID）；空列表与无匹配分别给出提示。
    const q = this.searchQuery;
    const visible = this.muscles.filter((muscle) => {
      if (!q) return true;
      const name = (getMuscleName(muscle) || muscle.id).toLowerCase();
      return name.includes(q) || muscle.id.toLowerCase().includes(q);
    });

    if (this.muscles.length === 0) {
      list.createEl('p', { text: t('settings.noMuscles') });
      return;
    }
    if (visible.length === 0) {
      list.createEl('p', { text: t('common.noMatch') });
      return;
    }

    for (const muscle of visible) {
      const muscleName = getMuscleName(muscle) || muscle.id;
      const mappedCount = muscle.svgRegionIds?.length ?? 0;

      const row = list.createDiv();
      row.addClass('workout-card');

      const infoCol = row.createDiv();
      infoCol.addClass('workout-card-info');
      infoCol.createDiv({ text: muscleName, cls: 'workout-card-title' });

      // 注：side（部位）由 svgRegionIds 经目录派生，不再单列（§13）
      const detailLines = [
        `${t('common.name')}: ${muscle.id}`,
        `${t('modal.muscleManager.coverage')}: ${muscle.contributesToCoverage ? t('settings.on') : t('settings.off')}`,
        `${t('modal.muscleManager.restThreshold')}: ${muscle.restThresholdDays ?? 7} ${t('settings.days')}`,
        `${t('modal.muscleManager.mappedPaths')}: ${mappedCount}`,
      ];

      for (const detail of detailLines) {
        const detailEl = infoCol.createDiv({ text: detail, cls: 'workout-card-meta' });
        detailEl.title = detail;
      }

      const btnCol = row.createDiv();
      btnCol.addClass('workout-card-actions');

      const editBtn = btnCol.createEl('button', { text: t('modal.muscleManager.edit') });
      editBtn.addClass('workout-action-btn');
      editBtn.addEventListener('click', () => {
        const editModal = new MuscleEditModal(this.dataManager, { muscle });
        editModal.onClose = () => { void this.refresh(); };
        editModal.open();
      });

      const deleteBtn = btnCol.createEl('button', { text: t('modal.muscleManager.delete') });
      deleteBtn.addClass('workout-danger-btn');
      deleteBtn.addEventListener('click', () => { void this.deleteMuscle(muscle); });
    }

    // 底部工具栏：关闭（长列表时无需滚到顶部即可关闭；顶部已有「新增肌肉」按钮）。
    const bottom = this.musclesContainer.createDiv();
    bottom.addClass('workout-btn-row');
    const closeBtn = bottom.createEl('button', { text: t('common.close') });
    closeBtn.addClass('mod-muted');
    closeBtn.addEventListener('click', () => this.close());
  }

  private openAddMuscle(): void {
    const editModal = new MuscleEditModal(this.dataManager);
    editModal.onClose = () => { void this.refresh(); };
    editModal.open();
  }

  private async deleteMuscle(muscle: Muscle): Promise<void> {
    const muscleName = getMuscleName(muscle) || muscle.id;

    const config = await this.dataManager.getConfig();
    const referencedExercises = config.exercises.filter((exercise) =>
      exercise.muscles?.some((entry) => entry.muscleId === muscle.id)
    );

    if (referencedExercises.length > 0) {
      const names = referencedExercises.map((exercise) => getExerciseName(exercise) || exercise.id).join(', ');
      if (!(await confirmWithModal(this.app, `${t('settings.muscleReferencedBy')}: ${names}\n${t('settings.confirmDelete')}?`))) {
        return;
      }
    } else if (!(await confirmWithModal(this.app, `${t('settings.confirmDelete')}: ${muscleName}?`))) {
      return;
    }

    await this.dataManager.deleteMuscle(muscle.id);
    new Notice(`${muscleName} ${t('modal.muscleManager.deleted')}`);
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const config = await this.dataManager.getConfig();
    this.muscles = config.muscles;
    this.renderMuscles();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
