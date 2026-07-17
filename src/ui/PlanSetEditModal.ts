import { Modal, Notice } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { FieldDef, TrainingType } from '../data/types';
import { getFieldLabel, getFieldUnit } from '../data/display';
import { t } from '../i18n';
import { secondsToParts, parseDuration } from '../util/duration';
import { formatMass, parseMass } from '../util/units';

/*
 * PlanSetEditModal.ts —— 训练计划代码块里「编辑」单组时弹出的小窗。
 * 复用「编辑训练记录」界面的同一套字段渲染（数字/时长/文本/下拉），
 * 但这里是「计划记录」而非实际记录：保存只把改动写到计划预设（workout-config.json），
 * 或由调用方决定是否回写 CSV（已完成组）。训练记录时间字段不出现（由「完成」写入）。
 */
export interface PlanSetEditOptions {
  exerciseId: string;
  category: string;
  title: string;                       // 如「编辑 · 卧推 · 第 1 组」
  initialFields: Record<string, unknown>;
  onSave: (fields: Record<string, unknown>) => Promise<void> | void;
}

export class PlanSetEditModal extends Modal {
  private dataManager: DataManager;
  private options: PlanSetEditOptions;
  private trainingTypes: TrainingType[] = [];
  private fieldValues: Record<string, unknown> = {};
  private fieldsContainer!: HTMLDivElement;

  constructor(dataManager: DataManager, options: PlanSetEditOptions) {
    super(dataManager.app);
    this.dataManager = dataManager;
    this.options = options;
    this.fieldValues = { ...options.initialFields };
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('workout-edit-modal');

    const config = await this.dataManager.getConfig();
    this.trainingTypes = config.trainingTypes;

    contentEl.createEl('h2', { text: this.options.title });

    this.fieldsContainer = contentEl.createDiv();
    this.fieldsContainer.addClass('workout-fields');
    this.renderFields();

    const btnRow = contentEl.createDiv();
    btnRow.addClass('workout-btn-row');
    const cancelBtn = btnRow.createEl('button', { text: t('common.cancel') });
    cancelBtn.addClass('mod-muted');
    cancelBtn.addEventListener('click', () => this.close());
    const saveBtn = btnRow.createEl('button', { text: t('common.save') });
    saveBtn.addClass('mod-cta');
    saveBtn.addEventListener('click', () => this.save());
  }

  // 与 RecordModal.renderFields 一致的字段渲染（不渲染时间/计划字段）
  private renderFields(): void {
    this.fieldsContainer.empty();
    const type = this.trainingTypes.find((tt) => tt.id === this.options.category);
    if (!type) return;
    const unit = this.dataManager.getSettings().unit;

    for (const field of type.fields) {
      const fieldRow = this.fieldsContainer.createDiv();
      fieldRow.addClass('workout-field');
      const unitText = getFieldUnit(field, unit);
      fieldRow.createEl('label', { text: `${getFieldLabel(field)}${unitText ? ` (${unitText})` : ''}` });
      const value = this.fieldValues[field.key];
      const placeholderText = `${t('modal.recordSet.inputPlaceholder')}${getFieldLabel(field)}`;

      switch (field.inputType) {
        case 'number': {
          const num = fieldRow.createEl('input', { type: 'number' });
          num.addClass('workout-input');
          num.setAttribute('step', 'any');
          num.setAttribute('inputmode', 'decimal');
          num.placeholder = placeholderText;
          if (field.mass) {
            num.value = value != null ? formatMass(Number(value), unit) : '';
            num.addEventListener('change', () => {
              this.fieldValues[field.key] = parseMass(num.value, unit);
            });
          } else {
            num.value = value != null ? String(value) : '';
            num.addEventListener('change', () => {
              this.fieldValues[field.key] = parseFloat(num.value);
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
            this.fieldValues[field.key] = parseDuration(
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
          txt.placeholder = placeholderText;
          txt.value = value != null ? String(value) : '';
          txt.addEventListener('change', () => {
            this.fieldValues[field.key] = txt.value;
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
          if (value == null && opts.length > 0) this.fieldValues[field.key] = sel.value;
          sel.addEventListener('change', () => {
            this.fieldValues[field.key] = sel.value;
          });
          break;
        }
      }
    }
  }

  private async save(): Promise<void> {
    try {
      await this.options.onSave(this.fieldValues);
      new Notice(t('modal.newPlan.setSaved'));
      this.close();
    } catch {
      new Notice(t('modal.newPlan.saveFailed'));
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
