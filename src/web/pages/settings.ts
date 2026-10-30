/*
 * settings.ts —— 设置页：偏好、数据导出/导入、存储占用与危险操作。
 * 网页版没有 Obsidian vault，所有数据都在 localStorage（浏览器本地）。
 */

import { icon } from '../icons';
import { UiContext } from '../context';
import { L, esc, formatInt } from '../format';
import type { WebRange } from '../store';

const APP_VERSION = '1.0.6';

function bytesText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function switchRow(
  title: string,
  desc: string,
  action: string,
  on: boolean,
  data = ''
): string {
  return (
    '<div class="setting-row"><div class="setting-info">' +
    `<b>${esc(title)}</b><span>${esc(desc)}</span></div>` +
    `<div class="setting-control"><button class="switch${on ? ' on' : ''}" data-action="${action}"${data}></button></div></div>`
  );
}

function prefSection(ctx: UiContext): string {
  const { settings, config } = ctx.store;
  const ranges: [WebRange, string][] = [
    ['7d', L('最近 7 天', 'Last 7 days')],
    ['30d', L('最近 30 天', 'Last 30 days')],
    ['90d', L('最近 90 天', 'Last 90 days')],
    ['all', L('全部', 'All time')],
  ];
  return (
    '<div class="card settings-card" id="settings-prefs">' +
    `<div class="card-title" style="margin-bottom:14px">${icon('sliders')}${esc(L('偏好', 'Preferences'))}</div>` +
    '<div class="setting-row"><div class="setting-info"><b>' +
    esc(L('界面语言', 'Language')) +
    '</b><span>' +
    esc(L('界面文案与默认名称的显示语言', 'Interface copy and default names')) +
    '</span></div><div class="setting-control">' +
    `<select class="select" data-setting="language"><option value="zh"${settings.language === 'zh' ? ' selected' : ''}>中文</option><option value="en"${settings.language === 'en' ? ' selected' : ''}>English</option></select>` +
    '</div></div>' +
    '<div class="setting-row"><div class="setting-info"><b>' +
    esc(L('重量单位', 'Weight unit')) +
    '</b><span>' +
    esc(L('内部统一存 kg，显示与输入时换算', 'Stored as kg internally; converted for display and input')) +
    '</span></div><div class="setting-control">' +
    `<select class="select" data-setting="unit"><option value="kg"${settings.unit === 'kg' ? ' selected' : ''}>kg</option><option value="lb"${settings.unit === 'lb' ? ' selected' : ''}>lb</option></select>` +
    '</div></div>' +
    '<div class="setting-row"><div class="setting-info"><b>' +
    esc(L('主题', 'Theme')) +
    '</b><span>' +
    esc(L('浅色 / 深色，跟随顶部按钮同步', 'Light / dark, synced with the topbar button')) +
    '</span></div><div class="setting-control">' +
    `<select class="select" data-setting="theme"><option value="light"${settings.theme === 'light' ? ' selected' : ''}>${esc(
      L('浅色', 'Light')
    )}</option><option value="dark"${settings.theme === 'dark' ? ' selected' : ''}>${esc(L('深色', 'Dark'))}</option></select>` +
    '</div></div>' +
    '<div class="setting-row"><div class="setting-info"><b>' +
    esc(L('统计小数位', 'Stat decimals')) +
    '</b><span>' +
    esc(L('统计值与训练量保留的小数位', 'Decimal places for statistics and volume')) +
    '</span></div><div class="setting-control">' +
    `<select class="select" data-setting="decimals">${[0, 1, 2]
      .map((n) => `<option value="${n}"${settings.decimals === n ? ' selected' : ''}>${n}</option>`)
      .join('')}</select>` +
    '</div></div>' +
    switchRow(
      L('记住上次输入值', 'Remember last values'),
      L('切换动作时自动填回上一次记录，连续多组更快', 'Prefill the last values when switching exercises'),
      'toggle-remember',
      settings.remember
    ) +
    switchRow(
      L('保存后清空数值', 'Clear after save'),
      L('保存一组后清空输入框；「保存并再来一组」不受影响', 'Clear inputs after save; "Save & another" keeps values'),
      'toggle-autoclear',
      settings.autoClear
    ) +
    '<div class="setting-row"><div class="setting-info"><b>' +
    esc(L('默认统计范围', 'Default range')) +
    '</b><span>' +
    esc(L('分析页默认查看的时间窗', 'Default window on the analysis page')) +
    '</span></div><div class="setting-control">' +
    `<select class="select" data-setting="defaultRange">${ranges
      .map(
        ([value, label]) =>
          `<option value="${value}"${settings.defaultRange === value ? ' selected' : ''}>${esc(label)}</option>`
      )
      .join('')}</select>` +
    '</div></div>' +
    '<div class="setting-row"><div class="setting-info"><b>' +
    esc(L('默认热力图指标', 'Default heatmap metric')) +
    '</b><span>' +
    esc(L('打开热力图时优先使用', 'Preferred metric when opening the heatmap')) +
    '</span></div><div class="setting-control">' +
    `<select class="select" data-setting="defaultMetricId"><option value="">${esc(
      L('跟随配置', 'Follow config')
    )}</option>${config.statistics
      .map(
        (stat) =>
          `<option value="${esc(stat.id)}"${settings.defaultMetricId === stat.id ? ' selected' : ''}>${esc(
            stat.name
          )}</option>`
      )
      .join('')}</select>` +
    '</div></div>' +
    '</div>'
  );
}

function dataSection(ctx: UiContext): string {
  const { config, logs } = ctx.store;
  const days = new Set(logs.map((log) => log.timestamp.slice(0, 10))).size;
  const bytes = ctx.store.storageBytes();
  const pct = Math.min(100, Math.round((bytes / (5 * 1024 * 1024)) * 100));
  return (
    '<div class="card settings-card" id="settings-data">' +
    `<div class="card-title" style="margin-bottom:14px">${icon('database')}${esc(L('数据', 'Data'))}</div>` +
    '<div class="data-stat">' +
    `<div><b>${formatInt(logs.length)}</b><span>${esc(L('训练记录', 'Log rows'))}</span></div>` +
    `<div><b>${formatInt(days)}</b><span>${esc(L('训练天数', 'Training days'))}</span></div>` +
    `<div><b>${formatInt(config.exercises.length)}</b><span>${esc(L('动作', 'Exercises'))}</span></div>` +
    '</div>' +
    `<div class="storage-line"><i style="width:${pct}%"></i></div>` +
    `<div class="faint">${esc(L('本地存储占用', 'Local storage'))} ${esc(bytesText(bytes))} · ${pct}% / 5 MB</div>` +
    '<div class="divider"></div>' +
    '<div class="mini-toolbar" style="margin-bottom:10px">' +
    `<button class="btn btn-outline btn-sm" data-action="export-csv">${icon('download', 'ic-sm')}${esc(L('导出训练 CSV', 'Export CSV'))}</button>` +
    `<button class="btn btn-outline btn-sm" data-action="import-csv">${icon('upload', 'ic-sm')}${esc(L('导入训练 CSV', 'Import CSV'))}</button>` +
    `<button class="btn btn-outline btn-sm" data-action="export-config">${icon('download', 'ic-sm')}${esc(L('导出配置 JSON', 'Export config'))}</button>` +
    `<button class="btn btn-outline btn-sm" data-action="import-config">${icon('upload', 'ic-sm')}${esc(L('导入配置 JSON', 'Import config'))}</button>` +
    '</div>' +
    '<div class="mini-toolbar" style="margin-bottom:0">' +
    `<button class="btn btn-primary btn-sm" data-action="export-backup">${icon('database', 'ic-sm')}${esc(L('完整备份', 'Full backup'))}</button>` +
    `<button class="btn btn-outline btn-sm" data-action="import-backup">${icon('upload', 'ic-sm')}${esc(L('恢复备份', 'Restore backup'))}</button>` +
    `<button class="btn btn-outline btn-sm" data-action="seed-demo">${icon('zap', 'ic-sm')}${esc(L('载入演示数据', 'Load demo data'))}</button>` +
    '</div>' +
    `<div class="faint" style="margin-top:10px">${esc(
      L(
        '备份包含配置、设置与全部训练记录，可换浏览器/换设备恢复。「载入演示数据」只追加示例训练记录，不动配置与设置。',
        'A backup contains config, settings and all logs; restore it in another browser or device. "Load demo data" only appends sample logs and leaves config and settings untouched.'
      )
    )}</div>` +
    '<input type="file" accept=".csv,text/csv" data-import-file="csv" hidden />' +
    '<input type="file" accept=".json,application/json" data-import-file="json" hidden />' +
    '<input type="file" accept=".json,application/json" data-import-file="backup" hidden />' +
    '</div>'
  );
}

function aboutSection(): string {
  return (
    '<div class="card settings-card" id="settings-about">' +
    `<div class="card-title" style="margin-bottom:14px">${icon('info')}${esc(L('关于', 'About'))}</div>` +
    `<div class="about-row"><span>${esc(L('版本', 'Version'))}</span><b>v${APP_VERSION} · ${esc(
      L('网页版', 'Web Edition')
    )}</b></div>` +
    `<div class="about-row"><span>${esc(L('数据位置', 'Storage'))}</span><b>localStorage</b></div>` +
    `<div class="about-row"><span>${esc(L('运行方式', 'Runtime'))}</span><b>${esc(
      L('纯静态、离线可用', 'Static & offline')
    )}</b></div>` +
    `<div class="about-row"><span>${esc(L('与插件关系', 'Relation to plugin'))}</span><b>${esc(
      L('共享数据模型，独立运行', 'Shares data model, runs standalone')
    )}</b></div>` +
    '<div class="faint" style="margin-top:10px">' +
    esc(
      L(
        '人体肌肉图：Figma Muscle Atlas by Ryan Graves，经 flutter-body-atlas 引入，依 CC BY 4.0 授权（署名保留，去除头部区域）。',
        'Muscle artwork: Figma Muscle Atlas by Ryan Graves, via flutter-body-atlas, licensed CC BY 4.0 (attribution kept, head region removed).'
      )
    ) +
    ' <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>' +
    '</div>' +
    `<div class="faint" style="margin-top:6px">${esc(
      L(
        '网页版不需要 Obsidian，也不会写入你的 vault。',
        'The web edition does not need Obsidian and never writes to your vault.'
      )
    )}</div></div>`
  );
}

function dangerSection(): string {
  return (
    '<div class="card danger-zone" id="settings-danger">' +
    `<div class="card-title" style="margin-bottom:10px">${icon('alert')}${esc(L('危险操作', 'Danger zone'))}</div>` +
    `<div class="muted" style="margin-bottom:12px">${esc(
      L(
        '清空浏览器内的全部训练记录、配置与设置，恢复默认种子数据。此操作不可撤销。',
        'Erase all logs, config and settings in this browser and restore seed data. This cannot be undone.'
      )
    )}</div>` +
    `<button class="btn btn-danger" data-action="reset-all">${icon('trash', 'ic-sm')}${esc(
      L('清空并重置全部数据', 'Reset all data')
    )}</button>` +
    '</div>'
  );
}

export function renderSettings(ctx: UiContext): string {
  return (
    '<div class="page-head"><div><h2>' +
    esc(L('设置', 'Settings')) +
    '</h2><p>' +
    esc(L('偏好、数据与备份', 'Preferences, data and backups')) +
    '</p></div></div>' +
    '<div class="settings-grid">' +
    '<div class="settings-nav">' +
    `<button class="on" data-scroll="settings-prefs">${esc(L('偏好', 'Preferences'))}</button>` +
    `<button data-scroll="settings-data">${esc(L('数据与备份', 'Data & backup'))}</button>` +
    `<button data-scroll="settings-about">${esc(L('关于', 'About'))}</button>` +
    `<button data-scroll="settings-danger">${esc(L('危险操作', 'Danger zone'))}</button>` +
    '</div>' +
    '<div>' +
    prefSection(ctx) +
    dataSection(ctx) +
    aboutSection() +
    dangerSection() +
    '</div></div>'
  );
}
