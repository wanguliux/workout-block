import { Modal, setIcon, Notice, MarkdownView } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { WorkoutConfig, Exercise, TrainingType } from '../data/types';
import { getExerciseName, getTrainingTypeName } from '../data/display';
import { t } from '../i18n';
import { CodeBlockDef, buildCodeBlock } from '../codeBlockDefs';

/*
 * InsertCodeBlockParamModal —— 参数弹窗
 * 选定某个代码块后弹出：展示该代码块说明 + 动态生成的参数表单（全部非必填）。
 * 底部「跳过参数」直接插入纯代码块；「插入到光标处」带上已填参数。
 * 通过当前 Markdown 编辑器的 editor.replaceSelection 在光标处插入文本。
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
  private def: CodeBlockDef;
  private values: Record<string, string> = {};
  private paramContainer!: HTMLDivElement;
  private inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
  private exerciseCombos: Record<string, ExerciseComboState> = {};

  constructor(dataManager: DataManager, def: CodeBlockDef) {
    super(dataManager.app);
    this.dataManager = dataManager;
    this.def = def;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('workout-insert-param-modal');

    // 标题：图标 + 名称
    const header = contentEl.createDiv();
    header.addClass('workout-insert-param-header');
    const iconEl = header.createSpan();
    iconEl.addClass('workout-insert-card-icon');
    setIcon(iconEl, this.def.icon);
    header.createEl('h2', { text: this.def.title });

    contentEl.createDiv({ text: this.def.desc, cls: 'workout-insert-card-desc' });

    // 参数区标题
    const paramTitle = contentEl.createDiv();
    paramTitle.addClass('workout-insert-param-subtitle');
    paramTitle.setText(t('modal.insertCodeblock.paramTitle'));

    this.paramContainer = contentEl.createDiv();
    this.paramContainer.addClass('workout-insert-params');

    // 动态选项（plan/metric）需要先读 config
    const config = await this.dataManager.getConfig();
    this.renderParams(config);

    // 底部按钮行
    const btnRow = contentEl.createDiv();
    btnRow.addClass('workout-btn-row');

    const skipBtn = btnRow.createEl('button', { text: t('modal.insertCodeblock.skip') });
    skipBtn.addClass('mod-muted');
    skipBtn.addEventListener('click', () => {
      this.insert(buildCodeBlock(this.def, {}));
    });

    const insertBtn = btnRow.createEl('button', { text: t('modal.insertCodeblock.insert') });
    insertBtn.addClass('mod-cta');
    insertBtn.addEventListener('click', () => {
      this.collectValues();
      this.insert(buildCodeBlock(this.def, this.values));
    });
  }

  // 渲染参数表单；config 用于填充 dynamic 的 select 选项（计划名 / 统计指标）
  private renderParams(config: WorkoutConfig): void {
    this.paramContainer.empty();
    for (const p of this.def.params) {
      const row = this.paramContainer.createDiv();
      row.addClass('workout-field');

      const labelRow = row.createDiv();
      labelRow.addClass('workout-insert-param-label');
      labelRow.createSpan({ text: p.label });
      const optTag = labelRow.createSpan({ text: t('modal.insertCodeblock.optional') });
      optTag.addClass('workout-insert-param-optional');

      if (p.desc) {
        row.createDiv({ text: p.desc, cls: 'workout-insert-param-hint' });
      }

      if (p.type === 'select') {
        const select = row.createEl('select');
        select.addClass('workout-select');
        select.createEl('option', { value: '', text: '— 不设置 —' });

        let options: { value: string; label: string }[] = [];
        if (p.dynamic === 'plan') {
          options = (config.plans ?? []).map((pl) => ({ value: pl.name, label: pl.name }));
        } else if (p.dynamic === 'metric') {
          options = (config.statistics ?? []).map((m) => ({ value: m.id, label: m.name ?? m.id }));
        } else {
          options = (p.options ?? []).map((o) => ({ value: o, label: p.optionLabels?.[o] ?? o }));
        }
        for (const o of options) {
          select.createEl('option', { value: o.value, text: o.label });
        }
        select.addEventListener('change', () => {
          this.values[p.key] = select.value;
        });
        this.inputs[p.key] = select;
      } else if (p.type === 'exercise') {
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

        document.addEventListener('mousedown', (e) => {
          if (!comboWrapper.contains(e.target as Node)) {
            dropdown.setCssStyles({ display: 'none' });
          }
        });

        this.inputs[p.key] = input;
      } else {
        const input = row.createEl('input', { type: p.type === 'number' ? 'number' : 'text' });
        input.addClass('workout-input');
        if (p.type === 'number') {
          input.setAttribute('step', 'any');
          input.setAttribute('inputmode', 'numeric');
        }
        if (p.placeholder) input.placeholder = p.placeholder;
        input.addEventListener('change', () => {
          this.values[p.key] = input.value;
        });
        this.inputs[p.key] = input;
      }
    }
  }

  // 收集各控件当前值（兜底：覆盖用户未触发 change 的情况）
  private collectValues(): void {
    for (const p of this.def.params) {
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
      const emptyItem = dropdown.createDiv({ text: t('modal.recordSet.noMatchingExercise') || '无匹配项' });
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
        text: getTrainingTypeName(state.trainingTypes.find((t) => t.id === ex.category)) || ex.category,
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
    this.contentEl.empty();
  }
}
