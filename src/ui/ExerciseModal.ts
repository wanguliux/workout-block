import { Modal, Notice } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { getExerciseName, getMuscleName, getTrainingTypeName } from '../data/display';
import { Exercise, TrainingType, Muscle, ExerciseMuscle } from '../data/types';
import { t } from '../i18n';
import { INVALID_ID_RE, isInvalidId } from './idValidation';

/*
 * ExerciseModal.ts —— "新建/编辑训练项"弹窗
 * 训练项（动作）是训练记录的基础：每个训练项有"名称""所属训练类型"
 * 以及"主练/辅助肌肉"。弹窗支持新建和编辑两种模式（传 editExercise 即编辑）。
 * 界面对肌肉采用"分组复选框"：主练一组、辅助一组，保存时按勾选结果
 * 组装成 {muscleId, role} 列表写回配置。
 */
interface ExerciseModalOptions {
  editExercise?: Exercise; // 要编辑的训练项；省略则为新建模式
}

export class ExerciseModal extends Modal {
  private dataManager: DataManager;
  private options: ExerciseModalOptions;
  private nameInput!: HTMLInputElement;
  private idInput!: HTMLInputElement;    // 可编辑的训练项 ID（留空则保存时按名称推导）
  private idHint!: HTMLDivElement;        // ID 非法字符提示（默认隐藏，触发时闪现）
  private idHintTimer: number | null = null; // 提示自动隐藏的计时器
  private categorySelect!: HTMLSelectElement;
  private primaryMusclesContainer!: HTMLDivElement;
  private secondaryMusclesContainer!: HTMLDivElement;
  private trainingTypes: TrainingType[] = [];
  private muscles: Muscle[] = [];

  constructor(dataManager: DataManager, options: ExerciseModalOptions = {}) {
    super(dataManager.app);
    this.dataManager = dataManager;
    this.options = options;
  }

  // onOpen：构建界面。先读配置拿到训练类型与肌肉列表，再渲染各输入控件。
  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('workout-edit-modal');
    const config = await this.dataManager.getConfig();
    this.trainingTypes = config.trainingTypes;
    this.muscles = config.muscles;

    // 标题：编辑模式用"编辑训练项"文案，否则用"新建训练项"
    contentEl.createEl('h2', { text: this.options.editExercise ? t('modal.newExercise.editTitle') : t('modal.newExercise.title') });

    // 名称行：文本输入框，编辑时预填已有名称
    const nameRow = contentEl.createDiv();
    nameRow.addClass('workout-field');
    nameRow.createEl('label', { text: t('modal.newExercise.name') });
    this.nameInput = nameRow.createEl('input', { type: 'text' });
    this.nameInput.addClass('workout-input');
    if (this.options.editExercise) {
      this.nameInput.value = getExerciseName(this.options.editExercise);
    }

    // 训练项 ID 行：可编辑文本框。留空时保存会自动按名称推导；
    // 编辑模式下预填当前 id，用户改了它则会级联更新所有关联记录。
    const idRow = contentEl.createDiv();
    idRow.addClass('workout-field');
    idRow.createEl('label', { text: t('modal.newExercise.id') });
    this.idInput = idRow.createEl('input', { type: 'text', placeholder: t('modal.newExercise.idPlaceholder') });
    this.idInput.addClass('workout-input');
    if (this.options.editExercise) {
      this.idInput.value = this.options.editExercise.id;
    }

    // 轻量实时校验：ID 不能含逗号/引号/换行（会破坏 CSV 单元格与键引用）。
    // beforeinput 阶段直接拦截非法字符（光标不跳），input 阶段再兜底 strip（覆盖粘贴）。
    this.idHint = contentEl.createEl('div', { cls: 'workout-id-hint' });
    this.idInput.addEventListener('beforeinput', (e: Event) => {
      const data = (e as InputEvent).data ?? '';
      if (data && INVALID_ID_RE.test(data)) {
        e.preventDefault();
        this.flashIdHint('modal.newExercise.idInvalid');
      }
    });
    this.idInput.addEventListener('input', () => {
      const v = this.idInput.value;
      if (INVALID_ID_RE.test(v)) {
        this.idInput.value = v.replace(INVALID_ID_RE, '');
        this.flashIdHint('modal.newExercise.idInvalid');
      }
    });

    // 训练类型行：下拉框，编辑时预选中已有类型
    const categoryRow = contentEl.createDiv();
    categoryRow.addClass('workout-field');
    categoryRow.createEl('label', { text: t('modal.newExercise.category') });
    this.categorySelect = categoryRow.createEl('select');
    this.categorySelect.addClass('workout-select');

    for (const type of this.trainingTypes) {
      const typeName = getTrainingTypeName(type) || type.id;
      const option = this.categorySelect.createEl('option', {
        value: type.id,
        text: typeName,
      });
      if (this.options.editExercise?.category === type.id) {
        option.selected = true;
      }
    }

    // 主练肌肉区块：h3 标题 + 复选框容器
    const primaryRow = contentEl.createDiv();
    primaryRow.createEl('h3', { text: t('modal.newExercise.primaryMuscles'), cls: 'workout-section-title' });
    this.primaryMusclesContainer = primaryRow.createDiv();
    this.primaryMusclesContainer.addClass('workout-muscles-container', 'workout-check-grid');

    // 辅助肌肉区块
    const secondaryRow = contentEl.createDiv();
    secondaryRow.createEl('h3', { text: t('modal.newExercise.secondaryMuscles'), cls: 'workout-section-title' });
    this.secondaryMusclesContainer = secondaryRow.createDiv();
    this.secondaryMusclesContainer.addClass('workout-muscles-container', 'workout-check-grid');

    // 渲染两组肌肉复选框（会用编辑模式已勾选项做预选）
    this.renderMuscles();

    // 底部按钮行：取消 + 保存
    const btnRow = contentEl.createDiv();
    btnRow.addClass('workout-btn-row');

    const cancelBtn = btnRow.createEl('button', { text: t('common.cancel') });
    cancelBtn.addClass('mod-muted');
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = btnRow.createEl('button', { text: t('common.save') });
    saveBtn.addClass('mod-cta');
    saveBtn.addEventListener('click', () => this.save());
  }

  // 渲染主练/辅助两组肌肉复选框。编辑模式下根据 editExercise.muscles 的 role 预勾选相应项。
  private renderMuscles(): void {
    this.primaryMusclesContainer.empty();
    this.secondaryMusclesContainer.empty();

    // 从已有训练项里分别取出"主练""辅助"肌肉 id 集合（用于预勾选）
    const selectedPrimary = this.options.editExercise?.muscles
      ?.filter((m) => m.role === 'primary')
      .map((m) => m.muscleId) || [];

    const selectedSecondary = this.options.editExercise?.muscles
      ?.filter((m) => m.role === 'secondary')
      .map((m) => m.muscleId) || [];

    for (const muscle of this.muscles) {
      const muscleName = getMuscleName(muscle) || muscle.id;

      // 主练复选框：每个肌肉一个 label 包裹 checkbox + 文字
      const primaryLabel = this.primaryMusclesContainer.createEl('label');
      primaryLabel.addClass('workout-check-item');
      const primaryCheckbox = primaryLabel.createEl('input', { type: 'checkbox' });
      primaryCheckbox.value = muscle.id; // 用 muscle.id 作为值，保存时取这个
      if (selectedPrimary.includes(muscle.id)) {
        primaryCheckbox.checked = true;
      }
      primaryLabel.createEl('span', { text: muscleName });

      // 辅助复选框：结构同上
      const secondaryLabel = this.secondaryMusclesContainer.createEl('label');
      secondaryLabel.addClass('workout-check-item');
      const secondaryCheckbox = secondaryLabel.createEl('input', { type: 'checkbox' });
      secondaryCheckbox.value = muscle.id;
      if (selectedSecondary.includes(muscle.id)) {
        secondaryCheckbox.checked = true;
      }
      secondaryLabel.createEl('span', { text: muscleName });
    }
  }

  // 保存：先做必填校验（名称、类型），再用 querySelectorAll 收集两组中被勾选的肌肉，
  // 组装成 {muscleId, role} 列表，最后新增或更新训练项，并给出提示。
  // 训练项 ID：输入框留空时按「名称」自动推导；非空时以用户输入为准（空格转下划线）。
  // 编辑模式下若改了 ID，则级联更新数据库里所有关联该 ID 的记录。
  private async save(): Promise<void> {
    const name = this.nameInput.value.trim();
    if (!name) {
      new Notice(t('modal.newExercise.nameRequired'));
      return;
    }

    const category = this.categorySelect.value;
    if (!category) {
      new Notice(t('modal.newExercise.categoryRequired'));
      return;
    }

    // 计算最终 ID：用户输入优先，留空则按名称推导（小写、空格转下划线）。
    // 两路都额外 strip 掉非法字符（逗号/引号/换行），即使从名称推导也保证 CSV 安全。
    const idValue = this.idInput.value.trim();
    const finalId = (idValue || name.toLowerCase())
      .replace(/\s+/g, '_')
      .replace(INVALID_ID_RE, '');

    // 兜底：万一仍含非法字符（理论上已被实时校验拦截），直接拦下保存。
    if (isInvalidId(finalId)) {
      new Notice(t('modal.newExercise.idInvalid'));
      return;
    }

    // 防重复：新建时与全部已有 id 比对；编辑时排除自身旧 id，仅当改成了别人的 id 才拦截。
    const config = await this.dataManager.getConfig();
    const exists = config.exercises.some(
      (e) => e.id === finalId && e.id !== this.options.editExercise?.id
    );
    if (exists) {
      new Notice(t('modal.newExercise.idDuplicate'));
      return;
    }

    // 收集主练、辅助两组中处于勾选状态(checked)的复选框
    const primaryCheckboxes = this.primaryMusclesContainer.querySelectorAll('input[type="checkbox"]:checked');
    const secondaryCheckboxes = this.secondaryMusclesContainer.querySelectorAll('input[type="checkbox"]:checked');

    // 把勾选结果组装成肌肉关系数组
    const muscles: ExerciseMuscle[] = [];
    primaryCheckboxes.forEach((cb) => {
      muscles.push({ muscleId: (cb as HTMLInputElement).value, role: 'primary' });
    });
    secondaryCheckboxes.forEach((cb) => {
      muscles.push({ muscleId: (cb as HTMLInputElement).value, role: 'secondary' });
    });

    try {
      const updates: Partial<Exercise> = {
        name,
        category,
        muscles: muscles.length > 0 ? muscles : undefined,
      };
      if (this.options.editExercise) {
        const oldId = this.options.editExercise.id;
        if (finalId !== oldId) {
          // ID 变了：级联改写配置里的 id + 所有关联记录里的 exerciseId
          await this.dataManager.renameExercise(oldId, finalId, updates);
        } else {
          // ID 没变：普通更新
          await this.dataManager.updateExercise(oldId, updates);
        }
        new Notice(t('modal.newExercise.updated'));
      } else {
        // 新建模式：写入自定义 ID（用户输入或按名称推导）
        await this.dataManager.addExercise({
          id: finalId,
          nameKey: undefined,
          name,
          category,
          muscles: muscles.length > 0 ? muscles : undefined,
        });
        new Notice(t('modal.newExercise.saved'));
      }
      this.close();
    } catch (error) {
      new Notice(t('modal.newExercise.saveFailed'));
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }

  // 闪现一条 ID 非法字符提示：显示文案，2.5s 后自动淡出（轻量、不打断输入）。
  private flashIdHint(msgKey: string): void {
    this.idHint.textContent = t(msgKey);
    this.idHint.addClass('is-visible');
    if (this.idHintTimer !== null) {
      window.clearTimeout(this.idHintTimer);
    }
    this.idHintTimer = window.setTimeout(() => {
      this.idHint.removeClass('is-visible');
      this.idHintTimer = null;
    }, 2500);
  }
}
