import { Modal, Notice } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { getExerciseName, getFieldLabel, getTrainingTypeName } from '../data/display';
import { TrainingType } from '../data/types';
import { t } from '../i18n';
import { TypeModal } from './TypeModal';
import { confirmWithModal } from './Confirm';

/* TypeManagerModal —— "训练类型"列表管理弹窗。
 * 继承 Obsidian 的 Modal（居中浮层弹窗）。打开后列出所有训练类型，每条带字段说明、
 * 是否计入覆盖，以及"编辑/删除"按钮。点编辑会打开 TypeModal 编辑单个类型，
 * 删除前会检查该类型是否被训练项引用，避免误删导致数据错乱。 */

export class TypeManagerModal extends Modal {
  private dataManager: DataManager;
  // 装类型列表的容器，重绘时只清空它而不动标题/按钮。
  private typesContainer!: HTMLDivElement;
  // 当前内存中的类型列表（来自配置）。
  private types: TrainingType[] = [];
  // 搜索关键字（已转小写），用于实时过滤列表。
  private searchQuery = '';

  constructor(dataManager: DataManager) {
    super(dataManager.app);
    this.dataManager = dataManager;
  }

  // 弹窗打开时：读配置、搭标题与列表容器、渲染列表、底部加"新增/关闭"按钮。
  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('workout-manager-modal');

    const config = await this.dataManager.getConfig();
    this.types = config.trainingTypes;

    contentEl.createEl('h2', { text: t('modal.typeManager.title') });

    // 顶部搜索框（吸顶）：按名称 / ID 实时过滤。
    const searchWrap = contentEl.createDiv();
    searchWrap.addClass('workout-manager-search');
    const search = searchWrap.createEl('input', { type: 'text', cls: 'workout-input' });
    search.placeholder = t('modal.typeManager.search');
    search.addEventListener('input', () => {
      this.searchQuery = search.value.trim().toLowerCase();
      this.renderTypes();
    });

    // 顶部工具栏：新增训练类型。
    const topToolbar = contentEl.createDiv();
    topToolbar.addClass('workout-btn-row');
    topToolbar.style.justifyContent = 'flex-start';
    const addTop = topToolbar.createEl('button', { text: t('modal.typeManager.add') });
    addTop.addClass('mod-cta');
    addTop.addEventListener('click', () => this.openAddType());

    this.typesContainer = contentEl.createDiv();
    this.typesContainer.addClass('workout-muscles-list');

    this.renderTypes();

    // 底部按钮行：新增类型 / 关闭弹窗。
    const btnRow = contentEl.createDiv();
    btnRow.addClass('workout-btn-row');

    const closeBtn = btnRow.createEl('button', { text: t('common.close') });
    closeBtn.addClass('mod-muted');
    closeBtn.addEventListener('click', () => this.close());
  }

  // 渲染类型列表：无数据显示空提示，否则逐条画出名称、字段、覆盖开关与编辑/删除按钮。
  private renderTypes(): void {
    this.typesContainer.empty();

    if (this.types.length === 0) {
      this.typesContainer.createEl('p', { text: t('settings.noTypes') });
      return;
    }

    // 按搜索词过滤（名称或 ID）；空列表与无匹配分别给出提示。
    const q = this.searchQuery;
    const visible = this.types.filter((type) => {
      if (!q) return true;
      const name = (getTrainingTypeName(type) || type.id).toLowerCase();
      return name.includes(q) || type.id.toLowerCase().includes(q);
    });

    if (visible.length === 0) {
      this.typesContainer.createEl('p', { text: t('common.noMatch') });
      return;
    }

    for (const type of visible) {
      // 显示名优先用多语言名称，回退到 id。
      const typeName = getTrainingTypeName(type) || type.id;
      // 把字段列表拼成逗号分隔的文字；没有字段时显示"无字段"。
      const fieldNames =
        type.fields.length > 0 ? type.fields.map((field) => getFieldLabel(field)).join(', ') : t('settings.noFields');

      const row = this.typesContainer.createDiv();
      row.addClass('workout-card');

      const infoCol = row.createDiv();
      infoCol.addClass('workout-card-info');
      infoCol.createEl('div', { text: typeName, cls: 'workout-card-title' });

      // 每条类型的明细行：字段列表 + 是否计入覆盖（开/关）。
      const detailLines = [
        `${t('modal.typeManager.fields')}: ${fieldNames}`,
        `${t('modal.typeManager.coverage')}: ${type.contributesToCoverage ? t('settings.on') : t('settings.off')}`,
      ];

      for (const detail of detailLines) {
        infoCol.createEl('div', { text: detail, cls: 'workout-card-meta' });
      }

      // 右侧按钮列：编辑 / 删除。
      const btnCol = row.createDiv();
      btnCol.addClass('workout-card-actions');

      const editBtn = btnCol.createEl('button', { text: t('modal.typeManager.edit') });
      editBtn.addClass('workout-action-btn');
      editBtn.addEventListener('click', () => {
        // 传入 editType 表示编辑这个已有类型，关闭后刷新列表。
        const editModal = new TypeModal(this.dataManager, { editType: type });
        editModal.onClose = () => this.refresh();
        editModal.open();
      });

      const deleteBtn = btnCol.createEl('button', { text: t('modal.typeManager.delete') });
      deleteBtn.addClass('workout-danger-btn');
      deleteBtn.addEventListener('click', () => this.deleteType(type));
    }
  }

  // 打开"新增训练类型"弹窗，关闭后刷新列表。
  private openAddType(): void {
    const editModal = new TypeModal(this.dataManager);
    editModal.onClose = () => this.refresh();
    editModal.open();
  }

  // 删除某个训练类型：先检查是否被训练项引用，被引用则二次确认，再执行删除。
  private async deleteType(type: TrainingType): Promise<void> {
    const typeName = getTrainingTypeName(type) || type.id;

    const config = await this.dataManager.getConfig();
    // 找出 category 指向该类型的训练项（即"被引用"的检查）。
    const referencedExercises = config.exercises.filter((exercise) => exercise.category === type.id);

    if (referencedExercises.length > 0) {
      // 被引用：列出引用它的训练项，确认后才允许删（避免训练项失联）。
      const names = referencedExercises.map((exercise) => getExerciseName(exercise) || exercise.id).join(', ');
      if (!(await confirmWithModal(this.app, `${t('settings.typeReferencedBy')}: ${names}\n${t('settings.confirmDelete')}?`))) {
        return;
      }
    } else if (!(await confirmWithModal(this.app, `${t('settings.confirmDeleteType')}: ${typeName}?`))) {
      return;
    }

    await this.dataManager.deleteTrainingType(type.id);
    new Notice(`${typeName} ${t('common.delete')}`);
    this.refresh();
  }

  // 重新读取配置并刷新列表（编辑/删除后调用）。注意 onClose 钩子也会触发它。
  private async refresh(): Promise<void> {
    const config = await this.dataManager.getConfig();
    this.types = config.trainingTypes;
    this.renderTypes();
  }

  // 弹窗关闭时清空内容（Obsidian 规范要求释放 DOM）。
  onClose(): void {
    this.contentEl.empty();
  }
}
