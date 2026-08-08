import { PlanItem, TimeRule, TrainingPlanInstance, WorkoutConfig } from '../data/types';
import { generateId } from '../util/id';
import { assertDate, todayStr } from './core';
import { CliError } from './errors';

/*
 * planOps.ts —— 训练计划写入面的纯领域操作（零 fs）。
 *
 * 语义对齐 NewPlanModal.save / DataManager.upsertPlan：
 *  - 计划名全局唯一（编辑时排除自身）；
 *  - 至少一个启用训练项；weekday 规则空选回退 [1]；
 *  - items 只保留启用项、每组带稳定 setId；
 *  - 更新按 id 匹配（改名不断联），completedSets 在更新中保留。
 * 改名后的代码块级联扫描在命令层做（需要 fs）。
 */

export interface PlanItemInput {
  exerciseId: string;
  category?: string;              // 缺省按训练项推导
  enabled?: boolean;              // 缺省 true
  sets?: { id?: string; fields?: Record<string, unknown> }[]; // 缺省一组空预设
}

/** 解析 --items-json 并校验：训练项必须存在，setId 缺省自动生成。 */
export function parseItemsJson(json: string, config: WorkoutConfig): PlanItem[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new CliError(`--items-json 不是合法 JSON：${(e as Error).message}`);
  }
  if (!Array.isArray(raw)) throw new CliError('--items-json 必须是训练项数组');
  return buildPlanItems(config, raw as PlanItemInput[]);
}

/** 由方案笔记提取结果构造初始 items（每项一组空预设，镜像 NewPlanModal 初始化）。 */
export function itemsFromScheme(extracted: { exerciseId: string; category: string }[]): PlanItemInput[] {
  return extracted.map((e) => ({ exerciseId: e.exerciseId, category: e.category }));
}

export function buildPlanItems(config: WorkoutConfig, inputs: PlanItemInput[]): PlanItem[] {
  if (inputs.length === 0) throw new CliError('计划至少需要一个训练项');
  return inputs.map((input, i) => {
    const exercise = config.exercises.find((e) => e.id === input.exerciseId);
    if (!exercise) {
      throw new CliError(`items[${i}].exerciseId "${input.exerciseId}" 不存在于配置`);
    }
    const category = input.category ?? exercise.category;
    const sets = (input.sets && input.sets.length > 0 ? input.sets : [{}]).map((s) => ({
      id: s.id || generateId(),
      fields: { ...(s.fields ?? {}) },
    }));
    return {
      exerciseId: exercise.id,
      category,
      enabled: input.enabled ?? true,
      sets,
    };
  });
}

/** 构造时间规则：--date 与 --weekdays 二选一。 */
export function buildTimeRule(date?: string, weekdays?: string): TimeRule {
  if (date && weekdays) throw new CliError('--date 与 --weekdays 只能二选一');
  if (weekdays) {
    const days = weekdays.split(',').map((x) => parseInt(x.trim(), 10));
    if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
      throw new CliError(`--weekdays 需要 1..7 的 ISO 周几（周一=1），收到 "${weekdays}"`);
    }
    return { type: 'weekday', weekdays: Array.from(new Set(days)).sort((a, b) => a - b) };
  }
  return { type: 'date', date: date ? assertDate(date) : todayStr() };
}

export interface PlanBuildInput {
  name: string;
  timeRule: TimeRule;
  sourceNote?: string;
  items: PlanItem[];
}

function assertPlanNameFree(config: WorkoutConfig, name: string, exceptId?: string): void {
  if ((config.plans ?? []).some((p) => p.name === name && p.id !== exceptId)) {
    throw new CliError(`计划名 "${name}" 已被占用`);
  }
}

export function buildPlan(config: WorkoutConfig, input: PlanBuildInput): TrainingPlanInstance {
  const name = input.name.trim();
  if (!name) throw new CliError('计划缺少名称');
  assertPlanNameFree(config, name);
  const enabled = input.items.filter((i) => i.enabled);
  if (enabled.length === 0) throw new CliError('计划至少需要一个启用的训练项');
  const timeRule: TimeRule = { ...input.timeRule };
  if (timeRule.type === 'weekday' && (!timeRule.weekdays || timeRule.weekdays.length === 0)) {
    timeRule.weekdays = [1]; // 与 NewPlanModal.save 一致的空选回退
  }
  return {
    id: generateId(),
    name,
    timeRule,
    sourceNote: input.sourceNote,
    createdAt: todayStr(),
    items: enabled.map((i) => ({ ...i, enabled: true, sets: i.sets.map((s) => ({ id: s.id, fields: { ...s.fields } })) })),
  };
}

export interface PlanPatch {
  plan: string;                    // 名称或 id
  newName?: string;
  timeRule?: TimeRule;
  items?: PlanItem[];              // 传入即整体替换（enabled 过滤同 buildPlan）
}

/** 更新计划（按 id 匹配；completedSets 保留）。返回旧名供改名级联。 */
export function applyPlanUpdate(
  config: WorkoutConfig,
  patch: PlanPatch
): { plan: TrainingPlanInstance; oldName: string; nameChanged: boolean } {
  if (!config.plans) config.plans = [];
  const lower = patch.plan.toLowerCase();
  const target = config.plans.find((p) => p.name === patch.plan || p.id === patch.plan || p.name.toLowerCase() === lower);
  if (!target) {
    const names = config.plans.map((p) => p.name).join('、');
    throw new CliError(`找不到训练计划 "${patch.plan}"（现有：${names || '无'}）`);
  }

  const next: TrainingPlanInstance = { ...target, items: target.items.map((i) => ({ ...i, sets: i.sets.map((s) => ({ ...s, fields: { ...s.fields } })) })) };
  if (patch.newName !== undefined) {
    const name = patch.newName.trim();
    if (!name) throw new CliError('计划名不能为空');
    assertPlanNameFree(config, name, target.id);
    next.name = name;
  }
  if (patch.timeRule !== undefined) next.timeRule = { ...patch.timeRule };
  if (patch.items !== undefined) {
    const enabled = patch.items.filter((i) => i.enabled);
    if (enabled.length === 0) throw new CliError('计划至少需要一个启用的训练项');
    next.items = enabled.map((i) => ({ ...i, enabled: true }));
  }

  const oldName = target.name;
  const idx = config.plans.findIndex((p) => p.id === target.id);
  config.plans[idx] = next;
  return { plan: next, oldName, nameChanged: oldName !== next.name };
}

/** 删除计划（按名称或 id；不影响 CSV 记录，镜像 DataManager.deletePlan）。 */
export function applyPlanDelete(config: WorkoutConfig, nameOrId: string): TrainingPlanInstance {
  const plans = config.plans ?? [];
  const target = plans.find((p) => p.name === nameOrId || p.id === nameOrId);
  if (!target) {
    const names = plans.map((p) => p.name).join('、');
    throw new CliError(`找不到训练计划 "${nameOrId}"（现有：${names || '无'}）`);
  }
  config.plans = plans.filter((p) => p.id !== target.id);
  return target;
}

/**
 * 改写一段笔记文本里 workout-plan 代码块的 plan 参数（oldName → newName）。
 * 规则与 DataManager.renamePlanInCodeBlocks 完全一致：
 * 每个 ```workout-plan 代码块只处理第一个 plan: 参数行；命中才返回新文本。
 */
export function rewritePlanReferences(content: string, oldName: string, newName: string): { content: string; updated: number } {
  const lines = content.split('\n');
  let updated = 0;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim().startsWith('```workout-plan')) {
      let j = i + 1;
      let closing = -1;
      while (j < lines.length) {
        if (lines[j].trim().startsWith('```')) { closing = j; break; }
        const trimmed = lines[j].trim();
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
          const key = trimmed.slice(0, colonIdx).trim();
          if (key === 'plan') {
            const val = trimmed.slice(colonIdx + 1).trim();
            if (val === oldName) {
              lines[j] = 'plan: ' + newName;
              updated++;
            }
            break; // 只处理第一个 plan: 参数
          }
        }
        j++;
      }
      i = closing >= 0 ? closing + 1 : lines.length;
    } else {
      i++;
    }
  }
  return { content: updated > 0 ? lines.join('\n') : content, updated };
}
