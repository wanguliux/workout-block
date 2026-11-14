/*
 * recoveryTuningForm.ts —— 「恢复曲线参数」表单（七个数字）+ 共用口径。
 *
 * 两处用它：编辑肌肉页的「恢复曲线设置」折叠区，以及代码块设置按钮打开的
 * RecoverySettingsModal。抽出来是为了两处**永远同一份字段顺序、同一套校验**——
 * 复制两份的话，将来加参数只改一处、另一处就悄悄少一项。
 *
 * 口径：
 *   - 留空＝跟随默认（不写进配置），非法值（0 / 负数 / NaN）也视为留空；
 *   - 「消退深度」在界面上显示成它反面的「运动前水平」= 100 − 深度，
 *     因为用户看图看的是那条黄线在哪，而不是「深度是多少」。
 */

import { DEFAULT_RECOVERY_PARAMS } from '../data/recovery';
import { RecoveryTuning } from '../data/types';
import { t } from '../i18n';
import { parseNumberInput } from '../util/number';

/** 可在表单里编辑的七个数值参数（RecoveryTuning 中除 levels 之外的字段）。 */
export type NumericTuningKey =
  | 'fatiguePerSet'
  | 'fatigueTau'
  | 'fitnessPerSet'
  | 'fitnessTau'
  | 'detrainDepth'
  | 'detrainTau'
  | 'detrainRef';

export interface RecoveryTuningField {
  key: NumericTuningKey;
  label: string;
  def: number;
  /** 允许 0（如消退深度 0 ＝ 关掉消退） */
  allowZero?: boolean;
  /** 显示与存盘做反转：显示值 = invert − 存储值（运动前水平 = 100 − 消退深度） */
  invert?: number;
}

/** 字段清单（顺序即界面顺序）：前四个＝急性，后三个＝长期消退。 */
export function recoveryTuningFields(): RecoveryTuningField[] {
  return [
    { key: 'fatiguePerSet', label: t('modal.muscleManager.recoveryFatiguePerSet'), def: DEFAULT_RECOVERY_PARAMS.fatiguePerSet },
    { key: 'fatigueTau', label: t('modal.muscleManager.recoveryFatigueTau'), def: DEFAULT_RECOVERY_PARAMS.fatigueTau },
    { key: 'fitnessPerSet', label: t('modal.muscleManager.recoveryFitnessPerSet'), def: DEFAULT_RECOVERY_PARAMS.fitnessPerSet },
    { key: 'fitnessTau', label: t('modal.muscleManager.recoveryFitnessTau'), def: DEFAULT_RECOVERY_PARAMS.fitnessTau },
    {
      key: 'detrainDepth',
      label: t('modal.muscleManager.recoveryFloorLevel'),
      def: DEFAULT_RECOVERY_PARAMS.detrainDepth,
      invert: DEFAULT_RECOVERY_PARAMS.baseline,
    },
    { key: 'detrainTau', label: t('modal.muscleManager.recoveryDetrainTau'), def: DEFAULT_RECOVERY_PARAMS.detrainTau },
    { key: 'detrainRef', label: t('modal.muscleManager.recoveryDetrainRef'), def: DEFAULT_RECOVERY_PARAMS.detrainRef },
  ];
}

/** 有任何一个参数被覆盖（用于决定存盘时写不写 recovery）。 */
export function hasRecoveryTuning(tuning: RecoveryTuning): boolean {
  return recoveryTuningFields().some((f) => typeof tuning[f.key] === 'number');
}

/**
 * 渲染两列表单，直接改写传入的 tuning 对象（调用方传的是自己的草稿）。
 * onChange 在每次输入后触发——编辑器用它重画预览。
 */
export function renderRecoveryTuningForm(
  container: HTMLElement,
  tuning: RecoveryTuning,
  onChange?: () => void
): void {
  const grid = container.createDiv();
  grid.addClass('workout-two-col');

  for (const field of recoveryTuningFields()) {
    const row = grid.createDiv();
    row.addClass('workout-field');
    row.createEl('label', { text: field.label });

    const input = row.createEl('input', { type: 'number' });
    input.addClass('workout-input');
    input.setAttribute('step', 'any');
    input.setAttribute('inputmode', 'decimal'); // 移动端弹小数键盘

    const toDisplay = (stored: number): number => (field.invert ? field.invert - stored : stored);
    const current = tuning[field.key];
    input.value = typeof current === 'number' ? String(toDisplay(current)) : '';
    input.placeholder = String(toDisplay(field.def));

    input.addEventListener('input', () => {
      const v = parseNumberInput(input.value);
      // 反转字段（运动前水平）：允许 100（= 深度 0，关掉消退），但不允许超过 100
      const valid =
        v !== undefined && (field.invert ? v < field.invert : field.allowZero ? v >= 0 : v > 0);
      if (!valid) {
        delete tuning[field.key];
      } else {
        tuning[field.key] = field.invert ? field.invert - v : v;
      }
      onChange?.();
    });
  }
}
