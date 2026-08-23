import type { ToolCapability } from './types';

/*
 * capability.ts —— P0 能力声明的唯一真相源（纯数据，零依赖）。
 *
 * 插件侧 getToolCapability() 和 CLI cmdCapabilities() 共用同一份。
 * 标签用明文中文——P0 能力清单是给 AI 消费的（非 UI）；P3 的
 * ContributorCapabilities.domainLabel 才走 i18n（见 contributor.ts）。
 * 新增查询维度时只需在这里的 dimensions 数组加一行。
 */

export function getToolCapability(): ToolCapability {
  return {
    pluginId: 'workout-block',
    domainLabel: '运动',
    dimensions: [
      {
        id: 'training-summary',
        label: '训练汇总',
        valueType: 'table',
        description: '指定时间段的训练天数、总组数、总训练量、总时长，以及按训练类型分组的组数',
      },
      {
        id: 'muscle-volume',
        label: '肌肉训练量分布',
        valueType: 'table',
        description: '各肌肉在时间范围内的训练量（volume，按角色加权 primary×1.0 / secondary×0.5），未训练为 0',
        filters: [
          { id: 'muscleId', label: '肌肉id', type: 'text' },
          { id: 'role', label: '肌肉角色', type: 'enum', values: ['primary', 'secondary', 'all'], default: 'all' },
        ],
      },
      {
        id: 'muscle-rest-status',
        label: '肌肉休息状态',
        valueType: 'table',
        description: '各肌肉距上次训练的天数（-1=从未训练），忽略时间筛选（从现在回看到最后一次训练）',
      },
      {
        id: 'strength-progress',
        label: '力量进展趋势',
        valueType: 'table',
        description: '各训练项的 1RM 估算（Epley）与最大重量',
        filters: [{ id: 'exerciseId', label: '训练项id', type: 'text' }],
      },
      {
        id: 'plan-progress',
        label: '训练计划完成度',
        valueType: 'table',
        description: '各计划在时间范围内的完成率（按 timeRule 排期 × completedSets 完成日期，周期口径）',
      },
      {
        id: 'raw-records',
        label: '原始训练记录',
        valueType: 'records',
        supportsRecords: true,
        description: '按条件筛选的原始训练流水（records 模式，支持分页）',
        filters: [
          { id: 'exerciseId', label: '训练项id', type: 'text' },
          { id: 'muscleId', label: '肌肉id', type: 'text' },
        ],
      },
    ],
    globalFilters: [
      { id: 'dateRange', label: '日期范围', type: 'dateRange', required: false },
      {
        id: 'preset',
        label: '时间预设',
        type: 'enum',
        values: ['this-week', 'last-week', 'this-month', 'last-month', '30d', '90d', 'custom'],
        default: 'this-week',
      },
      { id: 'category', label: '训练类型', type: 'text', required: false },
    ],
  };
}
