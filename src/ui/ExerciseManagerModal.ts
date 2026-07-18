import { Modal, Notice } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { getExerciseName, getMuscleName, getTrainingTypeName } from '../data/display';
import { Exercise, Muscle, TrainingType } from '../data/types';
import { t } from '../i18n';
import { ExerciseModal } from './ExerciseModal';
import { confirmWithModal } from './Confirm';

/* ExerciseManagerModal —— "训练项"列表管理弹窗。
 * 继承 Obsidian 的 Modal。打开后列出所有训练项，每条显示所属类型、主练/辅助肌肉，
 * 以及"编辑/删除"按钮。点编辑打开 ExerciseModal，删除前直接确认即可（训练项被其它
 * 训练类型/肌肉引用的情况较少，这里不做引用检查，仅做简单确认）。 */

export class ExerciseManagerModal extends Modal {
  private dataManager: DataManager;
  private exercisesContainer!: HTMLDivElement;
  private exercises: Exercise[] = [];
  // 列表里要把"类型 id / 肌肉 id"翻译成名字，所以需要缓存这两个列表。
  private trainingTypes: TrainingType[] = [];
  private muscles: Muscle[] = [];
  // 搜索关键字（已转小写），用于实时过滤列表。
  private searchQuery = '';

  constructor(dataManager: DataManager) {
    super(dataManager.app);
    this.dataManager = dataManager;
  }

  // 弹窗打开：读配置，缓存类型与肌肉列表，搭标题与容器，渲染列表，加"新增/关闭"按钮。
  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('workout-manager-modal');

    const config = await this.dataManager.getConfig();
    this.exercises = config.exercises;
    this.trainingTypes = config.trainingTypes;
    this.muscles = config.muscles;

    contentEl.createEl('h2', { text: t('modal.exerciseManager.title') });

    // 顶部搜索框（吸顶）：按名称 / ID 实时过滤。
    const searchWrap = contentEl.createDiv();
    searchWrap.addClass('workout-manager-search');
    const search = searchWrap.createEl('input', { type: 'text', cls: 'workout-input' });
    search.placeholder = t('modal.exerciseManager.search');
    search.addEventListener('input', () => {
      this.searchQuery = search.value.trim().toLowerCase();
      this.renderExercises();
    });

    // 顶部工具栏：新增训练项。
    const topToolbar = contentEl.createDiv();
    topToolbar.addClass('workout-btn-row');
    topToolbar.setCssStyles({ justifyContent: 'flex-start' });
    const addTop = topToolbar.createEl('button', { text: t('modal.exerciseManager.add') });
    addTop.addClass('mod-cta');
    addTop.addEventListener('click', () => this.openAddExercise());

    this.exercisesContainer = contentEl.createDiv();
    this.exercisesContainer.addClass('workout-muscles-list');

    this.renderExercises();

    const btnRow = contentEl.createDiv();
    btnRow.addClass('workout-btn-row');

    const closeBtn = btnRow.createEl('button', { text: t('common.close') });
    closeBtn.addClass('mod-muted');
    closeBtn.addEventListener('click', () => this.close());
  }

  // 渲染训练项列表：无数据显示空提示，否则逐条画出名称、类型、主/辅肌肉与编辑/删除按钮。
  private renderExercises(): void {
    this.exercisesContainer.empty();

    if (this.exercises.length === 0) {
      this.exercisesContainer.createEl('p', { text: t('settings.noExercises') });
      return;
    }

    // 按搜索词过滤（名称或 ID）；空列表与无匹配分别给出提示。
    const q = this.searchQuery;
    const visible = this.exercises.filter((exercise) => {
      if (!q) return true;
      const name = ((getExerciseName(exercise) || exercise.name) ?? '').toLowerCase();
      return name.includes(q) || exercise.id.toLowerCase().includes(q);
    });

    if (visible.length === 0) {
      this.exercisesContainer.createEl('p', { text: t('common.noMatch') });
      return;
    }

    for (const exercise of visible) {
      // 用 category 找到类型对象，再翻译成显示名；找不到就回退到原始 category 字符串。
      const type = this.trainingTypes.find((item) => item.id === exercise.category);
      const typeName = getTrainingTypeName(type) || exercise.category;

      // 把训练项关联的肌肉按角色分成"主练/辅助"两组。
      const primaryMuscles = exercise.muscles?.filter((muscle) => muscle.role === 'primary') || [];
      const secondaryMuscles = exercise.muscles?.filter((muscle) => muscle.role === 'secondary') || [];

      // 把肌肉 id 翻译成名字，多个用逗号分隔；没有则用"无"。
      const primaryNames =
        primaryMuscles
          .map((entry) => getMuscleName(this.muscles.find((muscle) => muscle.id === entry.muscleId)) || entry.muscleId)
          .join(', ') || t('settings.none');
      const secondaryNames =
        secondaryMuscles
          .map((entry) => getMuscleName(this.muscles.find((muscle) => muscle.id === entry.muscleId)) || entry.muscleId)
          .join(', ') || t('settings.none');

      const row = this.exercisesContainer.createDiv();
      row.addClass('workout-card');

      const infoCol = row.createDiv();
      infoCol.addClass('workout-card-info');

      const exerciseName = getExerciseName(exercise) || exercise.name;
      infoCol.createDiv({ text: exerciseName, cls: 'workout-card-title' });

      // 明细行：所属类型、主练肌肉、辅助肌肉。
      const detailLines = [
        `${t('modal.exerciseManager.category')}: ${typeName}`,
        `${t('modal.exerciseManager.primaryMuscles')}: ${primaryNames}`,
        `${t('modal.exerciseManager.secondaryMuscles')}: ${secondaryNames}`,
      ];

      for (const detail of detailLines) {
        infoCol.createDiv({ text: detail, cls: 'workout-card-meta' });
      }

      // 右侧按钮列：编辑 / 删除。
      const btnCol = row.createDiv();
      btnCol.addClass('workout-card-actions');

      const editBtn = btnCol.createEl('button', { text: t('modal.exerciseManager.edit') });
      editBtn.addClass('workout-action-btn');
      editBtn.addEventListener('click', () => {
        const editModal = new ExerciseModal(this.dataManager, { editExercise: exercise });
        editModal.onClose = () => { void this.refresh(); };
        editModal.open();
      });

      const deleteBtn = btnCol.createEl('button', { text: t('modal.exerciseManager.delete') });
      deleteBtn.addClass('workout-danger-btn');
      deleteBtn.addEventListener('click', () => { void this.deleteExercise(exercise); });
    }
  }

  // 打开"新增训练项"弹窗，关闭后刷新列表。
  private openAddExercise(): void {
    const editModal = new ExerciseModal(this.dataManager);
    editModal.onClose = () => { void this.refresh(); };
    editModal.open();
  }

  // 删除训练项：先统计其关联的训练记录数，若有则提示「记录也会被一并删除」，确认后执行级联删除，并刷新列表。
  private async deleteExercise(exercise: Exercise): Promise<void> {
    const exerciseName = getExerciseName(exercise) || exercise.name || '';
    // 统计该训练项关联的训练记录数（getLogs 已过滤软删除，计数即真实可见记录）。
    const recordCount = this.dataManager.getLogs().filter((l) => l.exerciseId === exercise.id).length;
    const message =
      recordCount > 0
        ? t('settings.confirmDeleteExerciseRecords', { name: exerciseName, count: String(recordCount) })
        : `${t('settings.confirmDeleteExercise')}: ${exerciseName}?`;
    if (!(await confirmWithModal(this.app, message))) {
      return;
    }

    await this.dataManager.deleteExercise(exercise.id);
    new Notice(`${exerciseName} ${t('common.delete')}`);
    await this.refresh();
  }

  // 重新读取配置并刷新列表（同时刷新缓存的类型/肌肉，保证显示名最新）。
  private async refresh(): Promise<void> {
    const config = await this.dataManager.getConfig();
    this.exercises = config.exercises;
    this.trainingTypes = config.trainingTypes;
    this.muscles = config.muscles;
    this.renderExercises();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
