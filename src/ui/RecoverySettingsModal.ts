/*
 * RecoverySettingsModal.ts —— 单块肌肉的「恢复曲线设置」弹窗。
 *
 * 从 `workout-recovery` 代码块右上角的设置按钮打开：看到曲线觉得不对，不必绕去
 * 设置 → 肌肉管理 → 编辑肌肉，就地调参数、就地看预览、保存后代码块自动重画。
 *
 * 表单与「编辑肌肉」页共用 recoveryTuningForm（同一份字段顺序与校验），
 * 预览与那边共用 recoveryPreview（固定坐标轴）。
 */

import { Modal, Notice } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { DEFAULT_RECOVERY_PARAMS, mergeRecoveryParams } from '../data/recovery';
import { Muscle, RecoveryTuning } from '../data/types';
import { getMuscleName } from '../data/display';
import { t } from '../i18n';
import { renderRecoveryPreview } from './recoveryPreview';
import { hasRecoveryTuning, renderRecoveryTuningForm } from './recoveryTuningForm';

export interface RecoverySettingsModalOptions {
  muscle: Muscle;
  /** 保存成功后的回调：代码块用它重画自己 */
  onSaved?: () => void;
}

export class RecoverySettingsModal extends Modal {
  private dataManager: DataManager;
  private options: RecoverySettingsModalOptions;
  private tuning: RecoveryTuning;
  private previewEl?: HTMLDivElement;

  constructor(dataManager: DataManager, options: RecoverySettingsModalOptions) {
    super(dataManager.app);
    this.dataManager = dataManager;
    this.options = options;
    // 草稿：取消即丢弃，不污染配置
    this.tuning = options.muscle.recovery ? { ...options.muscle.recovery } : {};
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('workout-edit-modal');
    contentEl.addClass('workout-recovery-settings-modal');

    contentEl.createEl('h2', {
      text: t('modal.recoverySettings.title', { name: getMuscleName(this.options.muscle) }),
    });

    renderRecoveryTuningForm(contentEl, this.tuning, () => this.renderPreview());

    this.previewEl = contentEl.createDiv();
    this.previewEl.addClass('workout-recovery-preview');
    this.renderPreview();

    const btnRow = contentEl.createDiv();
    btnRow.addClass('workout-btn-row');
    const cancelBtn = btnRow.createEl('button', { text: t('common.cancel') });
    cancelBtn.addClass('mod-muted');
    cancelBtn.addEventListener('click', () => this.close());
    const saveBtn = btnRow.createEl('button', { text: t('common.save') });
    saveBtn.addClass('mod-cta');
    saveBtn.addEventListener('click', () => {
      void this.save();
    });
  }

  private renderPreview(): void {
    if (!this.previewEl) return;
    renderRecoveryPreview(this.previewEl, mergeRecoveryParams(DEFAULT_RECOVERY_PARAMS, this.tuning));
  }

  private async save(): Promise<void> {
    // 全部留空 → 不写 recovery（回到「跟随默认」），而不是存一堆默认值进去
    const recovery = hasRecoveryTuning(this.tuning) ? { ...this.tuning } : undefined;
    try {
      await this.dataManager.updateMuscle(this.options.muscle.id, { recovery });
      new Notice(t('modal.muscleManager.saved'));
      this.close();
      this.options.onSaved?.();
    } catch (e) {
      console.error('[workout] 保存恢复曲线设置失败:', e);
      new Notice(t('modal.muscleManager.saveFailed'));
    }
  }
}
