/*
 * types.ts —— 数据层的"数据结构（图纸）"定义文件。
 * 这里集中声明了插件用到的所有数据类型：字段定义、训练类型、肌肉、训练项、
 * 单条训练记录、完整配置、插件设置等。其他所有文件都从这里 import 这些类型，
 * 保证整个插件的数据格式统一、不会混乱。
 * 概念：TypeScript 里的 interface 就像给数据"画图纸"，规定一个对象里有哪些字段、
 * 每个字段是什么类型；export const 则是导出一份固定不变的常量值。
 */

// 字段定义：描述一个训练类型里"要记录哪些数据项"，比如力量训练要记"重量"和"次数"。
export interface FieldDef {
  key: string;                 // 字段的唯一内部标识（如 "weight"）。切勿随意改名，否则旧数据就无法对应
  labelKey?: string;           // 国际化 key（多语言用），如 "field.weight"，由 i18n 翻译成"重量"
  label?: string;              // 没有 labelKey 时的兜底显示名
  inputType: 'number' | 'duration' | 'text' | 'select';  // 输入控件类型：数字 / 时长 / 文本 / 下拉选择
  mass?: boolean;             // 是否参与 kg/lb 换算（仅数字字段有意义；选中"质量"即自动 true）
  unitLabel?: string;         // 单位显示文字（自由文本，如"次""层""圈""公里"），留空表示无单位
  required?: boolean;          // 是否为必填项
  options?: string[];          // 当 inputType 为 'select'（下拉）时的可选项列表
}

// 训练类型：如"力量训练""有氧训练"。每个类型定义一组要记录的字段(fields)。
export interface TrainingType {
  id: string;                  // 唯一标识（如 "strength"）。建议稳定不变，改名会断掉历史记录关联
  nameKey?: string;            // 国际化显示名 key（优先级高于 name）
  name?: string;               // 没有 nameKey 时的兜底名称
  icon?: string;               // 显示的图标名（Obsidian/Lucide 图标）
  fields: FieldDef[];          // 该训练类型要记录的字段列表
  contributesToCoverage?: boolean;  // 是否计入"肌肉覆盖/训练频率"统计
}

// 肌肉：人体部位，用于训练覆盖统计和身体示意图高亮。
export interface Muscle {
  id: string;                  // 唯一标识（如 "chest"）
  nameKey?: string;            // 国际化显示名 key
  name?: string;               // 兜底名称
  contributesToCoverage: boolean;    // 是否计入覆盖统计
  // 超过该天数未练即提醒/标红；默认 7（v2.3 由通用设置下放到每块肌肉）
  restThresholdDays?: number;
  // 该肌肉在身体示意图 SVG 中对应的全部路径 id（1→N 可配置映射）
  svgRegionIds: string[];
  // 热力图每块肌肉可覆盖的指标、时间窗、颜色分档；留空则跟随代码块/全局默认（三级回退）
  heatmapMetric?: string;        // 引用 StatDef.id；空=跟随默认
  heatmapRange?: string;         // 7d / 30d / 90d / all / 日期区间；空=跟随默认
  heatmapLevels?: HeatmapLevel[]; // 该肌 4 色分档（蓝/绿/橙/红）阈值；空=跟随所选指标的默认分档（逐肌可配）
}

// 训练项与肌肉的关联：一个动作练到哪些肌肉，以及是主练还是辅练。
export interface ExerciseMuscle {
  muscleId: string;            // 关联到的 Muscle 的 id
  role: 'primary' | 'secondary';    // 主练(primary)还是辅练(secondary)
  contributesToCoverage?: boolean;  // 该关联是否计入覆盖统计
}

// 训练项（动作）：如"深蹲""卧推"。属于某个训练类型，并关联若干肌肉。
export interface Exercise {
  id: string;                  // 唯一标识（如 "squat"）。记录用此 id 关联，改名不影响历史
  nameKey?: string;            // 国际化显示名 key
  name?: string;               // 兜底名称
  category: string;            // 所属训练类型的 id（对应 TrainingType.id）
  muscles?: ExerciseMuscle[];  // 该动作涉及的肌肉及其角色
}

// 一条训练记录（CSV 里的一行）。这是用户每次锻炼实际产生的数据。
export interface LogRow {
  id: string;                  // 稳定唯一标识（12 位 base36 短随机 id），作为记录主键，替代 timestamp 的定位职责
  timestamp: string;           // 记录时间，格式 "YYYY-MM-DD HH:mm"，仅用于展示/排序/分组
  exerciseId?: string;         // 训练项 id，用于稳定关联配置（改名/换语言后仍能解析到最新名）
  category: string;            // 训练类型 id
  fields: Record<string, unknown>;  // 各字段值，统一以 JSON 对象存储（含义由训练类型决定）
  note?: string;               // 备注
  plan?: string;               // 计划/方案名（预留，当前未消费）
}

// 训练计划：从训练方案（笔记）或手动创建的持久化配置实例。
// 一组训练项 + 每项的多个组（每组字段独立预设）。时间规则支持具体日期或每周某几天。
export interface PlanSet {
  id: string;                          // 组内稳定 id（完成状态匹配用）
  fields: Record<string, unknown>;    // 该组字段预设值（用户自定义，如 {weight:60, reps:8}）
}

export interface PlanItem {
  exerciseId: string;                  // 训练项 id（稳定关联配置）
  category: string;                    // 所属训练类型 id（决定字段）
  enabled: boolean;                    // 是否纳入本次计划（全选默认 true）
  sets: PlanSet[];                     // 多组，每组字段独立
}

export interface TimeRule {
  type: 'date' | 'weekday';
  date?: string;                       // type='date'：YYYY-MM-DD
  weekdays?: number[];                 // type='weekday'：ISO 周几，周一=1 … 周日=7，如 [1,3,5]
}

export interface TrainingPlanInstance {
  id: string;                          // uuid
  name: string;                        // 全局唯一，即 workout-plan 代码块的 plan 参数值
  timeRule: TimeRule;                  // 计划时间
  sourceNote?: string;                 // 来源方案笔记 basename（可选；手动创建时为空）
  createdAt: string;                   // YYYY-MM-DD
  items: PlanItem[];
  // 已完成组持久化：key = `${exerciseId}#${setId}`，value = 完成日期(YYYY-MM-DD)。
  // 独立于训练记录存储——即使删除了该组产生的训练记录，完成状态仍保留（完成即完成）。
  completedSets?: Record<string, string>;
}

// 完整配置：聚合了训练类型、训练项、肌肉三块，整体存进 workout-config.json。
// 数据统计（数据分析）条目：让用户对训练记录的字段做数学聚合。
// 作用域 = 关联一个或多个训练类型（其字段交集即公式可选字段）；
// 显示仅在「训练项 category ∈ associatedTypes」的代码块里出现；
// 计算始终落在当前代码块训练项、当前分组的记录上。
export type StatGranularity = 'daily' | 'weekly' | 'monthly';

export type StatAggregation =
  | { kind: 'sum'; field: string }                       // 字段求和：Σ 每条记录的字段值
  | { kind: 'productSum'; fieldA: string; fieldB: string } // 乘积求和：Σ(字段A×字段B)
  | { kind: 'oneRepMax'; weightField: string; repsField: string } // 1RM 估算：取最佳组的 Epley 公式估算值
  | { kind: 'avg' | 'max' | 'min'; field: string }     // 均值 / 最大 / 最小
  | { kind: 'count' };                                  // 记录条数（不引用字段）

// 热力图颜色档：颜色标识 + 该档上限（含）；末档省略 max 表示 +∞
export interface HeatmapLevel {
  color: string;
  max?: number;
}

export interface StatDef {
  id: string;                       // 唯一标识
  name: string;                     // 显示名（如「总训练量」「总时长」）
  associatedTypes: string[];         // 关联的训练类型 id 列表（支持多个）
  formula: {
    mode: 'builder' | 'expression';  // 引导式构建器 / 自由表达式
    builder?: StatAggregation;        // mode='builder' 时有效
    expression?: string;              // mode='expression' 时有效，如 "sum(reps * weight)"
  };
  granularity: StatGranularity;
  enabled: boolean;
  // 作为热力图指标时的【默认】颜色分档模板；每块肌肉可在编辑页基于此单独覆盖（见 §5.4.1）
  heatmapScale?: HeatmapLevel[];
  // 标记是否为热力图默认指标（种子置「次数」为 true）
  heatmapDefault?: boolean;
}

export interface WorkoutConfig {
  version: number;             // 配置版本号，用于数据迁移(migrate)
  trainingTypes: TrainingType[];
  exercises: Exercise[];
  muscles: Muscle[];
  statistics: StatDef[];
  plans?: TrainingPlanInstance[];   // 训练计划实例列表（聚合进既有配置文件，不单独建文件）
}

// 插件设置：存放路径、单位、语言、各种集成开关等用户偏好。
export interface PluginSettings {
  csvDirectory: string;        // 训练记录 CSV 所在目录（vault 内相对路径，空 = 根目录）
  configDirectory: string;     // 配置文件所在目录（空 = 根目录）
  unit: 'kg' | 'lb';           // 重量单位：公斤 / 磅
  language: 'zh' | 'en';       // 界面语言：中文 / 英文
  dataviewIntegration: boolean;      // 是否启用 Dataview 集成
  dailyNotesIntegration: boolean;    // 是否启用日记集成
  templaterIntegration: boolean;     // 是否启用 Templater 集成
  lastValueMemory: boolean;          // 是否记忆上次输入值（下次自动填充）
  // 肌肉管理首次引导是否已完成（v2.3）
  muscleMappingInitialized: boolean;
  // 设置页「训练设置」区块下五个管理条目的显示顺序（仅影响设置页排序，不影响功能逻辑）
  managerOrder: string[];            // 取值见 renderManagersSection：['types','exercises','muscles','statistics','plans']
}

// 默认设置：首次安装时使用。之后用户改过的设置会覆盖其中对应项。
export const DEFAULT_SETTINGS: PluginSettings = {
  csvDirectory: '',
  configDirectory: '',
  unit: 'kg',
  language: 'zh',
  dataviewIntegration: false,
  dailyNotesIntegration: false,
  templaterIntegration: false,
  lastValueMemory: true,
  muscleMappingInitialized: false,
  managerOrder: ['types', 'exercises', 'muscles', 'statistics', 'plans'],
};

// 训练记录 CSV 的文件名（存于 vault 中）
export const CSV_FILENAME = 'workout_logs.csv';
// 聚合配置 JSON 的文件名
export const CONFIG_FILENAME = 'workout-config.json';
