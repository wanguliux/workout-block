import { Modal, Notice } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { Exercise, TrainingPlanInstance, TimeRule, TrainingType } from '../data/types';
import { getExerciseName, getFieldLabel, getFieldUnit, formatTimeRule, getTrainingTypeName } from '../data/display';
import { t } from '../i18n';
import { parseDuration, secondsToParts } from '../util/duration';
import { formatMass, parseMass } from '../util/units';
import { generateId } from '../util/id';
import { findSchemeNotes, extractSchemeExercises, invalidateSchemeCache, SchemeNote } from '../data/planScanner';

/*
 * NewPlanModal.ts —— 「新增训练计划」弹窗（配置形态）
 * 从已有训练方案（含 workout-plan 代码块的笔记）加载训练项，或手动添加，
 * 为每个训练项的每一组预设字段，配置计划时间（具体日期 / 每周 ISO 周几），
 * 保存为一条 TrainingPlanInstance 聚合进 workout-config.json 的 plans 字段。
 * 与「训练计划管理」是独立功能：本弹窗只负责「创建 / 编辑」单个计划。
 */
interface ModalSet {
  id: string;
  fields: Record<string, unknown>;
}
interface ModalItem {
  exerciseId: string;
  category: string;
  enabled: boolean;
  sets: ModalSet[];
}

export class NewPlanModal extends Modal {
  private dataManager: DataManager;
  private editPlan?: TrainingPlanInstance;

  private exercises: Exercise[] = [];
  private trainingTypes: TrainingType[] = [];

  private name = '';
  private nameManuallyEdited = false;
  private timeRule: TimeRule = { type: 'date', date: this.todayStr() };
  private sourceNote?: string;
  private items: ModalItem[] = [];

  private nameInput!: HTMLInputElement;
  private timeTypeSelect!: HTMLSelectElement;
  private timeControlsEl!: HTMLDivElement;
  private schemeSelect!: HTMLSelectElement;
  private selectAllCheckbox!: HTMLInputElement;
  private selectLabel!: HTMLSpanElement;
  private itemsContainer!: HTMLDivElement;

  constructor(dataManager: DataManager, options?: { editPlan?: TrainingPlanInstance }) {
    super(dataManager.app);
    this.dataManager = dataManager;
    this.editPlan = options?.editPlan;
  }

  private todayStr(): string {
    const n = new Date();
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('workout-edit-modal', 'workout-plan-modal');

    const config = await this.dataManager.getConfig();
    this.exercises = config.exercises;
    this.trainingTypes = config.trainingTypes;

    // 编辑模式：用已有计划预填
    if (this.editPlan) {
      this.name = this.editPlan.name;
      this.nameManuallyEdited = true;
      this.timeRule = JSON.parse(JSON.stringify(this.editPlan.timeRule));
      this.sourceNote = this.editPlan.sourceNote;
      this.items = this.editPlan.items.map((it) => ({
        exerciseId: it.exerciseId,
        category: it.category,
        enabled: it.enabled,
        sets: it.sets.map((s) => ({ id: s.id, fields: { ...s.fields } })),
      }));
    }

    contentEl.createEl('h2', { text: this.editPlan ? t('modal.newPlan.editTitle') : t('modal.newPlan.title') });

    // 计划名称（标签上方，对齐重设计稿）
    const nameField = contentEl.createDiv();
    nameField.addClass('workout-field');
    nameField.createEl('label', { text: t('modal.newPlan.name') });
    this.nameInput = nameField.createEl('input', { type: 'text' });
    this.nameInput.addClass('workout-input');
    this.nameInput.placeholder = t('modal.newPlan.namePlaceholder');
    this.nameInput.value = this.name || this.defaultName();
    this.nameInput.addEventListener('input', () => {
      this.name = this.nameInput.value;
      this.nameManuallyEdited = true;
    });

    // 计划时间类型 + 控件（两列网格：左类型下拉，右日期 / 周几）
    const timeTwoCol = contentEl.createDiv();
    timeTwoCol.addClass('workout-two-col');
    const timeField = timeTwoCol.createDiv();
    timeField.addClass('workout-field');
    timeField.createEl('label', { text: t('modal.newPlan.time') });
    this.timeTypeSelect = timeField.createEl('select');
    this.timeTypeSelect.addClass('workout-select');
    this.timeTypeSelect.createEl('option', { value: 'date', text: t('modal.newPlan.timeDate') });
    this.timeTypeSelect.createEl('option', { value: 'weekday', text: t('modal.newPlan.timeWeek') });
    this.timeTypeSelect.value = this.timeRule.type;
    this.timeTypeSelect.addEventListener('change', () => {
      this.timeRule.type = this.timeTypeSelect.value as 'date' | 'weekday';
      this.renderTimeControls();
    });
    this.timeControlsEl = timeTwoCol.createDiv();
    this.timeControlsEl.addClass('workout-plan-time-controls');
    this.renderTimeControls();

    // 选择训练方案（下拉，标签上方）
    const schemeField = contentEl.createDiv();
    schemeField.addClass('workout-field');
    schemeField.createEl('label', { text: t('modal.newPlan.selectPlan') });
    this.schemeSelect = schemeField.createEl('select');
    this.schemeSelect.addClass('workout-select');
    await this.populateSchemeSelect();

    // 全选行
    const selectAllRow = contentEl.createDiv();
    selectAllRow.addClass('workout-row', 'workout-plan-selectall');
    this.selectAllCheckbox = selectAllRow.createEl('input', { type: 'checkbox' });
    this.selectAllCheckbox.addEventListener('change', () => {
      const checked = this.selectAllCheckbox.checked;
      this.items.forEach((it) => (it.enabled = checked));
      this.renderItems();
    });
    this.selectLabel = selectAllRow.createSpan({ text: '' });
    this.selectLabel.addClass('workout-hint');

    // 训练项容器
    this.itemsContainer = contentEl.createDiv();
    this.itemsContainer.addClass('workout-plan-items');

    // 添加项目按钮
    const addRow = contentEl.createDiv();
    addRow.addClass('workout-btn-row', 'workout-plan-toolbar');
    const addBtn = addRow.createEl('button', { text: t('modal.newPlan.addItem') });
    addBtn.addClass('mod-cta');
    addBtn.addEventListener('click', () => this.addItem());

    // 底部按钮
    const btnRow = contentEl.createDiv();
    btnRow.addClass('workout-btn-row');
    const cancelBtn = btnRow.createEl('button', { text: t('common.cancel') });
    cancelBtn.addClass('mod-muted');
    cancelBtn.addEventListener('click', () => this.close());
    const saveBtn = btnRow.createEl('button', { text: t('common.save') });
    saveBtn.addClass('mod-cta');
    saveBtn.addEventListener('click', () => { void this.save(); });

    this.renderItems();
  }

  private defaultName(): string {
    if (this.sourceNote) return `${this.sourceNote} ${this.todayStr()}`;
    return `${t('modal.newPlan.defaultPrefix')} ${this.todayStr()}`;
  }

  private async populateSchemeSelect(): Promise<void> {
    this.schemeSelect.empty();
    this.schemeSelect.createEl('option', { value: '', text: t('modal.newPlan.noScheme') });
    let notes: SchemeNote[] = [];
    try {
      notes = await findSchemeNotes(this.app);
    } catch {
      notes = [];
    }
    for (const note of notes) {
      this.schemeSelect.createEl('option', { value: note.path, text: note.name });
    }
    if (this.sourceNote) {
      const match = notes.find((n) => n.name === this.sourceNote);
      if (match) this.schemeSelect.value = match.path;
    }
    this.schemeSelect.addEventListener('change', () => { void this.onSchemeChange(); });
  }

  private async onSchemeChange(): Promise<void> {
    const path = this.schemeSelect.value;
    if (!path) {
      this.sourceNote = undefined;
      return;
    }
    const config = await this.dataManager.getConfig();
    const extracted = await extractSchemeExercises(this.app, path, config);
    this.sourceNote = this.schemeSelect.options[this.schemeSelect.selectedIndex]?.text;
    // 合并：保留已有项（含其字段/组），仅追加方案里尚未存在的动作，避免误选方案清空用户配置
    const existingIds = new Set(this.items.map((it) => it.exerciseId));
    for (const e of extracted) {
      if (existingIds.has(e.exerciseId)) continue; // 已存在则保留原配置，不覆盖
      this.items.push({
        exerciseId: e.exerciseId,
        category: e.category,
        enabled: true,
        sets: [{ id: generateId(), fields: {} }],
      });
      existingIds.add(e.exerciseId);
    }
    if (!this.nameManuallyEdited) {
      this.name = this.defaultName();
      this.nameInput.value = this.name;
    }
    this.renderItems();
  }

  private renderTimeControls(): void {
    this.timeControlsEl.empty();
    if (this.timeRule.type === 'date') {
      const dateField = this.timeControlsEl.createDiv();
      dateField.addClass('workout-field');
      dateField.createEl('label', { text: t('modal.newPlan.date') });
      const input = dateField.createEl('input', { type: 'date' });
      input.addClass('workout-input');
      input.value = this.timeRule.date || this.todayStr();
      input.addEventListener('change', () => {
        this.timeRule.date = input.value;
      });
    } else {
      if (!this.timeRule.weekdays) this.timeRule.weekdays = [];
      const labels = ['一', '二', '三', '四', '五', '六', '日']; // ISO 周一=1 … 周日=7
      const chips = this.timeControlsEl.createDiv();
      chips.addClass('workout-plan-weekdays');
      labels.forEach((lab, i) => {
        const iso = i + 1;
        const chip = chips.createEl('button', { text: lab });
        chip.addClass('workout-plan-weekday');
        if (this.timeRule.weekdays!.includes(iso)) chip.addClass('is-active');
        chip.addEventListener('click', () => {
          const arr = this.timeRule.weekdays!;
          const idx = arr.indexOf(iso);
          if (idx >= 0) arr.splice(idx, 1);
          else arr.push(iso);
          this.renderTimeControls();
        });
      });
      const hint = this.timeControlsEl.createDiv({ text: formatTimeRule(this.timeRule) });
      hint.addClass('workout-hint');
    }
  }

  private addItem(exerciseId?: string): void {
    const ex = exerciseId ? this.exercises.find((e) => e.id === exerciseId) : this.exercises[0];
    if (!ex) {
      new Notice(t('modal.newPlan.noExercise'));
      return;
    }
    this.items.push({
      exerciseId: ex.id,
      category: ex.category,
      enabled: true,
      sets: [{ id: generateId(), fields: {} }],
    });
    this.renderItems();
  }

  private renderItems(): void {
    this.itemsContainer.empty();
    this.items.forEach((item, idx) => this.renderItemCard(item, idx));
    this.updateSelectionLabel();
  }

  private renderItemCard(item: ModalItem, index: number): void {
    const card = this.itemsContainer.createDiv();
    card.addClass('workout-plan-card');

    const header = card.createDiv();
    header.addClass('workout-plan-card-header');

    const enabled = header.createEl('input', { type: 'checkbox' });
    enabled.checked = item.enabled;
    enabled.addEventListener('change', () => {
      item.enabled = enabled.checked;
      this.updateSelectionLabel();
    });

    const exerciseSelect = header.createEl('select');
    exerciseSelect.addClass('workout-select');
    for (const ex of this.exercises) {
      const type = this.trainingTypes.find((tt) => tt.id === ex.category);
      exerciseSelect.createEl('option', {
        value: ex.id,
        text: `${getExerciseName(ex)} (${getTrainingTypeName(type) || ex.category})`,
      });
    }
    exerciseSelect.value = item.exerciseId;
    exerciseSelect.addEventListener('change', () => {
      const ex = this.exercises.find((e) => e.id === exerciseSelect.value);
      if (ex) {
        item.exerciseId = ex.id;
        item.category = ex.category;
      }
    });

    const removeBtn = header.createEl('button', { text: t('modal.newPlan.removeItem') });
    removeBtn.addClass('mod-warning', 'workout-plan-remove-btn');
    removeBtn.addEventListener('click', () => {
      this.items.splice(index, 1);
      this.renderItems();
    });

    const setsContainer = card.createDiv();
    setsContainer.addClass('workout-plan-set-list');
    item.sets.forEach((set, sidx) => this.renderSetRow(item, set, sidx, setsContainer));

    const addSetBtn = card.createEl('button', { text: t('modal.newPlan.addSet') });
    addSetBtn.addClass('workout-btn-outline', 'workout-plan-addset');
    addSetBtn.addEventListener('click', () => {
      item.sets.push({ id: generateId(), fields: {} });
      this.renderItems();
    });
  }

  private renderSetRow(item: ModalItem, set: ModalSet, sidx: number, container: HTMLDivElement): void {
    const row = container.createDiv();
    row.addClass('workout-plan-set-grid');

    const no = row.createDiv();
    no.addClass('workout-plan-set-no');
    no.setText(t('modal.newPlan.setName', { n: String(sidx + 1) }));

    const fieldsBox = row.createDiv();
    fieldsBox.addClass('workout-plan-set-fields');
    this.appendSetFields(item.category, set, fieldsBox);

    const delBtn = row.createEl('button', { text: '✕' });
    delBtn.addClass('mod-warning', 'workout-plan-set-del');
    delBtn.addEventListener('click', () => {
      item.sets.splice(sidx, 1);
      if (item.sets.length === 0) item.sets.push({ id: generateId(), fields: {} });
      this.renderItems();
    });
  }

  private appendSetFields(category: string, set: ModalSet, container: HTMLDivElement): void {
    const type = this.trainingTypes.find((tt) => tt.id === category);
    if (!type) return;
    const unit = this.dataManager.getSettings().unit;
    for (const field of type.fields) {
      const fieldRow = container.createDiv();
      fieldRow.addClass('workout-plan-set-field');
      const unitText = getFieldUnit(field, unit);
      fieldRow.createEl('label', { text: `${getFieldLabel(field)}${unitText ? ` (${unitText})` : ''}` });
      const value = set.fields[field.key];
      switch (field.inputType) {
        case 'number': {
          const num = fieldRow.createEl('input', { type: 'number' });
          num.addClass('workout-input');
          num.setAttribute('step', 'any');
          num.setAttribute('inputmode', 'decimal');
          if (field.mass) {
            num.value = value != null ? formatMass(Number(value), unit) : '';
            num.addEventListener('change', () => {
              set.fields[field.key] = parseMass(num.value, unit);
            });
          } else {
            num.value = value != null ? String(value) : '';
            num.addEventListener('change', () => {
              set.fields[field.key] = parseFloat(num.value);
            });
          }
          break;
        }
        case 'duration': {
          const dur = fieldRow.createDiv();
          dur.addClass('workout-duration-row');
          const parts = value != null ? secondsToParts(Number(value)) : { hours: 0, minutes: 0, seconds: 0 };
          const h = dur.createEl('input', { type: 'number', placeholder: t('duration.hour') });
          h.addClass('workout-input');
          h.setAttribute('step', 'any');
          h.setAttribute('inputmode', 'numeric');
          h.value = String(parts.hours);
          const mi = dur.createEl('input', { type: 'number', placeholder: t('duration.minute') });
          mi.addClass('workout-input');
          mi.setAttribute('step', 'any');
          mi.setAttribute('inputmode', 'numeric');
          mi.value = String(parts.minutes);
          const s = dur.createEl('input', { type: 'number', placeholder: t('duration.second') });
          s.addClass('workout-input');
          s.setAttribute('step', 'any');
          s.setAttribute('inputmode', 'numeric');
          s.value = String(parts.seconds);
          const upd = () => {
            set.fields[field.key] = parseDuration(
              parseInt(h.value, 10) || 0,
              parseInt(mi.value, 10) || 0,
              parseInt(s.value, 10) || 0
            );
          };
          h.addEventListener('change', upd);
          mi.addEventListener('change', upd);
          s.addEventListener('change', upd);
          break;
        }
        case 'text': {
          const txt = fieldRow.createEl('input', { type: 'text' });
          txt.addClass('workout-input');
          txt.value = value != null ? String(value) : '';
          txt.addEventListener('change', () => {
            set.fields[field.key] = txt.value;
          });
          break;
        }
        case 'select': {
          const sel = fieldRow.createEl('select');
          sel.addClass('workout-select');
          const opts = field.options ?? [];
          if (opts.length === 0) sel.createEl('option', { value: '', text: t('settings.none') });
          else
            for (const o of opts) {
              const opt = sel.createEl('option', { value: o, text: o });
              if (value != null && String(value) === o) opt.selected = true;
            }
          if (value == null && opts.length > 0) set.fields[field.key] = sel.value;
          sel.addEventListener('change', () => {
            set.fields[field.key] = sel.value;
          });
          break;
        }
      }
    }
  }

  private updateSelectionLabel(): void {
    const total = this.items.length;
    const selected = this.items.filter((i) => i.enabled).length;
    this.selectAllCheckbox.checked = total > 0 && selected === total;
    this.selectAllCheckbox.indeterminate = selected > 0 && selected < total;
    this.selectLabel.setText(t('modal.newPlan.selected', { x: String(selected), y: String(total) }));
  }

  private async save(): Promise<void> {
    const name = this.name.trim();
    if (!name) {
      new Notice(t('modal.newPlan.nameRequired'));
      return;
    }
    const taken = await this.dataManager.isPlanNameTaken(name, this.editPlan?.id);
    if (taken) {
      new Notice(t('modal.newPlan.nameDuplicate'));
      return;
    }
    const enabledItems = this.items.filter((i) => i.enabled);
    if (enabledItems.length === 0) {
      new Notice(t('modal.newPlan.atLeastOne'));
      return;
    }
    if (this.timeRule.type === 'weekday' && (!this.timeRule.weekdays || this.timeRule.weekdays.length === 0)) {
      this.timeRule.weekdays = [1];
    }

    const plan: TrainingPlanInstance = {
      id: this.editPlan?.id ?? generateId(),
      name,
      timeRule: { ...this.timeRule },
      sourceNote: this.sourceNote,
      createdAt: this.editPlan?.createdAt ?? this.todayStr(),
      items: enabledItems.map((i) => ({
        exerciseId: i.exerciseId,
        category: i.category,
        enabled: true,
        sets: i.sets.map((s) => ({ id: s.id, fields: { ...s.fields } })),
      })),
    };

    try {
      await this.dataManager.upsertPlan(plan);
      invalidateSchemeCache();
      new Notice(this.editPlan ? t('modal.newPlan.updated') : t('modal.newPlan.saved'));
      this.close();
    } catch {
      new Notice(t('modal.newPlan.saveFailed'));
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
