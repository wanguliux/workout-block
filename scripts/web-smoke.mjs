/*
 * web-smoke.mjs —— 网页版冒烟测试（jsdom + 真实 bundle）。
 *
 * 定位：构建验证链的最后一环——`npm run build:web` 只证明「打包通过」，
 * 本脚本证明「浏览器里真的能跑」：外壳与导航、录入、日志、计划、统计、
 * 热力图、自定义编辑器、设置、CSV/备份互通与删除兜底。
 * 不跑 vitest（KOS 系测试纪律：fork/thread 子进程环境会污染 suite 注册），
 * 这里用普通 node 进程 + jsdom，验证的是产物而非测试框架本身。
 *
 * 用法：先 npm run build:web，再 npm run test:web。
 */

import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const webDir = path.join(root, 'web');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`);
  }
}

const pad = (n) => String(n).padStart(2, '0');
function dateOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const ts = (offset, hour, minute) => `${dateOffset(offset)} ${pad(hour)}:${pad(minute)}`;

// —— 1. 挂载（jsdom 加载 index.html + bundle） ——
console.log('\n[1] 挂载与种子配置');
const html = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
const doc = window.document;

// jsdom 无 crypto.getRandomValues 时兜底（generateId 依赖）
if (!window.crypto?.getRandomValues) {
  window.crypto = {
    getRandomValues: (arr) => {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
      return arr;
    },
  };
}
// jsdom 未实现 scrollIntoView（设置页锚点会调用）
if (!window.Element.prototype.scrollIntoView) {
  window.Element.prototype.scrollIntoView = () => {};
}

window.eval(fs.readFileSync(path.join(webDir, 'bundle.js'), 'utf8'));

const app = window.__workoutWeb?.app;
const store = window.__workoutWeb?.store;
const qs = (selector, scope = doc) => scope.querySelector(selector);
const qsa = (selector, scope = doc) => [...scope.querySelectorAll(selector)];
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));

function click(selector, scope = doc) {
  const el = qs(selector, scope);
  if (!el) throw new Error(`missing element: ${selector}`);
  el.click();
  return el;
}

function goto(page, tab) {
  const hash = `#/${page}${tab ? `/${tab}` : ''}`;
  window.history.replaceState(null, '', hash);
  const EventCtor = typeof window.HashChangeEvent === 'function' ? window.HashChangeEvent : window.Event;
  window.dispatchEvent(new EventCtor('hashchange'));
}

function setSetting(key, value) {
  const el = qs(`[data-setting="${key}"]`);
  if (!el) throw new Error(`missing setting: ${key}`);
  el.value = value;
  fire(el, 'change');
}

check('window.__workoutWeb 已挂载', !!app && !!store);
check('种子配置：3 个训练类型', store.config.trainingTypes.length === 3, `实际 ${store.config.trainingTypes.length}`);
check('种子配置：13 块肌肉', store.config.muscles.length === 13, `实际 ${store.config.muscles.length}`);
check('种子配置：30 个动作', store.config.exercises.length === 30, `实际 ${store.config.exercises.length}`);
check('种子配置：3 条统计', store.config.statistics.length === 3);
check('种子配置：3 个计划', (store.config.plans ?? []).length === 3);
check('外壳：侧栏 + 顶栏 + 视图', !!qs('.app .sidebar') && !!qs('.app .topbar') && !!qs('.app .view'));
check('侧栏 9 个导航项', qsa('.nav-item').length === 9, `实际 ${qsa('.nav-item').length}`);
check('当前导航高亮 = 总览', qs('.nav-item.on')?.textContent.includes('总览'));
check('移动端底部导航 5 项', qsa('.mnav-item').length === 5);
check('页面标题 = 总览', qs('.topbar-title h1')?.textContent.trim() === '总览');
check('总览 4 张 KPI 卡', qsa('.kpi').length === 4, `实际 ${qsa('.kpi').length}`);
check('总览趋势图渲染 7 根柱', qsa('.bars .bar').length === 7);
check('今日安排卡片存在', doc.body.textContent.includes('今日安排'));

// —— 2. 记录页：真实表单保存（类型 → 动作 → 字段 → 保存） ——
console.log('\n[2] 记录页保存闭环');
goto('record');
check('记录页标题', qs('.page-head h2')?.textContent.trim() === '记录一组');
check('渲染 3 个训练类型胶囊', qsa('.type-pill').length === 3);

// 力量：深蹲 60kg × 8
const squatSelect = qs('[data-record-exercise]');
check('默认选中深蹲', squatSelect?.value === 'squat', `实际 ${squatSelect?.value}`);
const weightInput = qs('[data-field="weight"]');
const repsInput = qs('[data-field="reps"]');
weightInput.value = '60';
fire(weightInput, 'input');
repsInput.value = '8';
fire(repsInput, 'input');
click('[data-action="save-log"][data-again="0"]');
check('保存后新增 1 条记录', store.logs.length === 1, `实际 ${store.logs.length}`);
const squatLog = store.logs.find((log) => log.exerciseId === 'squat');
check('记录字段落库（60 × 8）', squatLog?.fields?.weight === 60 && squatLog?.fields?.reps === 8, JSON.stringify(squatLog?.fields));
check('自动清空数值', qs('[data-field="weight"]')?.value === '', `实际 ${qs('[data-field="weight"]')?.value}`);

// 有氧：跑步 31 分钟 / 10 公里，派生配速与速度
click('[data-action="record-type"][data-type="aerobic"]');
const runSelect = qs('[data-record-exercise]');
check('有氧类型默认选中跑步', runSelect?.value === 'running', `实际 ${runSelect?.value}`);
const durationInput = qs('[data-field="duration_sec"]');
durationInput.value = '1860';
fire(durationInput, 'input');
const distanceInput = qs('[data-field="distance_km"]');
distanceInput.value = '10';
fire(distanceInput, 'input');
const computedText = qsa('.computed .chip').map((chip) => chip.textContent).join('|');
check('派生字段实时刷新（配速 / 速度）', computedText.includes('配速') && computedText.includes('速度'), computedText);
click('[data-action="save-log"][data-again="0"]');
check('有氧记录已保存', store.logs.length === 2, `实际 ${store.logs.length}`);
const runLog = store.logs.find((log) => log.exerciseId === 'running');
check('时长按秒落库', runLog?.fields?.duration_sec === 1860, JSON.stringify(runLog?.fields));

// 记住上次输入：切回力量类型应回填 60 / 8
click('[data-action="record-type"][data-type="strength"]');
check('记住上次输入值（60）', qs('[data-field="weight"]')?.value === '60', `实际 ${qs('[data-field="weight"]')?.value}`);
check('记住上次输入值（8）', qs('[data-field="reps"]')?.value === '8');

goto('dashboard');
check('总览最近记录 2 行', qsa('.recent-table tbody tr').length === 2, `实际 ${qsa('.recent-table tbody tr').length}`);
check('本地存储已写入日志', window.localStorage.getItem('workout-block-web:v1:logs') !== null);

// —— 3. 日志视图：分组、筛选、搜索、编辑 ——
console.log('\n[3] 训练日志');
// 追加一条用于小数舍入验证：10 km ÷ (3460 s / 3600) = 10.4046… → 10.4
store.addLog({
  timestamp: ts(-1, 7, 0),
  category: 'aerobic',
  exerciseId: 'running',
  fields: { duration_sec: 3460, distance_km: 10 },
});
goto('history');
check('日志表渲染 3 行数据', qsa('.data-table tbody tr:not(.date-row)').length === 3, `实际 ${qsa('.data-table tbody tr:not(.date-row)').length}`);
check('日期分组行存在', qsa('.date-row').length >= 2, `实际 ${qsa('.date-row').length}`);
const speedChips = qsa('.chip').map((chip) => chip.textContent);
check('速度显示舍入为 10.4 公里/时', speedChips.some((text) => /速度\s*10\.4\s*公里\/时/.test(text)), speedChips.find((text) => text.includes('速度')) ?? '未找到速度 chip');
check('无长小数泄漏（≥4 位小数）', !speedChips.some((text) => /\d\.\d{4,}/.test(text)), speedChips.filter((text) => /\d\.\d{4,}/.test(text)).join('|'));

const searchInput = qs('[data-history-search]');
searchInput.value = '深蹲';
fire(searchInput, 'input');
check('搜索「深蹲」筛选为 1 行', qsa('.data-table tbody tr:not(.date-row)').length === 1, `实际 ${qsa('.data-table tbody tr:not(.date-row)').length}`);
searchInput.value = '';
fire(searchInput, 'input');
check('清空搜索恢复 3 行', qsa('.data-table tbody tr:not(.date-row)').length === 3);

const typeFilter = qs('[data-history-type]');
typeFilter.value = 'aerobic';
fire(typeFilter, 'change');
check('类型筛选（有氧）为 2 行', qsa('.data-table tbody tr:not(.date-row)').length === 2, `实际 ${qsa('.data-table tbody tr:not(.date-row)').length}`);
typeFilter.value = '';
fire(typeFilter, 'change');

const firstRow = qs('[data-log-row]');
const editedId = firstRow?.dataset.logRow;
firstRow?.querySelector('[data-action="edit-log"]')?.click();
check('日志编辑弹窗已打开', !!qs('.modal'));
const noteInput = qs('[data-log-note]');
noteInput.value = '烟雾测试备注';
fire(noteInput, 'input');
click('[data-editor-action="save"]');
check('备注已保存', store.logs.find((log) => log.id === editedId)?.note === '烟雾测试备注');
check('保存后弹窗关闭', !qs('.modal'));

// —— 4. 计划：逐组完成与独立持久化 ——
console.log('\n[4] 训练计划');
goto('plans');
check('计划页 3 张卡片', qsa('.plan-card').length === 3, `实际 ${qsa('.plan-card').length}`);
check('今日排期横幅存在', !!qs('.today-banner'));
const firstSet = qs('[data-action="toggle-plan-set"]');
firstSet?.click();
const toggledPlan = (store.config.plans ?? []).find((plan) => Object.keys(plan.completedSets ?? {}).length > 0);
check('勾选一组后写入完成状态', !!toggledPlan, '没有计划记录 completedSets');
check('完成态渲染为绿色勾', qsa('.set-pill.done').length > 0);
qs('.set-pill.done')?.click();
const stillDone = (store.config.plans ?? []).some((plan) => Object.keys(plan.completedSets ?? {}).length > 0);
check('再次点击取消完成状态', !stillDone);

// —— 5. 统计：计算口径端到端 ——
console.log('\n[5] 数据统计');
goto('analysis', 'stats');
check('渲染 3 张统计卡', qsa('.stat-card').length === 3, `实际 ${qsa('.stat-card').length}`);
const volumeCard = qsa('.stat-card').find((card) => card.textContent.includes('训练总量'));
check('训练总量 = 480（60×8）', !!volumeCard && volumeCard.textContent.includes('480'), volumeCard?.textContent.slice(0, 80));
check('统计范围切换 4 档', qsa('[data-action="analysis-range"]').length === 4);
click('[data-action="analysis-range"][data-range="30d"]');
check('30 天范围高亮', qs('[data-action="analysis-range"][data-range="30d"]').classList.contains('on'));
click('[data-action="analysis-range"][data-range="7d"]');

// —— 6. 肌肉热力图 ——
console.log('\n[6] 肌肉热力图');
goto('analysis', 'heatmap');
check('正面 SVG 挂载', !!qs('.heatmap-canvas .body-figure svg'));
const colored = qsa('.heatmap-canvas .body-figure svg path[style]');
check('存在已上色肌肉路径', colored.length > 0, `上色 ${colored.length} 条`);
check('股四头肌路径已上色（深蹲主练）', colored.some((el) => /rectus_femoris|vastus/.test(el.id)), colored.slice(0, 6).map((el) => el.id).join(','));
check('肌肉明细表 13 行', qsa('.detail-table tbody tr').length === 13, `实际 ${qsa('.detail-table tbody tr').length}`);
check('图例 4 档', qsa('.heatmap-layout .legend i').length === 4);
const metricSelect = qs('[data-analysis-metric]');
check('指标下拉 3 个选项', metricSelect?.options.length === 3, `实际 ${metricSelect?.options.length}`);
click('[data-action="analysis-side"][data-side="back"]');
check('切到背面 SVG', !!qs('.heatmap-canvas .body-figure svg'));
click('[data-action="analysis-side"][data-side="front"]');

// —— 7. 当日总览 ——
console.log('\n[7] 当日总览');
goto('analysis', 'day');
check('4 个当日指标', qsa('.mini-stat').length === 4, `实际 ${qsa('.mini-stat').length}`);
check('日期输入 = 今天', qs('[data-analysis-day]')?.value === dateOffset(0), `实际 ${qs('[data-analysis-day]')?.value}`);
check('按动作汇总表存在', !!qs('.data-table'));
click('[data-action="day-step"][data-step="-1"]');
check('前一天按钮生效', qs('[data-analysis-day]')?.value === dateOffset(-1), `实际 ${qs('[data-analysis-day]')?.value}`);
const dayInput = qs('[data-analysis-day]');
dayInput.value = dateOffset(0);
fire(dayInput, 'change');

// —— 8. 自定义：五个管理分区 ——
console.log('\n[8] 自定义');
goto('customize', 'types');
check('类型卡 3 张', qsa('.type-card').length === 3, `实际 ${qsa('.type-card').length}`);
check('字段表渲染', qsa('.field-table tbody tr').length >= 2);
goto('customize', 'exercises');
check('动作卡 30 张', qsa('.ex-card').length === 30, `实际 ${qsa('.ex-card').length}`);
const exSearch = qs('[data-custom-search="exercise"]');
exSearch.value = '深蹲';
fire(exSearch, 'input');
check('动作搜索过滤为 1 张', qsa('.ex-card').length === 1, `实际 ${qsa('.ex-card').length}`);
exSearch.value = '';
fire(exSearch, 'input');
goto('customize', 'muscles');
check('肌肉卡 13 张', qsa('.muscle-card').length === 13, `实际 ${qsa('.muscle-card').length}`);
check('肌肉颜色分档预览', qsa('.muscle-card .scale i').length === 52, `实际 ${qsa('.muscle-card .scale i').length}`);
goto('customize', 'stats');
check('统计编辑卡 3 张', qsa('.stat-edit-card').length === 3, `实际 ${qsa('.stat-edit-card').length}`);
// 停用 / 启用统计
click('.stat-edit-card [data-action="toggle-stat"]');
check('停用统计已落盘', store.config.statistics[0].enabled === false);
goto('analysis', 'stats');
check('统计页只显示 2 张启用的卡', qsa('.stat-card').length === 2, `实际 ${qsa('.stat-card').length}`);
goto('customize', 'stats');
click('.stat-edit-card [data-action="toggle-stat"]');
check('重新启用统计', store.config.statistics[0].enabled === true);
goto('customize', 'plans');
check('自定义计划列表 3 项', qsa('.mini-item').length === 3, `实际 ${qsa('.mini-item').length}`);

// —— 9. 各类编辑器 ——
console.log('\n[9] 编辑器');
goto('customize', 'types');
click('[data-action="edit-type"]');
check('类型编辑器打开', !!qs('.modal') && !!qs('[data-editor-name]'));
const typeNameInput = qs('[data-editor-name]');
check('类型名预填', typeNameInput?.value === '力量训练', `实际 ${typeNameInput?.value}`);
typeNameInput.value = '力量测试';
fire(typeNameInput, 'input');
click('[data-editor-action="save"]');
check('类型重命名已保存', store.config.trainingTypes[0].name === '力量测试');
check('保存后弹窗关闭', !qs('.modal'));

goto('customize', 'types');
const firstTypeCard = qs('.type-card');
const addFieldBtn = qsa('[data-action="edit-field"]', firstTypeCard).find((btn) => (btn.dataset.field ?? '') === '');
addFieldBtn?.click();
check('字段编辑器打开', !!qs('[data-editor-key]'));
const keyInput = qs('[data-editor-key]');
keyInput.value = 'weight';
fire(keyInput, 'input');
fire(qs('[data-editor-label]'), 'input');
click('[data-editor-action="save"]');
check('重复 key 被拒绝', store.config.trainingTypes[0].fields.length === 2, `实际 ${store.config.trainingTypes[0].fields.length}`);
check('错误提示已显示', (qs('#defEditorError')?.textContent ?? '').includes('不能重复'), qs('#defEditorError')?.textContent ?? '空');
click('[data-action="close-modal"]');

goto('record');
click('[data-action="new-exercise"]');
check('新建动作编辑器打开', !!qs('.modal'));
const newName = qs('[data-editor-name]');
newName.value = '烟雾测试动作';
fire(newName, 'input');
click('[data-editor-action="save"]');
const created = store.config.exercises.find((exercise) => exercise.name === '烟雾测试动作');
check('新动作已写入配置', !!created);
check('新动作即时被选中', !!created && qs('[data-record-exercise]')?.value === created.id, `实际 ${qs('[data-record-exercise]')?.value}`);
check('内联新建弹窗已收起', !qs('.modal'));
store.updateConfig((config) => {
  config.exercises = config.exercises.filter((exercise) => exercise.id !== created.id);
});
check('测试动作已清理', store.config.exercises.length === 30, `实际 ${store.config.exercises.length}`);

goto('customize', 'muscles');
click('[data-action="edit-muscle"]');
check('肌肉编辑器打开', !!qs('.modal'));
check('SVG 路径复选框渲染', qsa('[data-path-id]').length > 50, `实际 ${qsa('[data-path-id]').length}`);
check('默认分档预览', !!qs('.scale-preview'));
click('[data-editor-action="toggle-scale"]');
check('关闭默认分档后出现 4 档编辑器', qsa('.level-row').length === 4, `实际 ${qsa('.level-row').length}`);
click('[data-editor-action="toggle-scale"]');
click('[data-action="close-modal"]');

goto('customize', 'stats');
click('[data-action="edit-stat"][data-stat="volume"]');
check('统计编辑器打开', !!qs('.modal'));
check('统计名预填', qs('[data-editor-name]')?.value === '训练总量', `实际 ${qs('[data-editor-name]')?.value}`);
check('引导式聚合预选乘积求和', qs('[data-stat-kind]')?.value === 'productSum', `实际 ${qs('[data-stat-kind]')?.value}`);
check('热力图分档 4 行', qsa('.level-row').length === 4, `实际 ${qsa('.level-row').length}`);
click('[data-action="close-modal"]');

goto('plans');
click('[data-action="edit-plan"]');
check('计划编辑器打开', !!qs('.modal'));
check('星期选择器 7 个', qsa('.weekday-chip').length === 7, `实际 ${qsa('.weekday-chip').length}`);
const setCardsBefore = qsa('.set-edit-card').length;
click('[data-editor-action="add-set"]');
check('添加一组生效', qsa('.set-edit-card').length === setCardsBefore + 1, `${setCardsBefore} → ${qsa('.set-edit-card').length}`);
click('[data-action="close-modal"]');

// —— 10. 设置：偏好、语言、单位、主题 ——
console.log('\n[10] 设置');
goto('settings');
check('设置页分区导航 4 项', qsa('.settings-nav button').length === 4, `实际 ${qsa('.settings-nav button').length}`);
check('偏好设置行 ≥ 8', qsa('.setting-row').length >= 8, `实际 ${qsa('.setting-row').length}`);

setSetting('language', 'en');
const navTexts = qsa('.nav-item span').map((span) => span.textContent);
check('导航切换为英文', navTexts.includes('Dashboard') && navTexts.includes('Customize'), navTexts.join('|'));
check('页面标题切换为英文', qs('.topbar-title h1')?.textContent.trim() === 'Settings', qs('.topbar-title h1')?.textContent);
setSetting('language', 'zh');
check('导航切回中文', qsa('.nav-item span').some((span) => span.textContent === '总览'));

const themeBefore = doc.documentElement.dataset.theme;
click('[data-action="toggle-theme"]');
const themeAfter = doc.documentElement.dataset.theme;
check('主题按钮切换 data-theme', themeAfter !== themeBefore, `${themeBefore} → ${themeAfter}`);
click('[data-action="toggle-theme"]');
check('主题切回原值', doc.documentElement.dataset.theme === themeBefore);

setSetting('unit', 'lb');
check('重量单位切换为 lb', store.settings.unit === 'lb');
goto('record');
check('记录页单位后缀显示 lb', qsa('.unit-suffix').some((el) => el.textContent.includes('lb')), qsa('.unit-suffix').map((el) => el.textContent).join('|'));
goto('settings');
setSetting('unit', 'kg');
check('重量单位切回 kg', store.settings.unit === 'kg');

setSetting('decimals', '2');
check('小数位设置已保存', store.settings.decimals === 2);
setSetting('decimals', '0');
setSetting('defaultRange', '30d');
check('默认统计范围已保存', store.settings.defaultRange === '30d');
setSetting('defaultRange', '7d');

const rememberBtn = qs('[data-action="toggle-remember"]');
check('记住上次输入默认开启', rememberBtn?.classList.contains('on'));
rememberBtn?.click();
check('开关可关闭', store.settings.remember === false);
qs('[data-action="toggle-remember"]')?.click();
check('开关可恢复', store.settings.remember === true);
qs('[data-action="toggle-autoclear"]')?.click();
check('保存后清空开关可关闭', store.settings.autoClear === false);
qs('[data-action="toggle-autoclear"]')?.click();

// —— 11. CSV / 配置 / 完整备份互通 ——
console.log('\n[11] 数据互通');
const csv = store.exportCsv();
check('导出含规范表头', csv.startsWith('id,timestamp,exerciseId,category,fields,note,plan,deleted'));
check('导出 3 条数据行', csv.split('\n').length === 4, `实际 ${csv.split('\n').length} 行`);
const duplicate = store.importCsv(csv);
check('重复导入全部跳过', duplicate.added === 0 && duplicate.skipped === 3, JSON.stringify(duplicate));
const bom = store.importCsv('\uFEFF' + csv);
check('带 BOM 的 CSV 不重复导入', bom.added === 0 && bom.skipped >= 3, JSON.stringify(bom));
const configRoundtrip = store.importConfigJson(store.exportConfigJson());
check('配置 JSON 可往返导入', configRoundtrip.ok === true, JSON.stringify(configRoundtrip));

const backup = store.exportBackupJson();
check('完整备份包含配置/设置/记录', backup.includes('"config"') && backup.includes('"settings"') && backup.includes('"logs"'));
store.resetAll();
check('重置后记录清空', store.logs.length === 0, `实际 ${store.logs.length}`);
check('重置后恢复种子配置', store.config.trainingTypes.length === 3 && store.config.statistics.length === 3);
const restored = store.importBackupJson(backup);
check('备份恢复成功', restored.ok === true && restored.logs === 3, JSON.stringify(restored));
check('恢复后记录数一致', store.logs.length === 3, `实际 ${store.logs.length}`);
check('恢复后设置一致', store.settings.language === 'zh' && store.settings.unit === 'kg');
check('恢复后类型重命名保留', store.config.trainingTypes[0].name === '力量测试');

// —— 12. 删除兜底 ——
console.log('\n[12] 删除与兜底');
goto('customize', 'types');
click('[data-action="delete-type"]');
check('有动作时拒绝删除训练类型', store.config.trainingTypes.length === 3);
check('拒绝时不弹确认框', !qs('.modal-backdrop'));

store.updateConfig((config) => {
  config.statistics = config.statistics.filter((stat) => stat.id !== 'count');
});
goto('analysis', 'heatmap');
check('删除默认指标后回退到剩余统计', qs('[data-analysis-metric]')?.value === 'volume', `实际 ${qs('[data-analysis-metric]')?.value}`);

store.updateConfig((config) => {
  config.statistics = [];
});
goto('analysis', 'stats');
check('无统计时显示空态', !!qs('.empty') && (qs('.empty')?.textContent ?? '').includes('统计指标'), qs('.empty')?.textContent ?? '');
goto('analysis', 'heatmap');
check('无统计时热力图显示空态', !!qs('.empty'));

const finalRestore = store.importBackupJson(backup);
goto('analysis', 'stats');
check('最终恢复备份', finalRestore.ok === true && qsa('.stat-card').length === 3, `实际 ${qsa('.stat-card').length} 张`);

// —— 13. 安全与周期口径回归 ——
console.log('\n[13] 安全与周期口径');

// 确认框里的用户数据必须转义（配置可从外部导入，不能当 HTML 执行）
store.updateConfig((config) => {
  config.plans = config.plans ?? [];
  config.plans.push({
    id: 'xss-plan',
    name: '<img src=x onerror="window.__xss=1">',
    timeRule: { type: 'weekday', weekdays: [1] },
    createdAt: dateOffset(0),
    items: [],
  });
});
goto('plans');
click('[data-action="delete-plan"][data-plan="xss-plan"]');
const modalBody = qs('#modalRoot .modal-body');
check('确认框不把计划名当 HTML 执行', !!modalBody && !modalBody.querySelector('img') && window.__xss !== 1);
check('确认框按字面显示计划名', (modalBody?.textContent ?? '').includes('<img src=x'));
click('[data-action="confirm-yes"]');

// 配色脏值必须回落，不能闭合 style 属性注入事件处理器
store.updateConfig((config) => {
  config.statistics[0].heatmapScale = [{ max: 10, color: 'red" onmouseover="window.__xssColor=1' }];
});
goto('analysis', 'heatmap');
const legendDot = qsa('.legend i')[0];
check('非法配色回落到安全色', (legendDot?.getAttribute('style') ?? '') === 'background:#c9c7bf', legendDot?.getAttribute('style') ?? '');
check('非法配色不产生事件属性', !legendDot?.hasAttribute('onmouseover'));

// 周计划的完成态按自然周判定：上周勾的组，本周打开应重新是未完成
const weekPlan = (store.config.plans ?? []).find((plan) => plan.items.some((item) => item.sets.length));
const weekItem = weekPlan?.items.find((item) => item.sets.length);
const weekSet = weekItem?.sets[0];
if (weekPlan && weekItem && weekSet) {
  const lastWeek = dateOffset(-8);
  store.updateConfig((config) => {
    const target = config.plans.find((plan) => plan.id === weekPlan.id);
    target.completedSets = { [`${weekItem.exerciseId}#${weekSet.id}`]: lastWeek };
  });
  goto('plans');
  const pill = qs(
    `[data-action="toggle-plan-set"][data-plan="${weekPlan.id}"][data-exercise="${weekItem.exerciseId}"][data-set="${weekSet.id}"]`
  );
  check('上周完成的组本周显示为未完成', !!pill && !pill.classList.contains('done'));
  const kept = store.config.plans.find((plan) => plan.id === weekPlan.id).completedSets;
  check('历史完成日期仍保留', !!kept?.[`${weekItem.exerciseId}#${weekSet.id}`]);
}

// 汇总
console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}\n`);
process.exit(failures === 0 ? 0 : 1);
