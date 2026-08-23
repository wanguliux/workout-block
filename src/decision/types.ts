/*
 * types.ts —— 决策中心协议类型（内建副本）。
 *
 * 从 KOS-block 的 src/decision/types.ts 复制（P0 统一查询合约 + P3 contributor
 * 能力声明所需的全部类型）。TypeScript 接口是编译时概念、运行时不存在，各插件
 * 各自维护一份（与 blockProvider.ts 的 BlockDefinitionWithParams 做法一致），
 * 不引入跨插件运行时依赖。
 *
 * 若 KOS-block 协议升级，需同步更新本文件的对应类型定义。
 */

// ===== P0：统一查询合约（工具合约）=====

/** 插件工具能力清单（AI 据此知道本插件能查什么）。 */
export interface ToolCapability {
  /** 插件 id（与 DecisionContributor.pluginId 一致） */
  pluginId: string;
  /** 人类可读的域名称（AI 展示用） */
  domainLabel: string;
  /** 可查询的统计维度 */
  dimensions: DimensionDef[];
  /** 全局筛选器（适用于大部分维度） */
  globalFilters: FilterDef[];
}

/** 统计维度定义 */
export interface DimensionDef {
  /** 维度 id（域内唯一） */
  id: string;
  /** 维度标签（i18n key 或明文） */
  label: string;
  /** 返回值类型提示（AI 据此理解数据形状） */
  valueType: 'number' | 'currency' | 'duration' | 'ratio' | 'count' | 'table' | 'records';
  /** 单位（如 'kg'、'秒'、'%'；无单位则省略） */
  unit?: string;
  /** 该维度专属筛选器（覆盖/补充 globalFilters） */
  filters?: FilterDef[];
  /** 是否支持 records 模式（默认 false，即只支持 summary） */
  supportsRecords?: boolean;
  /** 维度说明（AI 理解语义用） */
  description?: string;
}

/** 筛选器定义 */
export interface FilterDef {
  id: string;
  label: string;
  type: 'dateRange' | 'enum' | 'number' | 'text' | 'boolean';
  /** enum 类型的可选值 */
  values?: string[];
  /** 默认值（省略表示必填） */
  default?: unknown;
  /** 是否必填（有 default 则非必填） */
  required?: boolean;
}

/** 查询请求（AI 发起查询的统一格式）。dateRange 形状：{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }。 */
export interface QueryRequest {
  /** 目标插件 id */
  pluginId: string;
  /** 查询维度 id（必须在该插件的 dimensions 中） */
  dimension: string;
  /** 查询模式：summary=聚合摘要，records=原始记录 */
  mode: 'summary' | 'records';
  /** 筛选条件（key-value，key 为 filter id） */
  filters: Record<string, unknown>;
  /** records 模式分页（默认 { page: 1, pageSize: 50 }） */
  pagination?: { page: number; pageSize: number };
}

/** 查询响应 */
export interface QueryResponse {
  /** 回显：查询的维度 id */
  dimension: string;
  /** 回显：查询模式 */
  mode: 'summary' | 'records';
  /** 数据载荷（错误时为 null） */
  data: SummaryData | RecordData | null;
  /** records 模式：符合条件的总记录数（分页用） */
  total?: number;
  /** 数据形状提示（AI 据此选择分析策略） */
  shapeHint: 'scalar' | 'kv-pairs' | 'table' | 'records';
  /** 错误信息（有值时表示查询失败，data 为 null） */
  error?: string;
}

/** summary 模式的数据载荷 */
export type SummaryData =
  | { value: number; unit?: string } // scalar
  | { entries: Array<{ key: string; value: number; unit?: string }> }; // kv-pairs / table

/** records 模式的数据载荷 */
export interface RecordData {
  records: Array<Record<string, unknown>>;
}

/** 查询总线文件（请求 + 响应合一，自包含）。AI 写 pending → 插件写 fulfilled/error。 */
export interface QueryBusFile extends QueryRequest {
  /** 查询 id（AI 生成，文件名为 {queryId}.json） */
  queryId: string;
  /** 状态 */
  status: 'pending' | 'fulfilled' | 'error';
  /** 查询结果（fulfilled 时填写） */
  response?: QueryResponse;
  /** 错误信息（error 时填写） */
  error?: string;
  /** 创建时间（ISO 时间戳） */
  createdAt: string;
  /** 完成时间（fulfilled/error 时填写） */
  completedAt?: string;
}

/** 查询文件总线目录（vault 根下相对路径，与 P0 协议一致）。 */
export const FILE_BUS_QUERIES_DIR = '.block/inbox/queries';

// ===== P3：contributor 能力声明 =====

export type DecisionType =
  | 'simple-confirm'
  | 'batch-review'
  | 'multi-option'
  | 'plan-checkoff'
  | 'suggestion';

export type DecisionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'modified'
  | 'processing'
  | 'report-ready'
  | 'completed';

export type DecisionAction =
  | 'approve'
  | 'reject'
  | 'modify'
  | 'confirm-report'
  | 'flag-report-item'
  | 'reprocess-item';

/** 决策项的一个选项（multi-option 类型用；simple-confirm 不用）。 */
export interface DecisionOption {
  id: string;
  label: string;
  description?: string;
  actions?: WriteAction[];
}

/** 跨域写入操作（P1 用；本插件暂不实现 P1，保留类型以便未来扩展）。 */
export interface WriteAction {
  domain: string;
  operation: string;
  target: string;
  data: unknown;
  executionMode?: 'local' | 'ai';
}

/** 决策项（纯数据，可序列化；id 格式 {pluginId}:{localId} 保证跨插件全局唯一）。 */
export interface DecisionItem {
  id: string;
  source: string;
  type: DecisionType;
  executionMode?: 'local' | 'ai';
  title: string;
  description?: string;
  priority?: 'high' | 'medium' | 'low';
  status?: DecisionStatus;
  payload?: unknown;
  options?: DecisionOption[];
  writeDomain?: string;
  writeOperation?: string;
  writePayload?: unknown;
}

/** 宿主操作回执。 */
export interface ResolveResult {
  success: boolean;
  error?: string;
}

/** contributor 能力声明（宿主据此动态发现与过滤）。 */
export interface ContributorCapabilities {
  /** 支持的决策项类型（宿主据此过滤渲染） */
  supportedTypes: DecisionType[];
  /** 可写入的域（与 P1 的 writableDomains 语义一致） */
  writableDomains: string[];
  /** 人类可读的域名称（tab 标签、卡片来源标识用） */
  domainLabel: string;
  /** 可消费的 Activity kind 列表（活动契约公共词表子集） */
  consumableKinds?: string[];
}

/** DecisionContributor 契约：每个领域插件实现，暴露待决策项给宿主决策面板。 */
export interface DecisionContributor {
  pluginId: string;
  capabilities?: ContributorCapabilities;
  getDecisionItems(): Promise<DecisionItem[]>;
  resolveItem(itemId: string, action: DecisionAction, modifiedData?: unknown): ResolveResult;
  openEditor?(itemId: string, payload: unknown): Promise<unknown | null>;
}

/** 宿主暴露给贡献者的 API。 */
export interface DecisionHostApi {
  requestRefresh(contributorId: string): void;
}

/** 宿主-贡献者插件属性标记（宿主选举 / 动态发现用）。 */
export interface DecisionHostPlugin {
  _decisionHost?: boolean;
  _decisionHostApi?: DecisionHostApi | null;
  _decisionContributor?: DecisionContributor | null;
  getDecisionHostApi?(): DecisionHostApi;
}

/** initDecisionCenter 的返回值。 */
export interface DecisionInitResult {
  isHost: boolean;
  hostApi: DecisionHostApi | null;
}
