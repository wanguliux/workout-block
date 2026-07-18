import { Modal, Notice } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { getTrainingTypeName } from '../data/display';
import { StatDef, StatAggregation, StatGranularity, WorkoutConfig } from '../data/types';
import { allowedStatFields, builderToExpr, exprToBuilder, validateExpression } from '../data/statExpr';
import { t } from '../i18n';

/* StatModal —— "新增/编辑数据统计"弹窗。
 * 表单包含：名称 / 关联训练类型(多选) / 公式(引导式+表达式双模式) / 时间粒度 / 启用。
 * 关联类型变化时会重算「字段交集」并重载字段下拉；表达式模式实时校验、保存前再校验。 */

interface StatModalOptions {
  editStat?: StatDef;
}

// 引导式运算下拉的展示标签（内部 kind 不友好，需映射成用户看得懂的文字）。
// 用函数（而非模块常量）是为了在「每次渲染」时取当前语言，语言切换后能即时更新。
function opLabel(kind: StatAggregation['kind']): string {
  switch (kind) {
    case 'sum': return t('modal.statManager.opSum');
    case 'productSum': return t('modal.statManager.opProductSum');
    case 'oneRepMax': return t('modal.statManager.opOneRepMax');
    case 'avg': return t('modal.statManager.opAvg');
    case 'max': return t('modal.statManager.opMax');
    case 'min': return t('modal.statManager.opMin');
    case 'count': return t('modal.statManager.opCount');
  }
}

export class StatModal extends Modal {
  private dataManager: DataManager;
  private options: StatModalOptions;
  private config!: WorkoutConfig;

  private name = '';
  private associatedTypes: string[] = [];
  private mode: 'builder' | 'expression' = 'builder';
  private builder: StatAggregation = { kind: 'sum', field: '' };
  private expression = '';
  private granularity: StatGranularity = 'daily';
  private enabled = true;

  private typesContainer!: HTMLDivElement;
  private formulaContainer!: HTMLDivElement;

  constructor(dataManager: DataManager, options: StatModalOptions = {}) {
    super(dataManager.app);
    this.dataManager = dataManager;
    this.options = options;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('workout-edit-modal');

    this.config = await this.dataManager.getConfig();

    // 编辑模式：从已有统计拷贝状态（深拷贝 builder，避免直接改动原配置）
    const edit = this.options.editStat;
    if (edit) {
      this.name = edit.name;
      this.associatedTypes = [...edit.associatedTypes];
      this.mode = edit.formula.mode;
      this.builder = edit.formula.builder ? { ...edit.formula.builder } : { kind: 'sum', field: '' };
      this.expression = edit.formula.expression ?? '';
      this.granularity = edit.granularity;
      this.enabled = edit.enabled;
    }

    contentEl.createEl('h2', { text: edit ? t('modal.stat.editTitle') : t('modal.stat.title') });

    // 名称
    const nameRow = contentEl.createDiv();
    nameRow.addClass('workout-field');
    nameRow.createEl('label', { text: t('modal.statManager.name') });
    const nameInput = nameRow.createEl('input', { type: 'text' });
    nameInput.addClass('workout-input');
    nameInput.value = this.name;
    nameInput.addEventListener('input', () => { this.name = nameInput.value; });

    // 关联训练类型（多选）
    contentEl.createEl('h3', { text: t('modal.statManager.types') });
    this.typesContainer = contentEl.createDiv();
    this.typesContainer.addClass('workout-check-grid');
    this.renderTypeChecks();

    // 公式
    contentEl.createEl('h3', { text: t('modal.statManager.formula') });
    const modeRow = contentEl.createDiv();
    modeRow.addClass('workout-field');
    modeRow.createEl('label', { text: t('modal.statManager.mode') });
    const modeSelect = modeRow.createEl('select');
    modeSelect.addClass('workout-select');
    for (const m of ['builder', 'expression'] as const) {
      const opt = modeSelect.createEl('option', {
        value: m,
        text: m === 'builder' ? t('modal.statManager.builder') : t('modal.statManager.expression'),
      });
      if (m === this.mode) opt.selected = true;
    }
    modeSelect.addEventListener('change', () => {
      this.mode = modeSelect.value as 'builder' | 'expression';
      // 切换模式时把当前公式同步成另一形态的表示，避免切换后公式丢失。
      // 引导式 → 表达式：用 builderToExpr 生成表达式字符串。
      // 表达式 → 引导式：用 exprToBuilder 尽力回填；复杂表达式降级为默认 sum。
      if (this.mode === 'expression') {
        this.expression = builderToExpr(this.builder) || this.expression;
      } else {
        const b = exprToBuilder(this.expression);
        if (b) this.builder = b;
      }
      this.renderFormula();
    });

    this.formulaContainer = contentEl.createDiv();
    this.renderFormula();

    // 两列网格：时间粒度 + 启用（对齐重设计稿）
    const granEnableCol = contentEl.createDiv();
    granEnableCol.addClass('workout-two-col');

    // 时间粒度
    const granRow = granEnableCol.createDiv();
    granRow.addClass('workout-field');
    granRow.createEl('label', { text: t('modal.statManager.granularity') });
    const granSelect = granRow.createEl('select');
    granSelect.addClass('workout-select');
    for (const g of ['daily', 'weekly', 'monthly'] as const) {
      const opt = granSelect.createEl('option', {
        value: g,
        text: g === 'daily' ? t('modal.statManager.daily')
          : g === 'weekly' ? t('modal.statManager.weekly')
          : t('modal.statManager.monthly'),
      });
      if (g === this.granularity) opt.selected = true;
    }
    granSelect.addEventListener('change', () => { this.granularity = granSelect.value as StatGranularity; });

    // 启用（布尔开关）
    const enabledToggleWrap = granEnableCol.createDiv();
    enabledToggleWrap.addClass('workout-toggle');
    const enabledToggle = enabledToggleWrap.createEl('input', { type: 'checkbox', cls: 'workout-switch' });
    enabledToggle.checked = this.enabled;
    enabledToggle.addEventListener('change', () => { this.enabled = enabledToggle.checked; });
    enabledToggleWrap.createSpan({ text: t('modal.statManager.showInStats') });

    // 底部按钮
    const btnRow = contentEl.createDiv();
    btnRow.addClass('workout-btn-row');
    const cancelBtn = btnRow.createEl('button', { text: t('common.cancel') });
    cancelBtn.addClass('mod-muted');
    cancelBtn.addEventListener('click', () => this.close());
    const saveBtn = btnRow.createEl('button', { text: t('common.save') });
    saveBtn.addClass('mod-cta');
    saveBtn.addEventListener('click', () => { void this.save(); });
  }

  // 当前关联类型下的可用字段交集（供字段下拉与校验使用）
  private allowed(): string[] {
    const tmp: StatDef = {
      id: 'tmp', name: this.name, associatedTypes: this.associatedTypes,
      formula: { mode: 'builder', builder: this.builder },
      granularity: this.granularity, enabled: this.enabled,
    };
    return allowedStatFields(tmp, this.config);
  }

  private renderTypeChecks(): void {
    this.typesContainer.empty();
    if (this.config.trainingTypes.length === 0) {
      this.typesContainer.createEl('p', { text: t('modal.statManager.noTypes') });
      return;
    }
    for (const type of this.config.trainingTypes) {
      const row = this.typesContainer.createDiv();
      row.addClass('workout-check-item');
      const checkbox = row.createEl('input', { type: 'checkbox' });
      checkbox.checked = this.associatedTypes.includes(type.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          if (!this.associatedTypes.includes(type.id)) this.associatedTypes.push(type.id);
        } else {
          this.associatedTypes = this.associatedTypes.filter((id) => id !== type.id);
        }
        this.onTypesChanged();
      });
      row.createEl('label', { text: getTrainingTypeName(type) || type.id });
    }
  }

  // 关联类型变化：重算字段交集，重置越界字段，重渲染公式区
  private onTypesChanged(): void {
    const allowed = this.allowed();
    const b = this.builder as any;
    if (!b.field || !allowed.includes(b.field)) b.field = allowed[0] ?? '';
    if (!b.fieldA || !allowed.includes(b.fieldA)) b.fieldA = allowed[0] ?? '';
    if (!b.fieldB || !allowed.includes(b.fieldB)) b.fieldB = allowed[0] ?? '';
    if (!b.weightField || !allowed.includes(b.weightField)) b.weightField = allowed[0] ?? '';
    if (!b.repsField || !allowed.includes(b.repsField)) b.repsField = allowed[0] ?? '';
    this.renderFormula();
  }

  private renderFormula(): void {
    this.formulaContainer.empty();
    const allowed = this.allowed();

    if (this.mode === 'builder') {
      // 运算下拉
      const opRow = this.formulaContainer.createDiv();
      opRow.addClass('workout-field');
      opRow.createEl('label', { text: t('modal.statManager.op') });
      const opSelect = opRow.createEl('select');
      opSelect.addClass('workout-select');
      const ops: StatAggregation['kind'][] = ['sum', 'productSum', 'oneRepMax', 'avg', 'max', 'min', 'count'];
      for (const op of ops) {
        const opt = opSelect.createEl('option', { value: op, text: opLabel(op) });
        if (op === this.builder.kind) opt.selected = true;
      }
      opSelect.addEventListener('change', () => {
        const kind = opSelect.value as StatAggregation['kind'];
        // 切换运算时尽量保留用户已选的「主字段」，避免来回切运算把选择清空。
        const prevField = (this.builder as any).field ?? (this.builder as any).fieldA ?? (this.builder as any).weightField ?? '';
        const fieldOk = allowed.includes(prevField);
        const field = fieldOk ? prevField : (allowed[0] ?? '');
        // oneRepMax 需要 weightField + repsField；productSum 需要 fieldA + fieldB；其余只需 field。
        if (kind === 'count') {
          this.builder = { kind: 'count' };
        } else if (kind === 'oneRepMax') {
          this.builder = { kind: 'oneRepMax', weightField: field, repsField: allowed.find(f => f !== field) ?? allowed[0] ?? '' };
        } else if (kind === 'productSum') {
          this.builder = { kind: 'productSum', fieldA: field, fieldB: allowed[0] ?? '' };
        } else {
          this.builder = { kind, field };
        }
        this.renderFormula();
      });

      if (this.builder.kind === 'count') {
        this.formulaContainer.createEl('p', { text: t('modal.statManager.countHint') });
      } else if (this.builder.kind === 'oneRepMax') {
        // 1RM 估算需要重量字段和次数字段（不渲染通用"字段"下拉）
        // 重量字段
        const wfRow = this.formulaContainer.createDiv();
        wfRow.addClass('workout-field');
        wfRow.createEl('label', { text: t('modal.statManager.weightField') });
        const wfSelect = wfRow.createEl('select');
        wfSelect.addClass('workout-select');
        if (allowed.length === 0) {
          wfSelect.createEl('option', { value: '', text: t('modal.statManager.selectField') });
        } else {
          for (const f of allowed) {
            const opt = wfSelect.createEl('option', { value: f, text: f });
            if (f === (this.builder as any).weightField) opt.selected = true;
          }
        }
        wfSelect.addEventListener('change', () => { (this.builder as any).weightField = wfSelect.value; });

        // 次数字段
        const rfRow = this.formulaContainer.createDiv();
        rfRow.addClass('workout-field');
        rfRow.createEl('label', { text: t('modal.statManager.repsField') });
        const rfSelect = rfRow.createEl('select');
        rfSelect.addClass('workout-select');
        if (allowed.length === 0) {
          rfSelect.createEl('option', { value: '', text: t('modal.statManager.selectField') });
        } else {
          for (const f of allowed) {
            const opt = rfSelect.createEl('option', { value: f, text: f });
            if (f === (this.builder as any).repsField) opt.selected = true;
          }
        }
        rfSelect.addEventListener('change', () => { (this.builder as any).repsField = rfSelect.value; });
      } else {
        // 通用字段下拉（sum / avg / max / min 的字段；productSum 的字段 A）
        const fieldRow = this.formulaContainer.createDiv();
        fieldRow.addClass('workout-field');
        fieldRow.createEl('label', { text: t('modal.statManager.field') });
        const fieldSelect = fieldRow.createEl('select');
        fieldSelect.addClass('workout-select');
        if (allowed.length === 0) {
          fieldSelect.createEl('option', { value: '', text: t('modal.statManager.selectField') });
        } else {
          // 选中值：productSum 取 fieldA，其余取 field
          const selectedValue = this.builder.kind === 'productSum'
            ? (this.builder as any).fieldA
            : (this.builder as any).field;
          for (const f of allowed) {
            const opt = fieldSelect.createEl('option', { value: f, text: f });
            if (f === selectedValue) opt.selected = true;
          }
        }
        fieldSelect.addEventListener('change', () => {
          if (this.builder.kind === 'productSum') (this.builder as any).fieldA = fieldSelect.value;
          else (this.builder as any).field = fieldSelect.value;
        });

        // 乘积求和需要第二个字段 B
        if (this.builder.kind === 'productSum') {
          const fieldBRow = this.formulaContainer.createDiv();
          fieldBRow.addClass('workout-field');
          fieldBRow.createEl('label', { text: t('modal.statManager.fieldB') });
          const fieldBSelect = fieldBRow.createEl('select');
          fieldBSelect.addClass('workout-select');
          if (allowed.length === 0) {
            fieldBSelect.createEl('option', { value: '', text: t('modal.statManager.selectField') });
          } else {
            for (const f of allowed) {
              const opt = fieldBSelect.createEl('option', { value: f, text: f });
              if (f === (this.builder as any).fieldB) opt.selected = true;
            }
          }
          fieldBSelect.addEventListener('change', () => { (this.builder as any).fieldB = fieldBSelect.value; });
        }
      }
    } else {
      // 表达式模式
      const ta = this.formulaContainer.createEl('textarea');
      ta.addClass('workout-input');
      ta.value = this.expression;
      ta.placeholder = t('modal.statManager.exprPlaceholder');
      ta.addEventListener('input', () => { this.expression = ta.value; this.updateExprError(allowed); });
      ta.addEventListener('blur', () => { this.updateExprError(allowed); });

      const hint = this.formulaContainer.createEl('p', { cls: 'workout-manager-detail' });
      hint.textContent = `${t('modal.statManager.allowedFields')}: ${allowed.length ? allowed.join(', ') : t('modal.statManager.none')}`;

      const errEl = this.formulaContainer.createEl('p', { cls: 'workout-manager-detail' });
      errEl.addClass('workout-stat-error');
      errEl.setCssStyles({ color: 'var(--text-error)' });
      (this.formulaContainer as any)._errEl = errEl;
      this.updateExprError(allowed);
    }

    // 预览
    const preview = this.formulaContainer.createEl('p', { cls: 'workout-manager-detail' });
    const exprStr = this.mode === 'builder' ? builderToExpr(this.builder) : this.expression;
    preview.textContent = `${t('modal.statManager.preview')}: ${exprStr || '-'}`;
  }

  private updateExprError(allowed: string[]): void {
    const errEl = (this.formulaContainer as any)?._errEl as HTMLElement | undefined;
    if (!errEl) return;
    if (this.mode !== 'expression' || !this.expression.trim()) {
      errEl.textContent = '';
      return;
    }
    try {
      validateExpression(this.expression, allowed);
      errEl.textContent = '';
    } catch (e) {
      errEl.textContent = `${t('modal.statManager.exprError')} ${(e as Error).message}`;
    }
  }

  private async save(): Promise<void> {
    const name = this.name.trim();
    if (!name) { new Notice(t('modal.stat.nameRequired')); return; }
    if (this.associatedTypes.length === 0) { new Notice(t('modal.stat.typesRequired')); return; }

    const allowed = this.allowed();
    let formula: StatDef['formula'];
    if (this.mode === 'builder') {
      if (this.builder.kind !== 'count') {
        // productSum 需要 fieldA + fieldB；oneRepMax 需要 weightField + repsField；其余（sum/avg/max/min）需要 field。
        const b = this.builder as any;
        const missing = this.builder.kind === 'productSum'
          ? !(b.fieldA && b.fieldB)
          : this.builder.kind === 'oneRepMax'
            ? !(b.weightField && b.repsField)
            : !b.field;
        if (missing) {
          new Notice(t('modal.stat.selectField'));
          return;
        }
      }
      formula = { mode: 'builder', builder: this.builder };
    } else {
      try {
        validateExpression(this.expression, allowed);
      } catch (e) {
        new Notice(`${t('modal.statManager.exprError')} ${(e as Error).message}`);
        return;
      }
      formula = { mode: 'expression', expression: this.expression };
    }

    const stat: StatDef = {
      id: this.options.editStat?.id ?? crypto.randomUUID(),
      name,
      associatedTypes: [...this.associatedTypes],
      formula,
      granularity: this.granularity,
      enabled: this.enabled,
    };

    const config = await this.dataManager.getConfig();
    if (this.options.editStat) {
      const idx = config.statistics.findIndex((s) => s.id === stat.id);
      if (idx !== -1) config.statistics[idx] = stat;
    } else {
      config.statistics.push(stat);
    }
    await this.dataManager.saveConfig(config);
    new Notice(t('modal.stat.saved'));
    this.close();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
