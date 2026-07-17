import { Component, MarkdownPostProcessorContext, MarkdownRenderChild } from 'obsidian';
import { LogRow, FieldDef, WorkoutConfig } from '../data/types';
import { t } from '../i18n';
import { getFieldLabel, getFieldUnit, renderFieldValue, resolveLogExerciseName, resolveExerciseIdByName } from '../data/display';
import { computeStat, formatStatValue } from '../data/statExpr';
import { registerRenderedBlock, unregisterRenderedBlock } from './registry';

/*
 * workoutLog.ts —— 把 ```workout-log 代码块渲染成 HTML 表格
 * 这是真正「画表格」的代码。用户在笔记里写如下代码块：
 *     ```workout-log
 *     exercise: 深蹲
 *     limit: 20
 *     group_by: date
 *     ```
 * 插件解析这些参数 → 过滤出对应训练项的日志记录 → 画表头和数据行，
 * 并给每行加「编辑/删除」按钮。数据变化时由 registry 触发的重渲染会再次调用本文件。
 */

// 代码块支持的参数（都写在代码块正文里，用 key: value 形式）
interface WorkoutLogParams {
  exercise: string;
  limit?: number;
  number?: number;
  day?: number;
  groupBy?: 'date' | 'week';
  sort?: 'desc' | 'asc';
  showAdd?: boolean;
}

// 解析代码块正文：把 "key: value" 每行拆开，填进上面的参数对象
function parseParams(source: string): WorkoutLogParams {
  // 先给一份「默认值」，下面遇到对应行再覆盖
  const params: WorkoutLogParams = {
    exercise: '',
    limit: 50,
    groupBy: 'date',
    sort: 'desc',
    showAdd: true,
  };

  // 按换行把代码块正文切成多行，逐行读取参数
  const lines = source.split('\n');
  for (const line of lines) {
    // 每行按冒号切成 [key, value]，并去掉首尾空格
    const [key, value] = line.split(':').map((s) => s.trim());
    // key 为空或没有 value 的行跳过（比如空行）
    if (!key || value === undefined) continue;

    // 根据 key 名字分别赋值；switch 让每个参数各走各的处理分支
    switch (key) {
      case 'exercise':
        params.exercise = value;
        break;
      case 'limit':
        // parseInt 转数字，转不出来或 0 时用默认 50
        params.limit = parseInt(value) || 50;
        break;
      case 'number':
        // 限制渲染的记录条数（取最新 N 条），0 或非法值时忽略
        params.number = parseInt(value) || undefined;
        break;
      case 'day':
        // 仅显示数据中最近 N 天的记录，0 或非法值时忽略
        params.day = parseInt(value) || undefined;
        break;
      case 'group_by':
        params.groupBy = value as 'date' | 'week';
        break;
      case 'sort':
        params.sort = value as 'desc' | 'asc';
        break;
      case 'show_add':
        // 只要不是写 "false"（不分大小写）就当作显示
        params.showAdd = value.toLowerCase() !== 'false';
        break;
    }
  }

  return params;
}

// 把日志记录按指定维度分组，返回 分组key → 该组日志数组 的 Map
// 例如 group_by=date 时，同一天的记录归到一组，key 就是日期字符串
function groupLogs(logs: LogRow[], groupBy: 'date' | 'week'): Map<string, LogRow[]> {
  const groups = new Map<string, LogRow[]>();

  for (const log of logs) {
    // 防御：timestamp 缺失的记录无法分组，直接跳过，避免 split(undefined) 崩溃。
    if (!log.timestamp) continue;

    let key: string;
    switch (groupBy) {
      case 'date':
        // timestamp 形如 "2026-07-10 18:30"，按空格切，取第 0 段就是日期
        key = log.timestamp.split(' ')[0];
        break;
      case 'week':
        // 按「第几周」分组：用年份-周号作为 key
        const date = new Date(log.timestamp);
        const weekNum = getWeekNumber(date);
        key = `${date.getFullYear()}-W${weekNum}`;
        break;
      default:
        key = log.timestamp.split(' ')[0];
    }

    // Map 里还没有这个组就先建一个空数组
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    // 把当前记录塞进对应组
    groups.get(key)!.push(log);
  }

  return groups;
}

// 计算某个日期是「当年的第几周」：用日期距元旦的天数 ÷ 7 向上取整
function getWeekNumber(date: Date): number {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const diff = date.getTime() - startOfYear.getTime();
  const oneWeek = 1000 * 60 * 60 * 24 * 7; // 一周的毫秒数
  return Math.ceil(diff / oneWeek);
}

// 用于追踪已经为哪些 el 注册过 Obsidian Component，防止重渲染时重复 ctx.addChild。
const registeredComponents = new WeakMap<HTMLElement, boolean>();

// 主渲染函数：把代码块渲染成表格。
// 参数说明：
//   source/logs —— 代码块原文与全部日志记录
//   getTrainingTypeFields —— 根据训练类型取「有哪些字段」的函数
//   unit —— 用户偏好单位 kg/lb
//   config —— 聚合配置
//   onAddRecord/onEditRecord/onDeleteRecord —— 点击按钮时回调给上层去弹窗/删数据
export async function renderWorkoutLog(
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  logs: LogRow[],
  getTrainingTypeFields: (category: string) => FieldDef[] | Promise<FieldDef[]>,
  unit: 'kg' | 'lb',
  config: WorkoutConfig,
  onAddRecord: (exercise: string, plan?: string) => void,
  onEditRecord: (log: LogRow) => void,
  onDeleteRecord: (log: LogRow) => void
): Promise<void> {
  // 首次渲染时：注册 Obsidian 子组件，在代码块所在视图卸载时自动从 registry 移除。
  // 使用 WeakMap 保证一个 el 只注册一次，避免 data-changed / 语言切换等重绘场景下子组件累积。
  if (!registeredComponents.has(el)) {
    const child = new MarkdownRenderChild(el);
    child.onunload = () => {
      unregisterRenderedBlock(el);
      registeredComponents.delete(el);
    };
    ctx.addChild(child);
    registeredComponents.set(el, true);
    registerRenderedBlock(el, 'workout-log', source, ctx);
  }

  // 先解析代码块参数
  const params = parseParams(source);
  // 没写 exercise 就没法展示，给个提示并登记后返回
  if (!params.exercise) {
    el.createDiv({ text: t('codeblock.noRecords', { exercise: t('codeblock.notSpecified') }) });
    return;
  }

  // 把代码块里写的训练项名（如 "深蹲" / "Squat"）解析成稳定的 exerciseId。
  // 记录只存稳定的 exerciseId，不存显示名，因此必须按 id 匹配，
  // 才能在中英文切换、改名后都查到对应记录。
  const targetExerciseId = resolveExerciseIdByName(config, params.exercise);
  const query = params.exercise.toLowerCase();

  // 过滤目标训练项记录：优先按 exerciseId 精确匹配；无 id（旧数据/自定义）时按名字回退。
  let filteredLogs = logs.filter((log) => {
    if (targetExerciseId && log.exerciseId === targetExerciseId) return true;
    const resolved = resolveLogExerciseName(config, log);
    const lowerResolved = resolved.toLowerCase();
    return lowerResolved === query || lowerResolved.includes(query);
  });

  // day 参数：仅保留「最近 N 个有记录的日」（按该动作的去重日期降序取前 N 天，跳过无训练的空白日）。
  // 这样无论数据间隔多大、或测试数据集中在同一天，day:N 都稳定显示最近 N 个训练日，
  // 不会出现「填任何数都只有一天」的体感问题。
  if (params.day && params.day > 0) {
    const distinctDays = Array.from(
      new Set(
        filteredLogs
          .filter((l) => !!l.timestamp)
          .map((l) => l.timestamp.split(' ')[0])
      )
    ).sort(); // 升序（旧→新）
    // 取最近 N 天（升序数组的末尾 N 个 = 最新的 N 个训练日）
    const keepDays = new Set(distinctDays.slice(-params.day));
    filteredLogs = filteredLogs.filter((l) => !!l.timestamp && keepDays.has(l.timestamp.split(' ')[0]));
  }

  // 排序（desc 默认从新到旧）；timestamp 缺失的记录排最后，避免 localeCompare(undefined) 异常。
  filteredLogs = filteredLogs.sort((a, b) => {
    const ta = a.timestamp || '';
    const tb = b.timestamp || '';
    return params.sort === 'desc' ? tb.localeCompare(ta) : ta.localeCompare(tb);
  });

  // 统计必须基于「完整的、未被 number/limit 裁剪的真实数据」：
  // 若统计也跟着用渲染出来的子集，次数/总量等会被渲染条数带偏
  // （例如当天 6 条只显示 3 条，统计却显示 3 而不是 6）。故先按完整数据分组供统计使用。
  const fullGroups = groupLogs(filteredLogs, params.groupBy ?? 'date');

  // number 参数优先于 limit，仅控制「渲染条数」（取排序后的前 N 条），不影响上面的统计。
  const recordLimit = params.number ?? params.limit ?? 50;
  const displayLogs = filteredLogs.slice(0, recordLimit);

  // 用裁剪后的数据分组，决定「画哪几行」
  const groups = groupLogs(displayLogs, params.groupBy ?? 'date');

  // 从当前笔记路径取出文件名（去掉 .md）作为「训练方案名」，点击添加时传给上层
  const plan = ctx.sourcePath ? ctx.sourcePath.split('/').pop()?.replace('.md', '') : undefined;

  // 一条记录都没有：显示空提示，并按需显示「添加记录」按钮
  if (filteredLogs.length === 0) {
    el.createDiv({ text: t('codeblock.noRecords', { exercise: params.exercise }) });
    if (params.showAdd) {
      // 空状态下同样提供「添加记录」入口
      const addBtn = el.createEl('button', { text: t('codeblock.addRecord', { exercise: params.exercise }) });
      addBtn.addClass('mod-cta');
      addBtn.addEventListener('click', () => onAddRecord(params.exercise, plan));
    }
    return;
  }

  // 有数据：开始画界面
  const container = el.createDiv();
  container.addClass('workout-log-container');

  // 顶部「添加记录」按钮（若开启）
  if (params.showAdd) {
    const header = container.createDiv();
    header.addClass('workout-log-header');
    const addBtn = header.createEl('button', { text: t('codeblock.addRecord', { exercise: params.exercise }) });
    addBtn.addClass('mod-cta');
    addBtn.addEventListener('click', () => onAddRecord(params.exercise, plan));
  }

  // 创建表格元素
  const table = container.createEl('table');
  table.addClass('workout-log-table');

  // 取首条记录所属训练类型的字段定义（决定表头画哪些列）
  const category = filteredLogs[0].category;
  const fields = await getTrainingTypeFields(category);

  // 本代码块训练项所属训练类型下、已启用且关联该类型的数据统计条目。
  const matchedStats = (config.statistics ?? []).filter(
    (s) => s.enabled && s.associatedTypes.includes(category)
  );

  // 画表头 <thead>
  const thead = table.createEl('thead');
  const headerRow = thead.createEl('tr');

  // 第一列固定为日期
  headerRow.createEl('th', { text: t('codeblock.date') });
  // 每个字段画一列，列标题 = 字段标签，若有单位在后面加 (单位)
  for (const field of fields) {
    const unitText = getFieldUnit(field, unit);
    headerRow.createEl('th', { text: `${getFieldLabel(field)}${unitText ? `(${unitText})` : ''}` });
  }
  // 备注列、操作列（编辑/删除按钮所在）
  headerRow.createEl('th', { text: t('codeblock.note') });
  headerRow.createEl('th', { text: t('codeblock.actions') });

  // 画表体 <tbody>
  const tbody = table.createEl('tbody');

  // 按渲染分组（displayLogs 已裁剪）的「分组名」排序
  const groupKeys = Array.from(groups.keys()).sort((a, b) => (params.sort === 'desc' ? b.localeCompare(a) : a.localeCompare(b)));

  // 遍历每个分组，每个分组内逐条记录画一行
  for (const key of groupKeys) {
    const groupLogsList = groups.get(key)!;
    // 统计基于「完整数据」分组（fullGroups），不受 number/limit 裁剪影响，保证次数/总量等准确
    const statSourceLogs = fullGroups.get(key) ?? groupLogsList;

    // 分组上方：日期 / 统计行。
    // 布局：[日期(分组key) | 统计值(合并字段列) | 备注(空) | 操作(空)]
    // 无统计时仅显示日期行作为分组分隔标识。
    const groupHeaderRow = tbody.createEl('tr');
    groupHeaderRow.addClass(matchedStats.length > 0 ? 'workout-log-stat' : 'workout-log-group-header');

    // 第一格固定为日期（分组 key），不随统计 colspan 吞掉
    groupHeaderRow.createEl('td', { text: key });

    if (matchedStats.length > 0) {
      // 有统计时：统计值合并所有字段列，纯数字、不附加单位。
      // 多条统计用换行排列（\n），同一单元格内每条一行，CSS 用 white-space: pre-line 还原换行。
      const statCells = matchedStats
        .map((s) => `${s.name}: ${formatStatValue(computeStat(s, statSourceLogs))}`)
        .join('\n');
      const statCell = groupHeaderRow.createEl('td', { text: statCells });
      statCell.colSpan = fields.length; // 显式设置，确保跨列合并所有配置字段
      statCell.addClass('workout-log-stat-cell');
    } else {
      // 无统计时：字段列区域空白（合并占位）
      const emptyCell = groupHeaderRow.createEl('td');
      emptyCell.colSpan = fields.length;
    }
    // 备注列与操作列始终为空
    groupHeaderRow.createEl('td', { text: '' });
    groupHeaderRow.createEl('td', { text: '' });

    for (const log of groupLogsList) {
      const row = tbody.createEl('tr');

      // 第一列：只显示时间部分（HH:mm），日期已在上方分组头显示。
      // 防御：timestamp 缺失时整行不渲染（分组阶段已过滤，此处再兜底）。
      if (!log.timestamp) continue;
      const timePart = log.timestamp.split(' ')[1] ?? log.timestamp;
      row.createEl('td', { text: timePart });

      // 中间各字段列：取该记录的字段值，按字段类型渲染（含单位换算）。
      // 按需求：单元格只显示纯数字，单位仅在表头体现；时长字段仍由 renderFieldValue 保持可读文本。
      for (const field of fields) {
        const value = log.fields[field.key];
        const cell = row.createEl('td', { text: renderFieldValue(value, field, unit) });
      }

      // 备注列
      row.createEl('td', { text: log.note || '' });

      // 操作列：编辑按钮 + 删除按钮，样式与训练项管理保持一致（workout-action-btn / workout-danger-btn）
      const actionsCell = row.createEl('td');
      const actionsWrap = actionsCell.createEl('div');
      actionsWrap.addClass('workout-card-actions');
      const editBtn = actionsWrap.createEl('button', { text: t('codeblock.edit') });
      editBtn.addClass('workout-action-btn');
      editBtn.addEventListener('click', () => onEditRecord(log));
      const deleteBtn = actionsWrap.createEl('button', { text: t('codeblock.delete') });
      deleteBtn.addClass('workout-danger-btn');
      deleteBtn.addEventListener('click', () => onDeleteRecord(log));
    }
  }

}