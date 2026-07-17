import { describe, expect, it } from 'vitest';
import { formatSvgMuscleLabel, SvgMuscleEntry } from './svgMuscleCatalog';

/*
 * svgMuscleCatalog 单元测试
 * 关键概念：
 *   - formatSvgMuscleLabel: 把目录中的 SVG 肌肉条目格式化为 UI 显示标签。
 *     同一块肌肉可能被 SVG 拆成多条 path（external_oblique_1_l..8_l、
 *     rectus_abdominis_1..4_r），函数需从 id 提取段号并追加左右标识，
 *     避免编辑肌肉弹窗里出现大量重名复选框。
 */

describe('formatSvgMuscleLabel', () => {
  it('distinguishes segmented abs paths in Chinese', () => {
    const oblique: SvgMuscleEntry = {
      id: 'external_oblique_1_l',
      side: 'front',
      fitnessGroup: 'abs',
      zh: '腹外斜肌',
      en: 'External Oblique',
    };
    expect(formatSvgMuscleLabel(oblique, 'zh')).toBe('腹外斜肌 1（左）');

    const obliqueRight: SvgMuscleEntry = {
      id: 'external_oblique_8_r',
      side: 'front',
      fitnessGroup: 'abs',
      zh: '腹外斜肌',
      en: 'External Oblique',
    };
    expect(formatSvgMuscleLabel(obliqueRight, 'zh')).toBe('腹外斜肌 8（右）');

    const rectusCenter: SvgMuscleEntry = {
      id: 'rectus_abdominis_1',
      side: 'front',
      fitnessGroup: 'abs',
      zh: '腹直肌',
      en: 'Rectus Abdominis',
    };
    expect(formatSvgMuscleLabel(rectusCenter, 'zh')).toBe('腹直肌 1');

    const rectusLeft: SvgMuscleEntry = {
      id: 'rectus_abdominis_2_l',
      side: 'front',
      fitnessGroup: 'abs',
      zh: '腹直肌',
      en: 'Rectus Abdominis',
    };
    expect(formatSvgMuscleLabel(rectusLeft, 'zh')).toBe('腹直肌 2（左）');
  });

  it('keeps non-segmented muscle labels concise in Chinese', () => {
    const chest: SvgMuscleEntry = {
      id: 'pectoralis_major_l',
      side: 'front',
      fitnessGroup: 'chest',
      zh: '胸大肌',
      en: 'Pectoralis Major',
    };
    expect(formatSvgMuscleLabel(chest, 'zh')).toBe('胸大肌（左）');
  });

  it('distinguishes segmented paths in English', () => {
    const oblique: SvgMuscleEntry = {
      id: 'external_oblique_1_l',
      side: 'front',
      fitnessGroup: 'abs',
      zh: '腹外斜肌',
      en: 'External Oblique',
    };
    expect(formatSvgMuscleLabel(oblique, 'en')).toBe('External Oblique 1 (L)');
  });
});
