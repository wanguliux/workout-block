import { Modal, Notice } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { getExerciseName, getFieldLabel, getTrainingTypeName, resolveExerciseByName } from '../data/display';
import { Exercise, FieldDef, LogRow, TrainingType } from '../data/types';
import { t } from '../i18n';
import { secondsToParts, parseDuration } from '../util/duration';
import { formatMass, parseMass } from '../util/units';

/*
 * RecordModal.ts —— "记录一组"录入弹窗
 * 这是用户最常用、也最复杂的弹窗：选择训练项 → 自动带出训练类型 →
 * 根据该类型的字段定义动态渲染输入控件（数字/时长/文本/下拉）→ 保存写入 CSV。
 * 它支持两种模式：
 *   1) 新增：options 仅传 exercise/plan（或都不传）
 *   2) 编辑：options 传 editLog（一条已有记录），界面会预填值
 * 还支持"记忆上次值"：选了训练项后自动填入该训练项上一次的记录值。
 * 弹窗类必须继承 Obsidian 的 Modal，并实现 onOpen（构建界面）和 onClose（清理）。
 */
interface RecordModalOptions {
  exercise?: string; // 可选：打开时预选的训练项（按 id/名称匹配）
  plan?: string;     // 可选：该记录所属的训练方案名
  editLog?: LogRow;  // 可选：要编辑的已有记录；存在时进入"编辑模式"
}

// 记录里的时间戳格式为 "YYYY-MM-DD HH:mm"，而 datetime-local 输入框值是 "YYYY-MM-DDTHH:mm"，
// 两者仅分隔符不同，下面两个函数做互转。
function toDateTimeLocal(ts: string): string {
  const [date, time] = ts.split(' ');
  return date ? `${date}T${time ?? '00:00'}` : '';
}

// 取当前时间并格式化为 datetime-local 所需的 "YYYY-MM-DDTHH:mm"
function nowDateTimeLocal(): string {
  const n = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}T${pad(n.getHours())}:${pad(n.getMinutes())}`;
}

export class RecordModal extends Modal {
  private dataManager: DataManager;
  private options: RecordModalOptions;
  private exerciseInput!: HTMLInputElement; // 训练项搜索输入框（combobox）
  private exerciseDropdown!: HTMLDivElement;   // 搜索下拉候选列表
  private exerciseId = '';       // 当前选中训练项的 id（必须匹配已有训练项，否则保存拦截）
  private typeDisplay!: HTMLDivElement;       // 显示"当前训练类型"的文本区域
  private fieldsContainer!: HTMLDivElement;   // 动态字段控件的容器
  private noteInput!: HTMLTextAreaElement;    // 备注输入框
  private timeInput!: HTMLInputElement;       // 时间输入框（datetime-local）；创建默认当前、编辑可改
  private planInput!: HTMLSelectElement;       // 训练方案下拉框；创建默认空、编辑可改
  private category = '';         // 当前训练项的类型 id（决定显示哪些字段）
  private fieldValues: Record<string, unknown> = {}; // 各字段当前值，key 为字段 key
  private exercises: Exercise[] = [];
  private trainingTypes: TrainingType[] = [];
  private filteredExercises: Exercise[] = []; // 搜索过滤后的训练项列表
  private dropdownHighlighted = -1;          // 下拉列表高亮索引（键盘导航用）

  // 构造函数：在 new RecordModal(...).open() 之前被调用，仅做字段初始化。
  constructor(dataManager: DataManager, options: RecordModalOptions = {}) {
    super(dataManager.app); // 必须先把 app 传给父类 Modal
    this.dataManager = dataManager;
    this.options = options;
    this.category = '';
  }

  // onOpen：弹窗真正打开、contentEl（弹窗内容容器）可用时调用。所有界面都建在这里。
  async onOpen(): Promise<void> {
    const { contentEl } = this;
    // 给内容容器加 CSS 类，便于 styles.css 针对本弹窗做样式
    contentEl.addClass('workout-edit-modal');

    // 异步读取配置（训练项列表、训练类型列表）
    const config = await this.dataManager.getConfig();
    this.exercises = config.exercises;
    this.trainingTypes = config.trainingTypes;

    // 创建标题：编辑模式用"编辑记录"文案，否则用"记录一组"文案
    contentEl.createEl('h2', { text: this.options.editLog ? t('modal.editRecord.title') : t('modal.recordSet.title') });

    // 训练项 + 训练类型 同行（两列网格）：左为训练项下拉，右为随训练项自动带出的训练类型（只读胶囊）
    const twoCol = contentEl.createDiv();
    twoCol.addClass('workout-two-col');

    // 左列：训练项搜索框（combobox）。可输入文字模糊搜索，空白时显示所有候选项。
    const exerciseField = twoCol.createDiv();
    exerciseField.addClass('workout-field');
    exerciseField.createEl('label', { text: t('modal.recordSet.exercise') });

    // 搜索输入框 + 下拉候选列表的容器（相对定位，让下拉绝对定位在输入框下方）
    const comboWrapper = exerciseField.createDiv();
    comboWrapper.addClass('workout-combo-wrapper');

    this.exerciseInput = comboWrapper.createEl('input', { type: 'text' });
    this.exerciseInput.addClass('workout-input');
    this.exerciseInput.addClass('workout-combo-input');
    this.exerciseInput.placeholder = t('modal.recordSet.searchExercisePlaceholder') || '搜索训练项...';

    // 下拉候选列表（默认隐藏）
    this.exerciseDropdown = comboWrapper.createDiv();
    this.exerciseDropdown.addClass('workout-combo-dropdown');
    this.exerciseDropdown.setCssStyles({ display: 'none' });

    // 初始化过滤后的列表为全部训练项
    this.filteredExercises = [...this.exercises];
    this.renderExerciseDropdown();

    // 右列：训练类型展示（只读胶囊，随所选训练项自动变化）
    const typeField = twoCol.createDiv();
    typeField.addClass('workout-field');
    typeField.createEl('label', { text: t('modal.recordSet.type') });
    this.typeDisplay = typeField.createDiv();
    this.typeDisplay.addClass('workout-type-pill');

    // —— 编辑模式：用已有记录预填各字段的值与上下文 ——
    if (this.options.editLog) {
      this.exerciseId = this.options.editLog.exerciseId || '';
      this.category = this.options.editLog.category;
      this.fieldValues = { ...this.options.editLog.fields }; // 浅拷贝一份，避免直接改动原始记录
      const editEx = this.exercises.find(e => e.id === this.exerciseId);
      if (editEx) {
        this.exerciseInput.value = getExerciseName(editEx);
        this.exerciseInput.disabled = true;
        exerciseField.createSpan({ text: t('modal.recordSet.exerciseLocked'), cls: 'workout-hint' });
      }
    }

    // —— 预选训练项模式：根据 options.exercise 在搜索框里预填名称并选中对应项 ——
    if (this.options.exercise && !this.options.editLog) {
      const config = await this.dataManager.getConfig();
      const matched = resolveExerciseByName(config, this.options.exercise);
      if (matched) {
        this.exerciseInput.value = getExerciseName(matched);
        this.exerciseId = matched.id;
      }
    }

    // 搜索框交互事件：输入时过滤下拉列表、聚焦/失焦控制显示
    this.setupExerciseComboEvents();

    // 设置初始选中值：优先用编辑模式/预选模式的值，否则默认选第一个训练项
    if (!this.options.editLog && !this.options.exercise && this.exercises.length > 0) {
      this.exerciseId = this.exercises[0].id;
      this.exerciseInput.value = getExerciseName(this.exercises[0]);
    }

    // 字段容器：各动态字段的控件会被插入到这里
    this.fieldsContainer = contentEl.createDiv();
    this.fieldsContainer.addClass('workout-fields');

    // 时间 + 训练计划 同行（两列网格，对齐重设计稿）
    const timePlanCol = contentEl.createDiv();
    timePlanCol.addClass('workout-two-col');

    // 时间输入框：创建模式预填当前时间，编辑模式预填记录原时间（datetime-local 用 T 分隔）。
    const timeField = timePlanCol.createDiv();
    timeField.addClass('workout-field');
    timeField.createEl('label', { text: t('modal.recordSet.time') });
    this.timeInput = timeField.createEl('input', { type: 'datetime-local' });
    this.timeInput.addClass('workout-input');
    this.timeInput.value = this.options.editLog
      ? toDateTimeLocal(this.options.editLog.timestamp)
      : nowDateTimeLocal();

    // 训练方案下拉框：可选关联一个训练方案（允许为空）。
    // 从侧边栏打开时可从已有方案中选择；从代码块打开时预填传入的 plan。
    const planField = timePlanCol.createDiv();
    planField.addClass('workout-field');
    planField.createEl('label', { text: t('modal.recordSet.scheme') });
    this.planInput = planField.createEl('select');
    this.planInput.addClass('workout-select');

    // 空选项：不关联任何方案
    this.planInput.createEl('option', {
      value: '',
      text: t('modal.recordSet.noSchemeOption') || '— 不关联方案 —',
    });

    // 填入已有训练计划作为候选项
    const configForPlans = await this.dataManager.getConfig();
    const plans = configForPlans.plans ?? [];
    for (const p of plans) {
      this.planInput.createEl('option', { value: p.name, text: p.name });
    }

    // 预选值：编辑模式取记录原 plan；新增模式优先用传入的 options.plan（如来自代码块）
    const prefillPlan = this.options.editLog?.plan ?? this.options.plan ?? '';
    if (prefillPlan && plans.some(p => p.name === prefillPlan)) {
      this.planInput.value = prefillPlan;
    } else if (prefillPlan) {
      // 传入的 plan 名不在现有计划列表中（可能已被删除或重命名），追加为临时选项
      this.planInput.createEl('option', { value: prefillPlan, text: `${prefillPlan} (${t('modal.recordSet.schemeNotFound') || '未找到'})` });
      this.planInput.value = prefillPlan;
    }

    // 备注输入框：放到所有录入项（训练项/类型/字段/时间/计划）的底部
    const noteField = contentEl.createDiv();
    noteField.addClass('workout-field');
    noteField.createEl('label', { text: t('modal.recordSet.note') });
    this.noteInput = noteField.createEl('textarea', { placeholder: t('modal.recordSet.note') });
    this.noteInput.addClass('workout-textarea');
    if (this.options.editLog?.note) {
      this.noteInput.value = this.options.editLog.note;
    }

    // 底部按钮行：取消 + 保存
    const btnRow = contentEl.createDiv();
    btnRow.addClass('workout-btn-row');

    // 取消按钮：mod-muted 是 Obsidian 的次要按钮样式；点击直接关闭弹窗
    const cancelBtn = btnRow.createEl('button', { text: t('common.cancel') });
    cancelBtn.addClass('mod-muted');
    cancelBtn.addEventListener('click', () => this.close());

    // 保存按钮：mod-cta 是 Obsidian 的主按钮（高亮）样式；点击执行 save()
    const saveBtn = btnRow.createEl('button', { text: t('common.save') });
    saveBtn.addClass('mod-cta');
    saveBtn.addEventListener('click', () => { void this.save(); });

    // 打开时根据初始状态立刻渲染字段：
    //  - 编辑模式：用已有记录预填（前面已设），且不加载「上次值」，避免覆盖正在编辑的值；
    //  - 新增模式：无论是否预选训练项，都统一走 onExerciseChange —— 它会设置 exerciseId/category、
    //    加载该训练项的「上次值」、再渲染字段。这是「记忆上次值」生效的关键路径。
    if (this.options.editLog) {
      this.updateTypeDisplay();
      this.renderFields();
    } else if (this.exercises.length > 0) {
      this.onExerciseChange();
    }
  }

  // 训练项切换时的统一处理：更新上下文、类型显示、上次值、字段控件。
  private onExerciseChange(): void {
    const exercise = this.exercises.find((item) => item.id === this.exerciseId);
    if (exercise) {
      this.exerciseId = exercise.id;
      this.category = exercise.category;
      this.updateTypeDisplay();   // 显示对应训练类型
      this.loadLastValues();      // 记忆上次值：填入该训练项上一次记录
      this.renderFields();        // 按新类型的字段重新生成输入控件
    }
  }

  // ===== 训练项搜索 Combobox 实现 =====

  // 配置搜索框事件：输入过滤、键盘导航、失焦隐藏、点击候选选中
  private setupExerciseComboEvents(): void {
    const input = this.exerciseInput;
    const dropdown = this.exerciseDropdown;

    // 输入时实时过滤下拉列表
    input.addEventListener('input', () => {
      this.filterExercises(input.value);
      this.dropdownHighlighted = -1;
      this.renderExerciseDropdown();
      dropdown.setCssStyles({ display: 'block' });
    });

    // 聚焦时显示全部候选项
    input.addEventListener('focus', () => {
      if (!this.options.editLog) { // 编辑模式不弹出
        this.filterExercises(input.value);
        this.dropdownHighlighted = -1;
        this.renderExerciseDropdown();
        dropdown.setCssStyles({ display: 'block' });
      }
    });

    // 键盘导航：↑↓移动高亮、Enter选中、Escape关闭
    input.addEventListener('keydown', (e) => {
      if (dropdown.style.display === 'none') return;
      const items = dropdown.querySelectorAll('.workout-combo-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.dropdownHighlighted = Math.min(this.dropdownHighlighted + 1, items.length - 1);
        this.updateDropdownHighlight(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.dropdownHighlighted = Math.max(this.dropdownHighlighted - 1, 0);
        this.updateDropdownHighlight(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.dropdownHighlighted >= 0 && this.dropdownHighlighted < items.length) {
          const exId = (items[this.dropdownHighlighted] as HTMLElement).dataset.id!;
          this.selectExerciseById(exId);
        }
        dropdown.setCssStyles({ display: 'none' });
      } else if (e.key === 'Escape') {
        dropdown.setCssStyles({ display: 'none' });
      }
    });

    // 点击页面其他区域时关闭下拉（用延迟避免点击候选项时先关闭）
    document.addEventListener('mousedown', (e) => {
        if (!comboWrapper!.contains(e.target as Node)) {
          dropdown.setCssStyles({ display: 'none' });
        }
    });
    // comboWrapper 是闭包变量，引用上面创建的 comboWrapper DOM 元素
    let comboWrapper: HTMLElement | null = input.parentElement;
  }

  // 按输入文字过滤训练项列表（模糊匹配：名称/ID 包含即命中）
  private filterExercises(query: string): void {
    const q = query.trim().toLowerCase();
    if (!q) {
      this.filteredExercises = [...this.exercises];
    } else {
      this.filteredExercises = this.exercises.filter(ex => {
        const name = getExerciseName(ex).toLowerCase();
        return name.includes(q) || ex.id.toLowerCase().includes(q);
      });
    }
  }

  // 渲染下拉候选列表
  private renderExerciseDropdown(): void {
    const dropdown = this.exerciseDropdown;
    dropdown.empty();

    if (this.filteredExercises.length === 0) {
      const emptyItem = dropdown.createDiv({ text: t('modal.recordSet.noMatchingExercise') || '无匹配项' });
      emptyItem.addClass('workout-combo-item');
      emptyItem.addClass('workout-combo-empty');
      return;
    }

    for (const ex of this.filteredExercises) {
      const item = dropdown.createDiv();
      item.addClass('workout-combo-item');
      item.dataset.id = ex.id;
      // 高亮当前选中项
      if (ex.id === this.exerciseId) item.addClass('workout-combo-selected');

      item.createSpan({ text: getExerciseName(ex) });
      // 显示类型标签辅助区分
      const typeTag = item.createSpan({
        text: getTrainingTypeName(this.trainingTypes.find(t => t.id === ex.category)) || ex.category,
      });
      typeTag.addClass('workout-combo-type-tag');

      // 点击选中
      item.addEventListener('click', () => {
        this.selectExerciseById(ex.id);
        this.exerciseDropdown.setCssStyles({ display: 'none' });
      });

      // 鼠标悬停同步高亮索引
      item.addEventListener('mouseenter', () => {
        this.dropdownHighlighted = Array.from(dropdown.querySelectorAll('.workout-combo-item')).indexOf(item);
        this.updateDropdownHighlight(dropdown.querySelectorAll('.workout-combo-item'));
      });
    }
  }

  // 更新键盘导航高亮样式
  private updateDropdownHighlight(items: NodeListOf<Element>): void {
    items.forEach((item, i) => {
      (item as HTMLElement).toggleClass('workout-combo-highlighted', i === this.dropdownHighlighted);
    });
  }

  // 按 ID 选中一个训练项并触发 onExerciseChange
  private selectExerciseById(id: string): void {
    const exercise = this.exercises.find(e => e.id === id);
    if (!exercise) return;
    this.exerciseId = id;
    this.exerciseInput.value = getExerciseName(exercise);
    this.onExerciseChange(); // 触发类型切换+上次值加载+字段渲染
  }

  // 根据当前 category（训练类型 id）更新"训练类型"显示文本
  private updateTypeDisplay(): void {
    const type = this.trainingTypes.find((item) => item.id === this.category);
    this.typeDisplay.setText(getTrainingTypeName(type) || this.category);
  }

  // "记忆上次值"：非编辑模式下，读取该训练项上一次保存的记录值并填入 fieldValues，
  // 这样用户连续记录同一动作时不用每次重填。编辑模式不触发（避免覆盖正在编辑的值）。
  private loadLastValues(): void {
    if (!this.options.editLog) {
      const lastValues = this.dataManager.getLastValues(this.exerciseId);
      if (lastValues) {
        this.fieldValues = { ...lastValues };
      }
    }
  }

  // 核心：按当前训练类型的字段定义，动态创建对应的输入控件并塞进 fieldsContainer。
  // 支持 4 种 inputType：number(数字)、duration(时长)、text(文本)、select(下拉)。
  private renderFields(): void {
    this.fieldsContainer.empty(); // 先清空，避免重复渲染时控件叠加
    const type = this.trainingTypes.find((item) => item.id === this.category);
    if (!type) return;

    for (const field of type.fields) {
      const fieldRow = this.fieldsContainer.createDiv();
      fieldRow.addClass('workout-field');

      const unit = this.dataManager.getSettings().unit; // 当前重量单位（kg/lb）
      const unitText = this.getFieldUnit(field, unit);  // 计算该字段的单位显示文字
      const fieldLabel = getFieldLabel(field);

      fieldRow.createEl('label', { text: `${fieldLabel}${unitText ? ` (${unitText})` : ''}` });

      const fieldValue = this.fieldValues[field.key]; // 该字段的当前值（编辑/上次值可能已存在）
      const placeholderText = `${t('modal.recordSet.inputPlaceholder')}${fieldLabel}`;

      // 根据字段类型分支创建不同控件
      switch (field.inputType) {
        case 'number': {
          const numInput = fieldRow.createEl('input', { type: 'number' });
          numInput.addClass('workout-input');
          numInput.setAttribute('step', 'any');
          numInput.setAttribute('inputmode', 'decimal');
          numInput.placeholder = placeholderText;
          if (field.mass) {
            // 重量字段：显示时按单位格式化；用户输入后解析回统一数值再存入 fieldValues
            numInput.value = fieldValue != null ? formatMass(Number(fieldValue), unit) : '';
            numInput.addEventListener('change', () => {
              this.fieldValues[field.key] = parseMass(numInput.value, unit);
            });
          } else {
            // 普通数字：直接存 parseFloat
            numInput.value = fieldValue != null ? String(fieldValue) : '';
            numInput.addEventListener('change', () => {
              this.fieldValues[field.key] = parseFloat(numInput.value);
            });
          }
          // 必填字段：标记 required，提交时会被校验
          if (field.required) {
            numInput.required = true;
          }
          break;
        }
        case 'duration': {
          // 时长字段：把"秒"拆成 时/分/秒 三个等宽输入框，分别显示、再拼回秒。
          const durationRow = fieldRow.createDiv();
          durationRow.addClass('workout-duration-grid');

          // 把已有秒数拆成 {hours, minutes, seconds}，没有值则全 0
          const parts = fieldValue != null ? secondsToParts(Number(fieldValue)) : { hours: 0, minutes: 0, seconds: 0 };

          const hourInput = durationRow.createEl('input', { type: 'number', placeholder: t('duration.hour') });
          hourInput.addClass('workout-input');
          hourInput.setAttribute('step', 'any');
          hourInput.setAttribute('inputmode', 'numeric');
          hourInput.value = String(parts.hours);
          hourInput.title = t('duration.hour');

          const minInput = durationRow.createEl('input', { type: 'number', placeholder: t('duration.minute') });
          minInput.addClass('workout-input');
          minInput.setAttribute('step', 'any');
          minInput.setAttribute('inputmode', 'numeric');
          minInput.value = String(parts.minutes);
          minInput.title = t('duration.minute');

          const secInput = durationRow.createEl('input', { type: 'number', placeholder: t('duration.second') });
          secInput.addClass('workout-input');
          secInput.setAttribute('step', 'any');
          secInput.setAttribute('inputmode', 'numeric');
          secInput.value = String(parts.seconds);
          secInput.title = t('duration.second');

          // 任一时/分/秒变化，都重新拼成总秒数存入 fieldValues
          const updateDuration = () => {
            this.fieldValues[field.key] = parseDuration(
              parseInt(hourInput.value, 10) || 0,
              parseInt(minInput.value, 10) || 0,
              parseInt(secInput.value, 10) || 0
            );
          };
          hourInput.addEventListener('change', updateDuration);
          minInput.addEventListener('change', updateDuration);
          secInput.addEventListener('change', updateDuration);
          break;
        }
        case 'text': {
          const textInput = fieldRow.createEl('input', { type: 'text' });
          textInput.addClass('workout-input');
          textInput.placeholder = placeholderText;
          textInput.value = fieldValue != null ? String(fieldValue) : '';
          textInput.addEventListener('change', () => {
            this.fieldValues[field.key] = textInput.value;
          });
          break;
        }
        case 'select': {
          const selectInput = fieldRow.createEl('select');
          selectInput.addClass('workout-select');
          const opts = field.options ?? [];
          if (opts.length === 0) {
            // 无选项时给一个"无"占位项
            selectInput.createEl('option', { value: '', text: t('settings.none') });
          } else {
            for (const opt of opts) {
              const option = selectInput.createEl('option', { value: opt, text: opt });
              // 若已有值且与之匹配，则预选中
              if (fieldValue != null && String(fieldValue) === opt) {
                option.selected = true;
              }
            }
          }
          // 下拉框原生默认选中第一项（即使未手动选择也如此），但 change 不触发，
          // fieldValues 不会被写入，直接保存会导致该字段丢数据。
          // 因此未编辑过时，手动把当前选中值（第一项）写回 fieldValues。
          if (fieldValue == null && opts.length > 0) {
            this.fieldValues[field.key] = selectInput.value;
          }
          selectInput.addEventListener('change', () => {
            this.fieldValues[field.key] = selectInput.value;
          });
          break;
        }
      }
    }
  }

  // 根据字段定义计算该字段的单位显示文字（用于界面提示）。mass 用当前单位 kg/lb，否则用自由单位文字。
  private getFieldUnit(field: FieldDef, unit: 'kg' | 'lb'): string {
    if (field.mass) return unit;
    if (field.unitLabel) return field.unitLabel;
    return '';
  }

  // 从 datetime-local 输入框读出 "YYYY-MM-DD HH:mm"；为空则回退到当前时间。
  private readTimestamp(): string {
    const v = this.timeInput.value;
    if (v) return v.replace('T', ' ');
    const n = new Date();
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())} ${pad(n.getHours())}:${pad(n.getMinutes())}`;
  }

  // 保存：校验必填项后写入数据管理器（新增或更新），并给出右下角提示 Notice，最后关闭弹窗。
  private async save(): Promise<void> {
    // 必须先确定训练项（exerciseId），否则不知道该保存哪些字段
    if (!this.exerciseId || !this.exercises.find(e => e.id === this.exerciseId)) {
      new Notice(t('modal.recordSet.selectExercise') || '请选择有效的训练项');
      return;
    }

    const type = this.trainingTypes.find((item) => item.id === this.category);
    if (!type) {
      new Notice(t('modal.recordSet.selectType'));
      return;
    }

    // 必填校验：遍历该类型的字段，required 且值为空（undefined/null）则拦截并提示
    for (const field of type.fields) {
      if (field.required && (this.fieldValues[field.key] === undefined || this.fieldValues[field.key] === null)) {
        new Notice(`${getFieldLabel(field)} ${t('modal.recordSet.requiredField')}`);
        return;
      }
    }

    try {
      const timestamp = this.readTimestamp();
      const plan = this.planInput.value || undefined;
      if (this.options.editLog) {
        // 编辑模式：用原始记录的定位信息去更新（训练项已锁定，不能改）
        await this.dataManager.updateLog(
          this.options.editLog.id,
          {
            exerciseId: this.exerciseId,
            category: this.category,
            fields: this.fieldValues,
            note: this.noteInput.value || undefined,
            timestamp,
            plan,
          }
        );
        new Notice(t('modal.recordSet.updated'));
      } else {
        // 新增模式：直接追加一条记录（plan 默认文件名/空，时间默认当前、均可改）
        await this.dataManager.addLog({
          exerciseId: this.exerciseId,
          category: this.category,
          fields: this.fieldValues,
          note: this.noteInput.value || undefined,
          plan,
          timestamp,
        });
        new Notice(t('modal.recordSet.saved'));
      }
      this.close();
    } catch {
      // 写入失败（如 CSV 异常）时给出错误提示，但不关闭弹窗，方便用户重试
      new Notice(t('modal.recordSet.saveFailed'));
    }
  }

  // onClose：弹窗关闭时清空内容容器，释放 DOM。Obsidian 会在关闭后自动移除弹窗本身。
  onClose(): void {
    this.contentEl.empty();
  }
}
