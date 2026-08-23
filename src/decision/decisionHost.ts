import type { App } from 'obsidian';
import type {
  DecisionContributor,
  DecisionHostApi,
  DecisionHostPlugin,
  DecisionInitResult,
} from './types';

/*
 * decisionHost.ts —— 决策中心宿主发现逻辑（内建副本，结构与 KOS-block 相同）。
 *
 * 按 decision-center.md 的架构决策，领域插件不复制宿主的决策面板 UI，只需：
 *   1) 实现 DecisionContributor 契约；
 *   2) onload 里把 contributor 挂到 plugin._decisionContributor，再调用
 *      initDecisionCenter(plugin, contributor) 检测已存在的宿主（KOS-block）。
 * 本文件只包含这套「first-claim-wins 选举 / 动态发现」的最小机制，
 * 与 blockProvider.ts 的 tryRegisterInsertCommand 同属宿主-贡献者通用模式。
 */

/** 扫描 app.plugins.plugins，找到已激活的决策中心宿主（_decisionHost 且实现了 getDecisionHostApi）。 */
export function findDecisionHost(app: App): DecisionHostApi | null {
  const plugins = (app as unknown as { plugins?: { plugins: Record<string, unknown> } }).plugins?.plugins ?? {};
  for (const plugin of Object.values(plugins) as DecisionHostPlugin[]) {
    if (plugin._decisionHost === true && plugin.getDecisionHostApi) {
      return plugin.getDecisionHostApi();
    }
  }
  return null;
}

/**
 * 初始化决策中心接入：
 *  - 无条件设置 plugin._decisionContributor（无论是否宿主都需要）；
 *  - 若检测到已存在宿主 → 本插件作为 contributor 持 hostApi；
 *  - 若没有宿主 → 本插件标记 _decisionHost=true（KOS-block 未装时的兜底；
 *    因本插件不实现 getDecisionHostApi，其他 contributor 不会误认它为宿主）。
 */
export function initDecisionCenter(
  plugin: DecisionHostPlugin & { app: App },
  contributor: DecisionContributor
): DecisionInitResult {
  plugin._decisionContributor = contributor;
  const existingHost = findDecisionHost(plugin.app);
  if (existingHost) {
    plugin._decisionHost = false;
    plugin._decisionHostApi = existingHost;
    return { isHost: false, hostApi: existingHost };
  }
  plugin._decisionHost = true;
  plugin._decisionHostApi = null;
  return { isHost: true, hostApi: null };
}

/** Pull 模型：聚合所有暴露 _decisionContributor 的插件（宿主侧聚合用；本插件作为 contributor 一般不主动调用）。 */
export function collectContributors(app: App): DecisionContributor[] {
  const plugins = (app as unknown as { plugins?: { plugins: Record<string, unknown> } }).plugins?.plugins ?? {};
  const out: DecisionContributor[] = [];
  for (const plugin of Object.values(plugins) as DecisionHostPlugin[]) {
    if (plugin._decisionContributor) out.push(plugin._decisionContributor);
  }
  return out;
}
