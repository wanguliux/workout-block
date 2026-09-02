/*
 * blockProvider.ts —— 跨插件通用 block 插入器契约（BlockProvider + first-claim wins）
 *
 * 核心机制（与 finance-block 同源的《规范-BlockProvider契约》）：
 *
 * 1. 契约：每个 block 插件在插件实例上暴露 getBlockRegistry()，返回"我能插哪些 block"。
 * 2. 发现：通用插入器通过扫描 app.plugins.plugins 找到所有实现了 getBlockRegistry()
 *    的插件实例，动态合并展示——无需模块级注册表，无跨插件共享状态。
 * 3. 宿主策略（first-claim wins）：每个插件在 onload() 都尝试注册"插入代码块"命令，
 *    第一个执行到的真正注册命令，其余检测到已存在就跳过。结果：
 *    - 只装 1 个插件 → 它自己就是宿主（单插件独立装也能用）
 *    - 装 N 个 → 字母序首个当宿主，合并视图按插件分组 + 搜索
 * 4. 统一插入格式：所有插件共用 ```类型名 ... ``` fence 语法
 * 5. 可扩展：第 N 个 block 插件只需实现 getBlockRegistry() + 自带宿主声明逻辑
 * 6. 契约 v2（参数渲染委托）：宿主对「不认识的 type」不再一律降级文本，而是定向委托给
 *    定义方插件（block.pluginId → app.plugins.plugins[id].renderParamField，见
 *    getPluginParamRenderer）。谁定义参数，谁渲染参数——提供方对未来控件负责，宿主零跟进。
 */

import type { App, Plugin } from 'obsidian';
import { t } from './i18n';

// ─── 类型定义 ──────────────────────────────────────────────────

/** 单个可插入的 block 参数定义（跨插件通用契约） */
export interface BlockParamDef {
  key: string;
  label: string;
  description?: string;
  type: string; // 参数类型（各插件可扩展；未知类型宿主按契约 v2 委托定义方渲染，无渲染器才 fallback 为 text）
  optional?: boolean;
  placeholder?: string;
  options?: string[];
  optionLabels?: Record<string, string>;
  /** 多选分组元数据（定义方自定义 type 的物化产物）：label=组名，options=组内 value */
  optionGroups?: Array<{ label: string; options: string[] }>;
  defaultValue?: string;
  dynamic?: 'exercise' | 'plan' | 'metric'; // workout 专有：运行时从 config 填充选项
}

/**
 * 参数渲染委托上下文（契约 v2）：
 * 宿主把「不认识的 type」控件渲染委托给定义方插件时传入。
 * 渲染器只负责控件（含自身需要的字段名/描述排版），值变更经 onChange 回写宿主表单。
 */
export interface ParamRenderContext {
  /** 初始值（宿主的 defaultValue / 已填值） */
  initial?: string;
  /** 值变更回调：渲染器把当前值写回宿主表单 */
  onChange: (value: string) => void;
}

/** BlockProvider 插件实例（宿主按 pluginId 定向取定义方渲染器时探测的类型） */
export interface BlockProviderPlugin {
  getBlockRegistry?: () => BlockDefinitionWithParams[];
  /**
   * 契约 v2：渲染本插件定义的「自定义 type」参数控件到 container。
   * 宿主只在自身不认识的 type 时调用；未实现该方法的插件仍是合法 Provider（宿主降级文本）。
   */
  renderParamField?: (container: HTMLElement, param: BlockParamDef, ctx: ParamRenderContext) => void;
  manifest?: { id?: string; name?: string };
}

/** 单个可插入的 block 定义（对外暴露给通用 Modal 的格式） */
export interface BlockDefinitionWithParams {
  language: string; // fence 语言标识（如 'workout-log'）
  name: string; // 显示名
  description?: string; // 说明
  icon?: string; // Obsidian 图标名
  template?: string; // 原始模板（含 {{key}} 占位）
  params: BlockParamDef[]; // 参数定义
  /** 所属插件 ID：宿主定向查找定义方参数渲染器的依据（契约 v2 要求） */
  pluginId?: string;
  /** 契约别名：与 name 同义，供只认 title 的宿主 Modal 读取 */
  title?: string;
  /** 是否从「插入代码块」弹窗隐藏（true=仅存量笔记渲染，新用户不可插入） */
  hidden?: boolean;
}

/** 按插件分组的视图数据（供 Modal 展示） */
export interface ProviderGroup {
  pluginId: string;
  pluginName: string;
  blocks: BlockDefinitionWithParams[];
}

// ─── 通用插入命令 ID ────────────────────────────────────────────

const COMMAND_ID = 'insert-block';

// ─── 跨插件发现 ─────────────────────────────────────────────────

/**
 * 扫描 app.plugins.plugins，找到所有已启用且实现了 getBlockRegistry() 的插件，
 * 返回按 pluginId 字母序排列的分组列表（供 Modal 分组展示）。
 *
 * 动态发现——无需模块级注册表，每个插件只需在实例上暴露 getBlockRegistry()。
 */
export function getBlockProviders(app: App): ProviderGroup[] {
  const groups: ProviderGroup[] = [];
  // Obsidian 未在公开类型中暴露 plugins，需要 type assertion
  const plugins = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins;

  for (const pluginId of Object.keys(plugins)) {
    const plugin = plugins[pluginId] as Plugin & {
      getBlockRegistry?: () => BlockDefinitionWithParams[];
      manifest?: { name?: string };
    };
    if (typeof plugin?.getBlockRegistry === 'function') {
      const blocks = plugin.getBlockRegistry();
      if (blocks.length > 0) {
        groups.push({ pluginId, pluginName: plugin.manifest?.name ?? pluginId, blocks });
      }
    }
  }

  return groups.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
}

/**
 * 契约 v2：宿主按 block.pluginId 定向取「定义方插件」的参数渲染器。
 * 沿 app.plugins.plugins 探测（与 getBlockRegistry 同一运行时发现机制，无模块级注册表）；
 * 定义方未实现 / 未启用时返回 undefined → 宿主回落到文本输入。
 */
export function getPluginParamRenderer(
  app: App,
  pluginId?: string,
): BlockProviderPlugin['renderParamField'] {
  if (!pluginId) return undefined;
  const plugins = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins
    .plugins;
  const plugin = plugins[pluginId] as BlockProviderPlugin | undefined;
  return typeof plugin?.renderParamField === 'function'
    ? plugin.renderParamField.bind(plugin)
    : undefined;
}

/** 合并所有 provider 的 block 定义（扁平列表） */
export function getAllBlockDefinitions(app: App): BlockDefinitionWithParams[] {
  return getBlockProviders(app).flatMap((g) => g.blocks);
}

// ─── first-claim wins 宿主声明 ──────────────────────────────────

/**
 * 尝试注册"插入代码块"命令（first-claim wins 宿主策略）。
 *
 * 逻辑：检查当前是否已有插件注册了同名命令 →
 *   - 已有 → 跳过（自己是后来的插件，不当宿主）
 *   - 没有 → 注册命令，自己成为宿主
 *
 * @param plugin 当前插件实例
 * @param openModal 打开插入弹窗的回调（由 main.ts 注入）
 * @returns 是否成功注册为宿主
 */
export function tryRegisterInsertCommand(
  plugin: Plugin,
  openModal: () => void,
): boolean {
  // Obsidian 内部 commands.commands 是一个普通对象 { [id: string]: Command }
  // 关键：Obsidian 在存储命令时会给 ID 加上插件前缀，格式为 pluginId:commandId
  // 例如 finance-block 注册的 insert-block 在 registry 中的 key 是 finance-block:insert-block
  const commandsRegistry = (plugin.app as unknown as { commands?: { commands?: Record<string, unknown> } })
    .commands?.commands;

  if (commandsRegistry) {
    // 遍历检查是否已有任意插件注册了同一 COMMAND_ID（通过 key 后缀匹配）
    for (const key of Object.keys(commandsRegistry)) {
      if (key === COMMAND_ID || key.endsWith(':' + COMMAND_ID)) {
        // 已有宿主注册了此命令，跳过（但仍会作为 provider 被展示）
        return false;
      }
    }
  }

  // 注册命令（first-claim wins：我是第一个）
  plugin.addCommand({
    id: COMMAND_ID,
    name: t('command.insertBlock'),
    callback: openModal,
  });

  return true;
}
