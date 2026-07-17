import { Modal, Notice } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { getTrainingTypeName } from '../data/display';
import { TrainingType, FieldDef } from '../data/types';
import { t } from '../i18n';
import { INVALID_ID_RE, isInvalidId } from './idValidation';

/*
 * TypeModal.ts —— "新建/编辑训练类型"弹窗
 * 训练类型定义了"记录一组时会出现哪些字段"。本弹窗让用户填类型名，
 * 并提供"动态增删字段"的能力：每个字段有 字段键(key)/标签(label)/
 * 输入类型(inputType)/单位(unit)/选项(options) 五项，可任意增删。
 * 编辑模式下会从已有类型拷贝一份字段，避免直接改动原始配置；
 * 删除字段按钮会同时从内部数组移除并整体重渲染，保证数组与界面一致。
 */
interface TypeModalOptions {
  editType?: TrainingType; // 要编辑的训练类型；省略则为新建模式
}

export class TypeModal extends Modal {
  private dataManager: DataManager;
  private options: TypeModalOptions;
  private nameInput!: HTMLInputElement;
  private idInput!: HTMLInputElement;    // 可编辑的类别 ID（留空则保存时按类型名称推导）
  private idHint!: HTMLDivElement;        // ID 非法字符提示（默认隐藏，触发时闪现）
  private idHintTimer: number | null = null; // 提示自动隐藏的计时器
  private fieldsContainer!: HTMLDivElement;
  private fields: FieldDef[] = []; // 当前正在编辑的字段数组

  constructor(dataManager: DataManager, options: TypeModalOptions = {}) {
    super(dataManager.app);
    this.dataManager = dataManager;
    this.options = options;
    // 编辑模式：拷贝一份已有字段的浅副本，后续改动只作用于副本，保存时才写回
    if (options.editType?.fields && Array.isArray(options.editType.fields)) {
      this.fields = options.editType.fields.map(f => ({ ...f }));
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('workout-edit-modal');

    // 标题：编辑模式用"编辑训练类型"文案
    contentEl.createEl('h2', { text: this.options.editType ? t('modal.newType.editTitle') : t('modal.newType.title') });

    // 两列网格：类型名称 + 类别 ID（对齐重设计稿的两列布局）
    const nameIdCol = contentEl.createDiv();
    nameIdCol.addClass('workout-two-col');

    // 类型名行：编辑时预填已有名称
    const nameRow = nameIdCol.createDiv();
    nameRow.addClass('workout-field');
    nameRow.createEl('label', { text: t('modal.newType.name') });
    this.nameInput = nameRow.createEl('input', { type: 'text' });
    this.nameInput.addClass('workout-input');
    if (this.options.editType) {
      this.nameInput.value = getTrainingTypeName(this.options.editType);
    }

    // 类别 ID 行：可编辑文本框。留空时保存会自动按类型名称推导；
    // 编辑模式下预填当前 id，用户改了它则会级联更新所有关联（记录/训练项/统计）。
    const idRow = nameIdCol.createDiv();
    idRow.addClass('workout-field');
    idRow.createEl('label', { text: t('modal.newType.id') });
    this.idInput = idRow.createEl('input', { type: 'text', placeholder: t('modal.newType.idPlaceholder') });
    this.idInput.addClass('workout-input');
    if (this.options.editType) {
      this.idInput.value = this.options.editType.id;
    }

    // 轻量实时校验：ID 不能含逗号/引号/换行（会破坏 CSV 单元格与键引用）。
    // beforeinput 阶段直接拦截非法字符（光标不跳），input 阶段再兜底 strip（覆盖粘贴）。
    this.idHint = contentEl.createEl('div', { cls: 'workout-id-hint' });
    this.idInput.addEventListener('beforeinput', (e: Event) => {
      const data = (e as InputEvent).data ?? '';
      if (data && INVALID_ID_RE.test(data)) {
        e.preventDefault();
        this.flashIdHint('modal.newType.idInvalid');
      }
    });
    this.idInput.addEventListener('input', () => {
      const v = this.idInput.value;
      if (INVALID_ID_RE.test(v)) {
        this.idInput.value = v.replace(INVALID_ID_RE, '');
        this.flashIdHint('modal.newType.idInvalid');
      }
    });

    // 字段列表标题
    contentEl.createEl('h3', { text: t('modal.newType.fields'), cls: 'workout-section-title' });

    // 字段容器：所有字段行渲染在这里
    this.fieldsContainer = contentEl.createDiv();
    this.fieldsContainer.addClass('workout-fields-list');

    // 初始渲染已有的字段（新建模式可能为空）
    this.renderAllFields();

    // "添加字段"按钮：往数组 push 一个默认字段，再整体重渲染
    const addFieldBtn = contentEl.createEl('button', { text: t('modal.newType.addField') });
    addFieldBtn.addClass('mod-cta');
    addFieldBtn.addEventListener('click', () => {
      this.fields.push({
        key: '',
        label: '',
        inputType: 'number',
      });
      this.renderAllFields();
    });

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

  // 渲染所有字段行：没有字段时显示提示文案；否则逐个用 buildFieldRow 生成并挂载。
  private renderAllFields(): void {
    this.fieldsContainer.empty();

    if (this.fields.length === 0) {
      this.fieldsContainer.createEl('p', { text: t('settings.noFields') });
      return;
    }

    for (let i = 0; i < this.fields.length; i++) {
      this.fieldsContainer.appendChild(this.buildFieldRow(i));
    }
  }

  // 构建单条字段行（index 对应 fields 数组下标）。返回挂载好的 DOM 元素，由 renderAllFields 统一挂载，
  // 切换输入类型时也能用新元素 replaceWith 整行重渲染，保证单位/选项列随类型正确显隐。
  private buildFieldRow(index: number): HTMLDivElement {
    const field = this.fields[index];
    const card = document.createElement('div') as HTMLDivElement;
    card.addClass('workout-field-card');

    // 头部：序号徽标 + 删除按钮（上方保持简洁，字段详情在下方输入框中）
    const header = card.createDiv();
    header.addClass('workout-field-card-header');
    const titleWrap = header.createDiv();
    titleWrap.addClass('workout-field-card-title');
    const badge = titleWrap.createEl('span');
    badge.addClass('workout-field-card-badge');
    badge.setText(String(index + 1));
    const removeBtn = header.createEl('button', { text: t('modal.newType.removeField') });
    removeBtn.addClass('workout-danger-btn');
    removeBtn.addEventListener('click', () => {
      this.fields.splice(index, 1); // 从内部数组移除该字段
      this.renderAllFields();       // 重新渲染整列，保证下标与界面同步
    });

    // 主体：两列网格（字段键 / 标签 / 输入类型 / 单位）
    const body = card.createDiv();
    body.addClass('workout-field-card-body');

    // 第 1 列：字段键(key)——代码中引用的标识符
    const col1 = body.createDiv();
    col1.addClass('workout-field');
    col1.createEl('label', { text: t('modal.newType.fieldKey') });
    const keyInput = col1.createEl('input', { type: 'text', placeholder: 'field_key' });
    keyInput.addClass('workout-input');
    keyInput.value = field.key;
    keyInput.addEventListener('change', () => {
      this.fields[index].key = keyInput.value.trim();
    });

    // 第 2 列：标签(label)——界面上显示给用户看的名称
    const col2 = body.createDiv();
    col2.addClass('workout-field');
    col2.createEl('label', { text: t('modal.newType.fieldLabel') });
    const labelInput = col2.createEl('input', { type: 'text', placeholder: t('modal.newType.fieldLabel') });
    labelInput.addClass('workout-input');
    labelInput.value = field.label || '';
    labelInput.addEventListener('change', () => {
      this.fields[index].label = labelInput.value;
    });

    // 第 3 列：输入类型(inputType)——数字/时长/文本/下拉选择（随语言切换显示）
    const col3 = body.createDiv();
    col3.addClass('workout-field');
    col3.createEl('label', { text: t('modal.newType.inputType') });
    const inputTypeSelect = col3.createEl('select');
    inputTypeSelect.addClass('workout-select');
    const inputTypes: FieldDef['inputType'][] = ['number', 'duration', 'text', 'select'];
    for (const type of inputTypes) {
      const option = inputTypeSelect.createEl('option', {
        value: type,
        text: t(`fieldInputType.${type}`),
      });
      if (field.inputType === type) {
        option.selected = true;
      }
    }

    // 第 4 列：单位——仅"数字"类型出现。三选一下拉（随语言切换）：
    //   无（默认，不显示单位）/ 质量（自动参与 kg/lb 换算）/ 自定义（自由填写单位文字）。
    if (field.inputType === 'number') {
      const col4 = body.createDiv();
      col4.addClass('workout-field');
      col4.createEl('label', { text: t('modal.newType.unit') });
      const unitSelect = col4.createEl('select');
      unitSelect.addClass('workout-select');
      const unitOptions: { value: string; key: string }[] = [
        { value: '', key: 'fieldUnit.none' },
        { value: 'mass', key: 'fieldUnit.mass' },
        { value: 'custom', key: 'fieldUnit.custom' },
      ];
      // 当前选中的档位：mass 优先、其次自定义(有 unitLabel)、否则无
      let currentUnit: 'none' | 'mass' | 'custom' = 'none';
      if (field.mass) currentUnit = 'mass';
      else if (field.unitLabel) currentUnit = 'custom';
      for (const opt of unitOptions) {
        const option = unitSelect.createEl('option', {
          value: opt.value,
          text: t(opt.key),
        });
        if (currentUnit === (opt.value === '' ? 'none' : opt.value)) {
          option.selected = true;
        }
      }

      // 选「自定义」时才出现的单位文字输入框（如"层""圈""公里"），放在卡片底部虚线区
      const cond = card.createDiv();
      cond.addClass('workout-field-card-cond');
      const customWrap = cond.createDiv();
      customWrap.addClass('workout-field', 'workout-custom-unit');
      customWrap.createEl('label', { text: t('modal.newType.customUnit') });
      const customUnitInput = customWrap.createEl('input', {
        type: 'text',
        placeholder: t('modal.newType.customUnit'),
      });
      customUnitInput.addClass('workout-input');
      customUnitInput.value = field.unitLabel || '';
      if (currentUnit === 'custom') {
        customWrap.addClass('is-custom');
      }
      customUnitInput.addEventListener('change', () => {
        this.fields[index].unitLabel = customUnitInput.value.trim() || undefined;
      });

      unitSelect.addEventListener('change', () => {
        const v = unitSelect.value;
        if (v === 'mass') {
          // 质量：自动换算，清空自定义文字并隐藏单位输入框
          this.fields[index].mass = true;
          this.fields[index].unitLabel = undefined;
          customWrap.removeClass('is-custom');
          customUnitInput.value = '';
        } else if (v === 'custom') {
          // 自定义：关闭质量换算，显示单位文字输入框
          this.fields[index].mass = false;
          customWrap.addClass('is-custom');
        } else {
          // 无：都不设
          this.fields[index].mass = false;
          this.fields[index].unitLabel = undefined;
          customWrap.removeClass('is-custom');
          customUnitInput.value = '';
        }
      });
    }

    // 选项(options)——仅"下拉选择"类型出现，逗号分隔；解析回字符串数组
    if (field.inputType === 'select') {
      const cond = card.createDiv();
      cond.addClass('workout-field-card-cond');
      const optWrap = cond.createDiv();
      optWrap.addClass('workout-field');
      optWrap.createEl('label', { text: t('modal.newType.options') });
      const optionsInput = optWrap.createEl('input', { type: 'text', placeholder: t('modal.newType.optionsPlaceholder') });
      optionsInput.addClass('workout-input');
      optionsInput.value = field.options ? field.options.join(', ') : '';
      optionsInput.addEventListener('change', () => {
        // 把逗号分隔文本拆成去空白、去空的字符串数组；为空则置 undefined
        const vals = optionsInput.value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        this.fields[index].options = vals.length > 0 ? vals : undefined;
      });
    }

    // 输入类型切换：先写回，再整卡重渲染，让单位/选项区按新类型正确显隐
    inputTypeSelect.addEventListener('change', () => {
      this.fields[index].inputType = inputTypeSelect.value as FieldDef['inputType'];
      card.replaceWith(this.buildFieldRow(index));
    });

    return card;
  }

  // 保存：校验类型名、至少 1 个有效字段（有 key 且 label 或 labelKey），再新增或更新训练类型。
  // 类别 ID：输入框留空时按「类型名称」自动推导；非空时以用户输入为准（空格转下划线）。
  // 编辑模式下若改了 ID，则级联更新数据库里所有关联该 ID 的记录 / 训练项 / 统计。
  private async save(): Promise<void> {
    const name = this.nameInput.value.trim();
    if (!name) {
      new Notice(t('modal.newType.nameRequired'));
      return;
    }

    // 计算最终 ID：用户输入优先（空格→下划线，保留大小写）；留空则按类型名称推导。
    // 两路都额外 strip 掉非法字符（逗号/引号/换行），即使从名称推导也保证 CSV 安全。
    const idValue = this.idInput.value.trim();
    const finalId = (idValue || name.toLowerCase())
      .replace(/\s+/g, '_')
      .replace(INVALID_ID_RE, '');

    // 兜底：万一仍含非法字符（理论上已被实时校验拦截），直接拦下保存。
    if (isInvalidId(finalId)) {
      new Notice(t('modal.newType.idInvalid'));
      return;
    }

    // 防重复：新建时与全部已有 id 比对；编辑时排除自身旧 id，仅当改成了别人的 id 才拦截。
    const config = await this.dataManager.getConfig();
    const exists = config.trainingTypes.some(
      (t) => t.id === finalId && t.id !== this.options.editType?.id
    );
    if (exists) {
      new Notice(t('modal.newType.idDuplicate'));
      return;
    }

    const validFields = this.fields.filter((f) => f.key && (f.label || f.labelKey));
    if (validFields.length === 0) {
      new Notice(t('settings.atLeastOneField'));
      return;
    }

    try {
      const updates: Partial<TrainingType> = {
        name,
        fields: validFields,
      };
      if (this.options.editType) {
        const oldId = this.options.editType.id;
        if (finalId !== oldId) {
          // ID 变了：级联改写配置里的 id + 所有关联的记录/训练项/统计
          await this.dataManager.renameTrainingType(oldId, finalId, updates);
        } else {
          // ID 没变：普通更新
          await this.dataManager.updateTrainingType(oldId, updates);
        }
        new Notice(t('modal.newType.saved'));
      } else {
        // 新建模式：写入自定义 ID（用户输入或按类型名称推导），参与覆盖统计
        await this.dataManager.addTrainingType({
          id: finalId,
          nameKey: undefined,
          name,
          fields: validFields,
          contributesToCoverage: true,
        });
        new Notice(t('modal.newType.saved'));
      }
      this.close();
    } catch (error) {
      new Notice(t('modal.newType.saveFailed'));
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
