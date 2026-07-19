/*
 * codeBlockDefs.ts —— 快捷插入代码块的元数据与文本生成
 * 这是「插入代码块」功能的单一数据源：主弹窗（卡片列表）和参数弹窗（表单）
 * 都从这里读取定义，后续新增代码块只需在此追加一条，无需改弹窗逻辑。
 *
 * 重要：params[].key 必须使用各代码块解析器实际接受的「下划线风格」命名
 * （见 src/codeblock/workoutLog.ts 等 parseParams 的 switch case），
 * 例如 workout-log 接受的是 group_by / show_add 而非 groupBy / showAdd，
 * 否则生成的参数不会被解析器识别而失效。
 */

export type ParamType = 'text' | 'number' | 'select' | 'exercise';

export interface CodeBlockParamDef {
  key: string;                          // 写入代码块正文、解析器可识别的参数名（下划线风格）
  label: string;                        // 参数中文标签
  desc?: string;                        // 参数说明（显示在标签下方）
  type: ParamType;                      // 控件类型
  required?: boolean;                   // 是否必填（本功能统一非必填，保留字段以备扩展）
  placeholder?: string;                 // 输入框占位提示
  options?: string[];                   // type=select 时的静态选项（值）
  optionLabels?: Record<string, string>;// select 选项值 → 中文展示
  dynamic?: 'exercise' | 'plan' | 'metric'; // select 选项来自 DataManager 配置（运行时填充）
}

export interface CodeBlockDef {
  id: string;                           // 代码块类型名（即 ``` 后的语言标识）
  icon: string;                         // Obsidian 图标名（用 setIcon 渲染）
  title: string;                        // 中文名称
  desc: string;                         // 功能说明
  params: CodeBlockParamDef[];
}

export const CODE_BLOCK_DEFS: CodeBlockDef[] = [
  {
    id: 'workout-log',
    icon: 'table',
    title: '训练记录表',
    desc: '按训练项/时间筛选，展示历史训练记录明细表格',
    params: [
      { key: 'exercise', label: '训练项', type: 'exercise', placeholder: '如：卧推（留空显示全部）' },
      { key: 'day', label: '最近天数', type: 'number', placeholder: '如 30，只显示最近 N 天' },
      { key: 'group_by', label: '分组方式', type: 'select', options: ['date', 'week'], optionLabels: { date: '按日期', week: '按周' } },
      { key: 'sort', label: '排序', type: 'select', options: ['desc', 'asc'], optionLabels: { desc: '最新在前', asc: '最早在前' } },
      { key: 'number', label: '最近条数', type: 'number', placeholder: '只显示最新 N 条' },
      { key: 'limit', label: '最多渲染', type: 'number', placeholder: '最多渲染 N 条（默认 50）' },
      { key: 'show_add', label: '显示添加按钮', type: 'select', options: ['true', 'false'], optionLabels: { true: '显示', false: '隐藏' } },
    ],
  },
  {
    id: 'workout-day',
    icon: 'calendar',
    title: '当日训练',
    desc: '展示指定某一天的训练总览（不写则显示今天，随真实日期滚动）',
    params: [
      { key: 'day', label: '日期', type: 'text', placeholder: 'today 或 2026-07-17（留空=今天）' },
    ],
  },
  {
    id: 'workout-heatmap',
    icon: 'flame',
    title: '肌肉热力图',
    desc: '用颜色深浅展示各肌肉的训练强度分布',
    params: [
      { key: 'metric', label: '统计指标', type: 'select', dynamic: 'metric', placeholder: '留空用默认指标' },
      { key: 'range', label: '时间范围', type: 'text', placeholder: '30 / all / 2026-01-01..2026-12-31' },
    ],
  },
  {
    id: 'workout-plan',
    icon: 'clipboard-list',
    title: '训练计划面板',
    desc: '展示某个训练计划的完成进度与每组打卡',
    params: [
      { key: 'plan', label: '计划名称', type: 'select', dynamic: 'plan' },
    ],
  },
];

// 根据定义与用户填写的值，生成最终插入的代码块纯文本。
// 值为空（或纯空白）的参数会被跳过，从而落到代码块的默认值逻辑上。
export function buildCodeBlock(def: CodeBlockDef, values: Record<string, string>): string {
  const lines = [def.id];
  for (const p of def.params) {
    const v = values[p.key];
    if (v === undefined || v === null) continue;
    const trimmed = v.trim();
    if (trimmed === '') continue;
    lines.push(`${p.key}: ${trimmed}`);
  }
  return '```' + lines.join('\n') + '\n```\n';
}
