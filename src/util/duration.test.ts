import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration, secondsToParts } from './duration';

/*
 * duration.test.ts —— 时长工具单测。
 * 重点覆盖 computed 派生值的小数秒场景（如配速 = duration_sec / distance = 346.15…秒），
 * 防回归：formatDuration/secondsToParts 必须对输入取整，不得透传小数（2026-09-13 改进清单 P1）。
 */

describe('formatDuration', () => {
  it('整数秒行为不变（回归保护）', () => {
    expect(formatDuration(75)).toBe('1分15秒');
    expect(formatDuration(60)).toBe('1分');
    expect(formatDuration(2314)).toBe('38分34秒');
    expect(formatDuration(3600)).toBe('1时');
  });

  it('computed 小数秒四舍五入到整数秒', () => {
    // 跑步配速实况：1800 秒 / 5.2 km = 346.1538…秒 → 5分46秒
    expect(formatDuration(346.15384615384613)).toBe('5分46秒');
    expect(formatDuration(346.4)).toBe('5分46秒');
    expect(formatDuration(346.5)).toBe('5分47秒'); // .5 进位
    expect(formatDuration(59.6)).toBe('1分'); // 进位后秒为 0，不显示 "0秒"
  });

  it('非正数与小数 0 返回 0秒', () => {
    expect(formatDuration(0.4)).toBe('0秒');
    expect(formatDuration(-3.2)).toBe('0秒');
  });
});

describe('secondsToParts', () => {
  it('整数秒拆分不变', () => {
    expect(secondsToParts(3723)).toEqual({ hours: 1, minutes: 2, seconds: 3 });
  });

  it('小数秒取整后拆分（编辑回填不出小数输入值）', () => {
    expect(secondsToParts(346.15)).toEqual({ hours: 0, minutes: 5, seconds: 46 });
    expect(secondsToParts(59.9)).toEqual({ hours: 0, minutes: 1, seconds: 0 });
  });
});

describe('parseDuration', () => {
  it('与 formatDuration 互逆（整数秒往返）', () => {
    expect(parseDuration(0, 5, 46)).toBe(346);
    expect(formatDuration(parseDuration(0, 38, 34))).toBe('38分34秒');
  });
});
