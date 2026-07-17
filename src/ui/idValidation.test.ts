import { describe, it, expect } from 'vitest';
import { INVALID_ID_RE, isInvalidId } from './idValidation';

describe('idValidation', () => {
  it('合法 ID 不报错（含中文、下划线、大小写）', () => {
    expect(isInvalidId('squat')).toBe(false);
    expect(isInvalidId('罗马尼亚_硬拉')).toBe(false);
    expect(isInvalidId('Leg_Press')).toBe(false);
    expect(INVALID_ID_RE.test('ok_id')).toBe(false);
  });

  it('含逗号 / 双引号 / 换行 判定为非法', () => {
    expect(isInvalidId('a,b')).toBe(true);
    expect(isInvalidId('a"b')).toBe(true);
    expect(isInvalidId('a\nb')).toBe(true);
    expect(isInvalidId('a\rb')).toBe(true);
  });

  it('空格不算非法（保存时会归一为下划线）', () => {
    expect(isInvalidId('leg press')).toBe(false);
  });
});
