import { Modal, setIcon, Notice, MarkdownView } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { WorkoutConfig } from '../data/types';
import { t } from '../i18n';
import { CodeBlockDef, buildCodeBlock } from '../codeBlockDefs';

/*
 * InsertCodeBlockParamModal —— 参数弹窗
 * 选定某个代码块后弹出：展示该代码块说明 + 动态生成的参数表单（全部非必填）。
 * 底部「跳过参数」直接插入纯代码块；「插入到光标处」带上已填参数。
 * 通过当前 Markdown 编辑器的 editor.replaceSelection 在光标处插入文本。
 */
export class InsertCodeBlockParamModal extends Modal {
  private dataManager: DataManager;
  private def: CodeBlockDef;
  private values: Record<string, string> = {};
  private paramContainer!: HTMLDivElement;
  private inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};

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

  onClose(): void {
    this.contentEl.empty();
  }
}
