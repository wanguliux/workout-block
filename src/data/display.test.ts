import { beforeEach, describe, expect, it } from 'vitest';

/*
 * display.test.ts —— display.ts 单元测试
 * 重点覆盖：训练项显示名解析、多语言反向查找、记录字段格式化等纯函数逻辑。
 */

describe('display helpers', async () => {
  const { getDefaultConfig } = await import('./seed');
  const { setLocale } = await import('../i18n');
  const { resolveExerciseByName, resolveExerciseIdByName } = await import('./display');

  beforeEach(() => {
    // 每个用例前重置回中文，避免用例间语言状态互相影响
    setLocale('zh');
  });

  // 用例 L1：中文界面下，用中文名能解析到默认训练项
  it('L1: resolves default exercise by Chinese name in zh locale', () => {
    const config = getDefaultConfig();
    const exercise = resolveExerciseByName(config, '深蹲');
    expect(exercise?.id).toBe('squat');
    expect(resolveExerciseIdByName(config, '深蹲')).toBe('squat');
  });

  // 用例 L2：英文界面下，代码块里仍用中文名（未随语言切换）时，也能解析到默认训练项
  // 这是修复中英文切换后默认训练项查不到记录的关键回归点
  it('L2: resolves default exercise by Chinese name even in en locale', () => {
    setLocale('en');
    const config = getDefaultConfig();
    const exercise = resolveExerciseByName(config, '深蹲');
    expect(exercise?.id).toBe('squat');
    expect(resolveExerciseIdByName(config, '深蹲')).toBe('squat');
  });

  // 用例 L3：中文界面下，用英文名也应能解析到默认训练项
  it('L3: resolves default exercise by English name in zh locale', () => {
    const config = getDefaultConfig();
    expect(resolveExerciseByName(config, 'Squat')?.id).toBe('squat');
    expect(resolveExerciseIdByName(config, 'Bench Press')).toBe('bench_press');
  });

  // 用例 L4：自定义训练项（只有固定 name，没有 nameKey）按 name 匹配
  it('L4: resolves custom exercise by its plain name', () => {
    const config = getDefaultConfig();
    config.exercises.push({
      id: 'custom_test',
      name: '测试训练',
      category: 'strength',
    });
    setLocale('en');
    expect(resolveExerciseByName(config, '测试训练')?.id).toBe('custom_test');
  });

  // 用例 L5：按训练项 id 也能匹配
  it('L5: resolves exercise by its id', () => {
    const config = getDefaultConfig();
    expect(resolveExerciseByName(config, 'deadlift')?.id).toBe('deadlift');
  });

  // 用例 L6：计划时间的三种规则都渲染成可读文字（循环带周期与起始日）
  it('L6: formats date / weekday / cycle time rules', async () => {
    const { formatTimeRule } = await import('./display');
    expect(formatTimeRule({ type: 'date', date: '2026-11-13' })).toBe('2026-11-13');
    expect(formatTimeRule({ type: 'weekday', weekdays: [1, 3] })).toContain('一');
    expect(formatTimeRule({ type: 'cycle', cycleDays: 3, cycleStart: '2026-11-13' })).toBe(
      '每 3 天 · 自 2026-11-13 起'
    );
    setLocale('en');
    expect(formatTimeRule({ type: 'cycle', cycleDays: 3, cycleStart: '2026-11-13' })).toBe(
      '3-day cycle from 2026-11-13'
    );
  });
});
