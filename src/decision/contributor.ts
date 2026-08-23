import type { App } from 'obsidian';
import type { DataManager } from '../data/DataManager';
import type {
  ContributorCapabilities,
  DecisionAction,
  DecisionContributor,
  DecisionItem,
  ResolveResult,
} from './types';
import { countPeriodPending, isPlanScheduledOn, todayStr, weekMonday } from './queryHandler';
import { buildExerciseMuscleMap, computeMuscleRestDays, daysBetween } from '../data/muscleStats';
import { getMuscleName } from '../data/display';
import { RecordModal } from '../ui/RecordModal';
import { t } from '../i18n';

/*
 * contributor.ts —— P3 DecisionContributor 实现。
 *
 * 向决策中心推送四类待决策项：
 *   1. 肌肉休息超时（距上次训练 > restThresholdDays）
 *   2. 今日有训练计划待完成（isPlanScheduledOn(today) 且当日组未全完成）
 *   3. 训练计划整体完成率低（本周周期口径完成率 < 50%）
 *   4. 长时间无训练（距上次任意训练 > 3 天）
 * resolveItem：approve 打开训练记录弹窗（预选肌肉/计划），reject 写入
 * decisionDismissals（PluginSettings）实现「忽略本期/跳过今天」。
 */

/** 长时间无训练阈值（天）。当前无配置项，先作常量，后续可开放设置。 */
const NO_TRAINING_THRESHOLD_DAYS = 3;
/** 计划完成率低阈值（%）。当前无配置项，先作常量，后续可开放设置。 */
const LOW_COMPLETION_THRESHOLD = 50;

export function createWorkoutContributor(
  plugin: { app: App },
  dataManager: DataManager
): DecisionContributor {
  const capabilities: ContributorCapabilities = {
    supportedTypes: ['simple-confirm'],
    writableDomains: ['workout'],
    domainLabel: t('decision.domainLabel'),
    consumableKinds: ['workout', 'exercise', 'rest'],
  };

  function dismissals(): Record<string, string> {
    return dataManager.getSettings().decisionDismissals ?? {};
  }

  /** 记录「忽略本期/跳过今天」。key 与 getDecisionItems 判定时的 key 一致。 */
  function dismiss(key: string): void {
    const s = dataManager.getSettings();
    s.decisionDismissals = { ...(s.decisionDismissals ?? {}), [key]: todayStr() };
    void dataManager.saveSettings();
  }

  function latestTrainingDay(logs: ReturnType<DataManager['getLogs']>): string | null {
    let last: string | null = null;
    for (const log of logs) {
      if (!log.timestamp) continue;
      const day = log.timestamp.slice(0, 10);
      if (!last || day > last) last = day;
    }
    return last;
  }

  async function getDecisionItems(): Promise<DecisionItem[]> {
    const config = await dataManager.getConfig();
    const logs = dataManager.getLogs();
    const dismissed = dismissals();
    const today = todayStr();
    const items: DecisionItem[] = [];
    const em = buildExerciseMuscleMap(config);

    // 1) 肌肉休息超时
    for (const muscle of config.muscles) {
      const threshold = muscle.restThresholdDays ?? 7;
      const rest = computeMuscleRestDays(muscle.id, logs, em);
      if (rest < 0 || rest <= threshold) continue;
      const key = `muscle:${muscle.id}`;
      const dismissedAt = dismissed[key];
      if (dismissedAt && daysBetween(dismissedAt, today) < threshold) continue;
      items.push({
        id: `workout-block:muscle-rest:${muscle.id}`,
        source: 'workout-block',
        type: 'simple-confirm',
        title: `${getMuscleName(muscle)}已 ${rest} 天未训练（阈值 ${threshold} 天）`,
        description: `建议安排针对 ${getMuscleName(muscle)} 的训练，避免肌群长期闲置。`,
        priority: 'medium',
        payload: { kind: 'muscle-rest', muscleId: muscle.id },
      });
    }

    // 2) 今日计划待完成
    for (const plan of config.plans ?? []) {
      if (!isPlanScheduledOn(plan, today)) continue;
      const { total, done } = countPeriodPending(plan, today, today, plan.completedSets);
      if (total <= done) continue;
      const key = `plan-today:${plan.id}:${today}`;
      if (dismissed[key]) continue;
      items.push({
        id: `workout-block:plan-today:${plan.id}:${today}`,
        source: 'workout-block',
        type: 'simple-confirm',
        title: `${plan.name} 今日待完成 ${total - done} 组`,
        description: `今天 ${plan.name} 计划共 ${total} 组，已完成 ${done} 组。`,
        priority: 'medium',
        payload: { kind: 'plan-today', planId: plan.id },
      });
    }

    // 3) 计划完成率低（本周周期口径）
    const weekStart = weekMonday(today);
    for (const plan of config.plans ?? []) {
      const { total, done } = countPeriodPending(plan, weekStart, today, plan.completedSets);
      if (total === 0) continue;
      const pct = (done / total) * 100;
      if (pct >= LOW_COMPLETION_THRESHOLD) continue;
      const key = `plan-low:${plan.id}:${weekStart}`;
      if (dismissed[key]) continue;
      items.push({
        id: `workout-block:plan-low:${plan.id}:${weekStart}`,
        source: 'workout-block',
        type: 'simple-confirm',
        title: `${plan.name} 本周完成率 ${Math.round(pct)}%（${done}/${total}）`,
        description: `本周 ${plan.name} 已完成 ${done}/${total} 组，低于 ${LOW_COMPLETION_THRESHOLD}% 阈值，建议调整或补练。`,
        priority: 'low',
        payload: { kind: 'plan-low', planId: plan.id },
      });
    }

    // 4) 长时间无训练
    const lastDay = latestTrainingDay(logs);
    if (lastDay) {
      const restDays = daysBetween(lastDay, today);
      if (restDays >= NO_TRAINING_THRESHOLD_DAYS) {
        const key = `no-training:${today}`;
        if (!dismissed[key]) {
          items.push({
            id: `workout-block:no-training:${today}`,
            source: 'workout-block',
            type: 'simple-confirm',
            title: `已 ${restDays} 天没有任何训练记录`,
            description: '长期没有训练记录，建议安排一次训练保持节奏。',
            priority: 'high',
            payload: { kind: 'no-training' },
          });
        }
      }
    }

    return items;
  }

  // —— resolveItem 的 UI 副作用（approve 打开录入弹窗）——

  function openRecordModalForMuscle(muscleId: string): void {
    void (async () => {
      const config = await dataManager.getConfig();
      const exercise =
        config.exercises.find((e) => e.muscles?.some((m) => m.muscleId === muscleId && m.role === 'primary')) ??
        config.exercises.find((e) => e.muscles?.some((m) => m.muscleId === muscleId));
      new RecordModal(dataManager, { exercise: exercise?.id }).open();
    })();
  }

  function openRecordModalForPlan(planId: string): void {
    void (async () => {
      const config = await dataManager.getConfig();
      const plan = config.plans?.find((p) => p.id === planId);
      new RecordModal(dataManager, { plan: plan?.name }).open();
    })();
  }

  function openRecordModal(): void {
    new RecordModal(dataManager).open();
  }

  function resolveItem(itemId: string, action: DecisionAction, _modifiedData?: unknown): ResolveResult {
    const parts = itemId.split(':');
    const kind = parts[1];
    const p1 = parts[2];

    if (action === 'reject') {
      // 忽略本期 / 跳过今天
      if (kind === 'muscle-rest') dismiss(`muscle:${p1}`);
      else if (kind === 'plan-today') dismiss(`plan-today:${p1}:${todayStr()}`);
      else if (kind === 'plan-low') dismiss(`plan-low:${p1}:${weekMonday(todayStr())}`);
      else if (kind === 'no-training') dismiss(`no-training:${todayStr()}`);
      return { success: true };
    }

    if (action === 'approve') {
      if (kind === 'muscle-rest') openRecordModalForMuscle(p1);
      else if (kind === 'plan-today' || kind === 'plan-low') openRecordModalForPlan(p1);
      else if (kind === 'no-training') openRecordModal();
      return { success: true };
    }

    return { success: false, error: `不支持的决策动作：${action}` };
  }

  return {
    pluginId: 'workout-block',
    capabilities,
    getDecisionItems,
    resolveItem,
  };
}
