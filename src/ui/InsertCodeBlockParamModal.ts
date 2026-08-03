import { Modal, setIcon, Notice, MarkdownView } from 'obsidian';
import type { App } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { WorkoutConfig, Exercise, TrainingType } from '../data/types';
import { getExerciseName, getTrainingTypeName } from '../data/display';
import { t } from '../i18n';
import { buildCodeBlock } from '../codeBlockDefs';
import type { BlockDefinitionWithParams, BlockParamDef } from '../blockProvider';

/*
 * InsertCodeBlockParamModal —— 参数弹窗（跨插件通用）
 * 选定某个代码块后弹出：展示该代码块说明 + 动态生成的参数表单（全部非必填）。
 * 底部「跳过参数」直接插入纯代码块；「插入到光标处」带上已填参数。
 * 通过当前 Markdown 编辑器的 editor.replaceSelection 在光标处插入文本。
 *
 * 跨插件兼容：接受 BlockDefinitionWithParams（来自 blockProvider 契约），
 * 支持 workout 专有类型（exercise / dynamic select）以及其他插件的扩展类型
 * （未知类型 fallback 为文本输入）。
 */

interface ExerciseComboState {
  input: HTMLInputElement;
  dropdown: HTMLDivElement;
  exercises: Exercise[];
  trainingTypes: TrainingType[];
  filtered: Exercise[];
  highlighted: number;
}

export class InsertCodeBlockParamModal extends Modal {
  private dataManager: DataManager;
  private block: BlockDefinitionWithParams;
  private values: Record<string, string> = {};
  private paramContainer!: HTMLDivElement;
  private inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
  private exerciseCombos: Record<string, ExerciseComboState> = {};
  private docMousedownHandlers: Array<(e: MouseEvent) => void> = []; // document 级监听器（onClose 移除）

  constructor(app: App, dataManager: DataManager, block: BlockDefinitionWithParams) {
    super(app);
    this.dataManager = dataManager;
    this.block = block;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('workout-insert-param-modal');

    // 标题：图标 + 名称
    const header = contentEl.createDiv();
    header.addClass('workout-insert-param-header');
    if (this.block.icon) {
      const iconEl = header.createSpan();
      iconEl.addClass('workout-insert-card-icon');
      setIcon(iconEl, this.block.icon);
    }
    header.createEl('h2', { text: this.block.name });

    if (this.block.description) {
      contentEl.createDiv({ text: this.block.description, cls: 'workout-insert-card-desc' });
    }

    // 参数区标题
    if (this.block.params.length > 0) {
      const paramTitle = contentEl.createDiv();
      paramTitle.addClass('workout-insert-param-subtitle');
      paramTitle.setText(t('modal.insertCodeblock.paramTitle'));

      this.paramContainer = contentEl.createDiv();
      this.paramContainer.addClass('workout-insert-params');

      // 动态选项（plan/metric）需要先读 config
      const config = await this.dataManager.getConfig();
      this.renderParams(config);
    }

    // 底部按钮行
    const btnRow = contentEl.createDiv();
    btnRow.addClass('workout-btn-row');

    if (this.block.params.length > 0) {
      const skipBtn = btnRow.createEl('button', { text: t('modal.insertCodeblock.skip') });
      skipBtn.addClass('mod-muted');
      skipBtn.addEventListener('click', () => {
        this.insert(buildCodeBlock(this.block, {}));
      });
    }

    const insertBtn = btnRow.createEl('button', { text: t('modal.insertCodeblock.insert') });
    insertBtn.addClass('mod-cta');
    insertBtn.addEventListener('click', () => {
      this.collectValues();
      this.insert(buildCodeBlock(this.block, this.values));
    });
  }

  // 渲染参数表单；config 用于填充 dynamic 的 select 选项（计划名 / 统计指标）
  private renderParams(config: WorkoutConfig): void {
    this.paramContainer.empty();
    for (const p of this.block.params) {
      const row = this.paramContainer.createDiv();
      row.addClass('workout-field');

      const labelRow = row.createDiv();
      labelRow.addClass('workout-insert-param-label');
      labelRow.createSpan({ text: p.label });
      if (p.optional !== false) {
        const optTag = labelRow.createSpan({ text: t('modal.insertCodeblock.optional') });
        optTag.addClass('workout-insert-param-optional');
      }

      if (p.description) {
        row.createDiv({ text: p.description, cls: 'workout-insert-param-hint' });
      }

      if (p.type === 'select') {
        // 可编辑下拉框（combobox）：既可从候选列表选择，也可直接手打任意值。
        // options 已由提供方在 getBlockRegistry 时物化（含跨插件场景），
        // 与 main.ts.resolveDynamicOptions 同源、单一真相，杜绝两处解析漂移（Pitfall #7）。
        const options = (p.options ?? []).map((o) => ({ value: o, label: p.optionLabels?.[o] ?? o }));
        this.renderSelectCombobox(row, p, options);
      } else if (p.type === 'exercise') {
        // workout 专有：训练项搜索 combobox
        const exercises = config.exercises;
        const comboWrapper = row.createDiv();
        comboWrapper.addClass('workout-combo-wrapper');

        const input = comboWrapper.createEl('input', { type: 'text' });
        input.addClass('workout-input');
        input.addClass('workout-combo-input');
        if (p.placeholder) input.placeholder = p.placeholder;

        const dropdown = comboWrapper.createDiv();
        dropdown.addClass('workout-combo-dropdown');
        dropdown.setCssStyles({ display: 'none' });

        const state: ExerciseComboState = {
          input,
          dropdown,
          exercises,
          trainingTypes: config.trainingTypes,
          filtered: [...exercises],
          highlighted: -1,
        };
        this.exerciseCombos[p.key] = state;

        this.renderExerciseDropdown(state);

        input.addEventListener('input', () => {
          this.filterExercises(state, input.value);
          state.highlighted = -1;
          this.renderExerciseDropdown(state);
          dropdown.setCssStyles({ display: 'block' });
        });

        input.addEventListener('focus', () => {
          this.filterExercises(state, input.value);
          state.highlighted = -1;
          this.renderExerciseDropdown(state);
          dropdown.setCssStyles({ display: 'block' });
        });

        input.addEventListener('keydown', (e) => {
          if (dropdown.style.display === 'none') return;
          const items = dropdown.querySelectorAll('.workout-combo-item');
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            state.highlighted = Math.min(state.highlighted + 1, items.length - 1);
            this.updateDropdownHighlight(items, state.highlighted);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            state.highlighted = Math.max(state.highlighted - 1, 0);
            this.updateDropdownHighlight(items, state.highlighted);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (state.highlighted >= 0 && state.highlighted < items.length) {
              const exId = (items[state.highlighted] as HTMLElement).dataset.id;
              if (exId) this.selectExerciseById(state, exId);
            }
            dropdown.setCssStyles({ display: 'none' });
          } else if (e.key === 'Escape') {
            dropdown.setCssStyles({ display: 'none' });
          }
        });

        const mousedownHandler1 = (e: MouseEvent) => {
          if (!comboWrapper.contains(e.target as Node)) {
            dropdown.setCssStyles({ display: 'none' });
          }
        };
        this.docMousedownHandlers.push(mousedownHandler1);
        document.addEventListener('mousedown', mousedownHandler1);

        this.inputs[p.key] = input;
      } else if (p.type === 'date') {
        // 跨插件兼容：date 类型渲染为 HTML date input
        const input = row.createEl('input', { type: 'date' });
        input.addClass('workout-input');
        // 默认填入今日
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        input.value = `${y}-${m}-${d}`;
        this.inputs[p.key] = input;
      } else {
        // text / number / 以及未知类型（如跨插件的 'account' 等）均 fallback 为文本输入
        const isNumber = p.type === 'number';
        const input = row.createEl('input', { type: isNumber ? 'number' : 'text' });
        input.addClass('workout-input');
        if (isNumber) {
          input.setAttribute('step', 'any');
          input.setAttribute('inputmode', 'numeric');
        }
        if (p.placeholder) input.placeholder = p.placeholder;
        if (p.defaultValue) input.value = p.defaultValue;
        input.addEventListener('change', () => {
          this.values[p.key] = input.value;
        });
        this.inputs[p.key] = input;
      }
    }
  }

  // 通用可编辑下拉框（combobox）：input + 过滤下拉。
  // 用于 type:'select' 参数（含跨插件的账户 / 计划 / 指标等），
  // 既能从候选列表点选，也能直接手打任意新值。复用 workout-combo-* 样式。
  private renderSelectCombobox(
    row: HTMLElement,
    p: BlockParamDef,
    options: { value: string; label: string }[],
  ): void {
    const wrapper = row.createDiv();
    wrapper.addClass('workout-combo-wrapper');

    const input = wrapper.createEl('input', { type: 'text' });
    input.addClass('workout-input');
    input.addClass('workout-combo-input');
    if (p.placeholder) input.placeholder = p.placeholder;

    const dropdown = wrapper.createDiv();
    dropdown.addClass('workout-combo-dropdown');
    dropdown.setCssStyles({ display: 'none' });

    // 预填：优先 defaultValue，其次第一个选项
    if (p.defaultValue) {
      input.value = p.defaultValue;
    } else if (options.length > 0) {
      input.value = options[0].value;
    }

    const render = () => {
      dropdown.empty();
      const q = input.value.trim().toLowerCase();
      const list = q
        ? options.filter(
            (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
          )
        : options;
      if (list.length === 0) {
        const empty = dropdown.createDiv({
          text: t('modal.recordSet.noMatchingExercise'),
        });
        empty.addClass('workout-combo-item');
        empty.addClass('workout-combo-empty');
        return;
      }
      list.forEach((o) => {
        const item = dropdown.createDiv({ text: o.label });
        item.addClass('workout-combo-item');
        item.addEventListener('click', () => {
          input.value = o.value;
          dropdown.setCssStyles({ display: 'none' });
        });
        item.addEventListener('mouseenter', () => {
          dropdown
            .querySelectorAll('.workout-combo-item')
            .forEach((el) => el.removeClass('workout-combo-highlighted'));
          item.addClass('workout-combo-highlighted');
        });
      });
    };

    input.addEventListener('input', () => {
      render();
      dropdown.setCssStyles({ display: 'block' });
    });
    input.addEventListener('focus', () => {
      render();
      dropdown.setCssStyles({ display: 'block' });
    });
    input.addEventListener('keydown', (e) => {
      if (dropdown.style.display === 'none') {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          e.preventDefault();
          render();
          dropdown.setCssStyles({ display: 'block' });
        }
        return;
      }
      if (e.key === 'Escape') {
        dropdown.setCssStyles({ display: 'none' });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const first = dropdown.querySelector('.workout-combo-item') as HTMLElement | null;
        if (first) first.click();
      }
    });
    const mousedownHandler2 = (e: MouseEvent) => {
      if (!wrapper.contains(e.target as Node)) {
        dropdown.setCssStyles({ display: 'none' });
      }
    };
    this.docMousedownHandlers.push(mousedownHandler2);
    document.addEventListener('mousedown', mousedownHandler2);

    this.inputs[p.key] = input;
  }

  // 收集各控件当前值（兜底：覆盖用户未触发 change 的情况）
  private collectValues(): void {
    for (const p of this.block.params) {
      const el = this.inputs[p.key];
      if (!el) continue;
      this.values[p.key] = el.value;
    }
  }

  // 在光标处插入代码块文本；无活动编辑器时提示并关闭
  private insert(text: string): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice(t('modal.insertCodeblock.noEditor'));
      this.close();
      return;
    }
    view.editor.replaceSelection(text);
    new Notice(t('modal.insertCodeblock.inserted'));
    this.close();
  }

  // ===== 训练项搜索 Combobox 实现（复用 RecordModal 同款交互） =====

  private filterExercises(state: ExerciseComboState, query: string): void {
    const q = query.trim().toLowerCase();
    if (!q) {
      state.filtered = [...state.exercises];
    } else {
      state.filtered = state.exercises.filter((ex) => {
        const name = getExerciseName(ex).toLowerCase();
        return name.includes(q) || ex.id.toLowerCase().includes(q);
      });
    }
  }

  private renderExerciseDropdown(state: ExerciseComboState): void {
    const dropdown = state.dropdown;
    dropdown.empty();

    if (state.filtered.length === 0) {
      const emptyItem = dropdown.createDiv({ text: t('modal.recordSet.noMatchingExercise') });
      emptyItem.addClass('workout-combo-item');
      emptyItem.addClass('workout-combo-empty');
      return;
    }

    for (const ex of state.filtered) {
      const item = dropdown.createDiv();
      item.addClass('workout-combo-item');
      item.dataset.id = ex.id;

      item.createSpan({ text: getExerciseName(ex) });
      const typeTag = item.createSpan({
        text: getTrainingTypeName(state.trainingTypes.find((tt) => tt.id === ex.category)) || ex.category,
      });
      typeTag.addClass('workout-combo-type-tag');

      item.addEventListener('click', () => {
        this.selectExerciseById(state, ex.id);
        dropdown.setCssStyles({ display: 'none' });
      });

      item.addEventListener('mouseenter', () => {
        state.highlighted = Array.from(dropdown.querySelectorAll('.workout-combo-item')).indexOf(item);
        this.updateDropdownHighlight(dropdown.querySelectorAll('.workout-combo-item'), state.highlighted);
      });
    }
  }

  private updateDropdownHighlight(items: NodeListOf<Element>, highlighted: number): void {
    items.forEach((item, i) => {
      (item as HTMLElement).toggleClass('workout-combo-highlighted', i === highlighted);
    });
  }

  private selectExerciseById(state: ExerciseComboState, id: string): void {
    const exercise = state.exercises.find((e) => e.id === id);
    if (!exercise) return;
    state.input.value = getExerciseName(exercise);
  }

  onClose(): void {
    for (const handler of this.docMousedownHandlers) {
      document.removeEventListener('mousedown', handler);
    }
    this.docMousedownHandlers.length = 0;
    this.contentEl.empty();
  }
}
