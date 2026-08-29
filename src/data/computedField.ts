import { FieldDef, LogRow, WorkoutConfig } from './types';
import { evalFieldExpr } from './statExpr';

/*
 * computedField.ts —— 计算（派生）字段的「注入层」（纯函数，零 Obsidian 依赖）。
 *
 * 派生字段定义在训练类型的 fields 里（inputType='computed' + formula），但不落库。
 * 本文件把「按公式动态求出的值」注入到单条记录/记录集的 fields 上，
 * 供渲染（workoutLog 表格、RecordModal 预览）与统计（computeStat）统一消费——
 * 派生字段如同真实字段一样被读取，只是它永远随着源字段变化，杜绝「手填导致三者不一致」。
 */

/** 判断某字段是否为计算（派生）字段。 */
export function isComputedField(field: FieldDef): boolean {
  return field.inputType === 'computed';
}

/**
 * 把一条记录按「该训练类型的字段定义」注入全部计算字段值。
 * 公式引用同类型的其他字段 key；被引用字段若是另一个计算字段，需保证其已先注入
 * （本函数依赖调用方按字段定义顺序传递 fields，与 config 中定义顺序保持一致）。
 * 单字段求值失败（如除零/缺字段）时回退为 undefined，不抛错、不污染源记录。
 */
export function materializeLog(log: LogRow, fields: FieldDef[]): LogRow {
  const out: Record<string, unknown> = { ...log.fields };
  // 1) 字段 key 改名迁移：新 key 无值时按 legacyKeys 取旧值映射到新 key，并清理旧 key。
  //    这样统计/渲染/计算字段公式引用「新 key」也能读到历史数据（零迁移、向后兼容）。
  for (const field of fields) {
    if (field.legacyKeys && field.legacyKeys.length > 0) {
      if (out[field.key] === undefined) {
        for (const legacy of field.legacyKeys) {
          if (out[legacy] !== undefined) { out[field.key] = out[legacy]; break; }
        }
      }
      for (const legacy of field.legacyKeys) delete out[legacy];
    }
  }
  // 2) 注入计算字段：公式引用同类型其他字段 key，按字段定义顺序求值（保证被引计算字段已先注入）。
  for (const field of fields) {
    if (!isComputedField(field) || !field.formula) continue;
    try {
      out[field.key] = evalFieldExpr(field.formula, out);
    } catch {
      out[field.key] = undefined;
    }
  }
  return { ...log, fields: out };
}

/** 批量注入。 */
export function materializeLogs(logs: LogRow[], fields: FieldDef[]): LogRow[] {
  return logs.map((l) => materializeLog(l, fields));
}

/** 通过训练类型 id 取字段定义（用于在调用方不直接持有 fields 的地方查找）。 */
export function fieldsOfCategory(config: WorkoutConfig, category: string): FieldDef[] {
  return config.trainingTypes.find((t) => t.id === category)?.fields ?? [];
}