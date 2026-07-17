import { describe, it, expect } from 'vitest';
import {
  computeStat,
  validateExpression,
  builderToExpr,
  exprToBuilder,
  allowedStatFields,
} from './statExpr';
import { StatDef, WorkoutConfig, LogRow } from './types';

// 构造一条最小 LogRow（computeStat 只用到 fields）
function log(fields: Record<string, unknown>): LogRow {
  return {
    id: 'log-id',
    timestamp: '2026-07-10 18:00',
    exerciseId: 'squat',
    category: 'strength',
    fields,
  };
}

const stat = (over: Partial<StatDef>): StatDef => ({
  id: 'st1',
  name: '测试统计',
  associatedTypes: ['strength'],
  formula: { mode: 'expression', expression: 'sum(reps * weight)' },
  granularity: 'daily',
  enabled: true,
  ...over,
});

describe('computeStat 计算', () => {
  const records = [log({ reps: 1, weight: 10 }), log({ reps: 3, weight: 20 }), log({ reps: 5, weight: 30 })];

  it('sum(reps * weight) = 训练量', () => {
    const s = stat({ formula: { mode: 'expression', expression: 'sum(reps * weight)' } });
    expect(computeStat(s, records)).toBe(1 * 10 + 3 * 20 + 5 * 30);
  });

  it('count() = 记录条数', () => {
    const s = stat({ formula: { mode: 'expression', expression: 'count()' } });
    expect(computeStat(s, records)).toBe(3);
  });

  it('avg(weight) = 平均值', () => {
    const s = stat({ formula: { mode: 'expression', expression: 'avg(weight)' } });
    expect(computeStat(s, records)).toBe((10 + 20 + 30) / 3);
  });

  it('max/min(weight) 取极值', () => {
    expect(computeStat(stat({ formula: { mode: 'expression', expression: 'max(weight)' } }), records)).toBe(30);
    expect(computeStat(stat({ formula: { mode: 'expression', expression: 'min(weight)' } }), records)).toBe(10);
  });

  it('builder 模式的乘积求和等价 sum(a*b)', () => {
    const s = stat({
      formula: { mode: 'builder', builder: { kind: 'productSum', fieldA: 'reps', fieldB: 'weight' } },
    });
    expect(computeStat(s, records)).toBe(1 * 10 + 3 * 20 + 5 * 30);
  });

  it('时长字段按秒数计算（保持可读与计算不冲突）', () => {
    const durRecords = [log({ duration_sec: 90 }), log({ duration_sec: 30 })];
    const s = stat({ formula: { mode: 'expression', expression: 'sum(duration_sec)' } });
    expect(computeStat(s, durRecords)).toBe(120);
  });

  it('缺失字段视为 0（不崩）', () => {
    const partial = [log({ reps: 2, weight: 10 }), log({ reps: 4 })];
    const s = stat({ formula: { mode: 'expression', expression: 'sum(reps * weight)' } });
    expect(computeStat(s, partial)).toBe(2 * 10 + 4 * 0);
  });

  it('非法表达式返回 NaN（渲染时兜底）', () => {
    const s = stat({ formula: { mode: 'expression', expression: 'sum((' } });
    expect(Number.isNaN(computeStat(s, records))).toBe(true);
  });
});

describe('validateExpression 校验', () => {
  it('合法表达式通过', () => {
    expect(() => validateExpression('sum(reps * weight)', ['reps', 'weight'])).not.toThrow();
    expect(() => validateExpression('count()', [])).not.toThrow();
    // 四则运算写在聚合函数内部（针对单条记录）即合法
    expect(() => validateExpression('sum(reps / 2)', ['reps'])).not.toThrow();
  });

  it('未授权字段报错', () => {
    expect(() => validateExpression('sum(reps)', ['weight'])).toThrow(/不在可用字段范围/);
  });

  it('未知函数报错', () => {
    expect(() => validateExpression('median(reps)', ['reps'])).toThrow(/未知函数/);
  });

  it('聚合函数嵌套报错', () => {
    expect(() => validateExpression('sum(sum(reps))', ['reps'])).toThrow(/不能嵌套/);
  });

  it('非聚合根节点报错', () => {
    expect(() => validateExpression('reps * weight', ['reps', 'weight'])).toThrow(/聚合函数/);
  });

  it('count 带参数报错', () => {
    expect(() => validateExpression('count(reps)', ['reps'])).toThrow();
  });
});

describe('builderToExpr / exprToBuilder 双向转换', () => {
  it('builder → expr', () => {
    expect(builderToExpr({ kind: 'sum', field: 'reps' })).toBe('sum(reps)');
    expect(builderToExpr({ kind: 'productSum', fieldA: 'reps', fieldB: 'weight' })).toBe('sum(reps * weight)');
    expect(builderToExpr({ kind: 'count' })).toBe('count()');
    expect(builderToExpr({ kind: 'avg', field: 'weight' })).toBe('avg(weight)');
  });

  it('expr → builder 匹配四种形状', () => {
    expect(exprToBuilder('sum(reps)')).toEqual({ kind: 'sum', field: 'reps' });
    expect(exprToBuilder('sum(reps * weight)')).toEqual({ kind: 'productSum', fieldA: 'reps', fieldB: 'weight' });
    expect(exprToBuilder('avg(weight)')).toEqual({ kind: 'avg', field: 'weight' });
    expect(exprToBuilder('count()')).toEqual({ kind: 'count' });
  });

  it('复杂嵌套表达式无法降维时返回 null', () => {
    expect(exprToBuilder('sum(reps) / count()')).toBeNull();
    expect(exprToBuilder('reps * weight')).toBeNull();
  });
});

describe('allowedStatFields 字段交集', () => {
  const config: WorkoutConfig = {
    version: 1,
    trainingTypes: [
      { id: 'strength', fields: [{ key: 'reps' }, { key: 'weight' }, { key: 'duration_sec' }] } as any,
      { id: 'cardio', fields: [{ key: 'distance' }, { key: 'duration_sec' }, { key: 'pace' }] } as any,
    ],
    exercises: [],
    muscles: [],
    statistics: [],
  };

  it('单类型返回其全部字段', () => {
    const s = stat({ associatedTypes: ['strength'] });
    expect(allowedStatFields(s, config).sort()).toEqual(['duration_sec', 'reps', 'weight']);
  });

  it('多类型取字段交集（如「时长」）', () => {
    const s = stat({ associatedTypes: ['strength', 'cardio'] });
    expect(allowedStatFields(s, config)).toEqual(['duration_sec']);
  });

  it('无交集类型返回空', () => {
    const s = stat({ associatedTypes: [] });
    expect(allowedStatFields(s, config)).toEqual([]);
  });
});
