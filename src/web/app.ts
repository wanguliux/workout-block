/*
 * app.ts —— 网页版应用外壳与交互总线。
 *
 * 结构：左侧导航 + 顶栏 + 视图容器 + 移动端底部导航。
 * 页面本身是「数据 → HTML 字符串」的纯函数（pages/*），这里只负责：
 *  - hash 路由（#/dashboard、#/analysis/heatmap、#/customize/muscles）；
 *  - 全局事件委托（data-action / data-page / 表单输入）；
 *  - 弹窗、确认、toast、导入导出与 heatmap PNG 导出。
 */

import { LogRow } from '../data/types';
import { applyMappingTier } from '../data/muscleMapping';
import { getExerciseNameById } from '../data/display';
import { WebStore, isStoreKey } from './store';
import { seedDemoLogs } from './demo';
import { UiContext } from './context';
import { PageId, state, initState, resetRecordState, HISTORY_PAGE } from './state';
import type { AnalysisTab, CustomTab } from './state';
import { icon } from './icons';
import { L, esc, addDays, downloadText, nowLocalValue, readFileText, toStorageTime, todayStr } from './format';
import { refreshComputedIn, parseDraft } from './fields';
import { exercisesOfType, toggleSetDone, typeOf, logExerciseName, sortLogsDesc } from './calc';
import { toast, closeModal, acceptConfirm, confirmDialog } from './ui';
import { renderDashboard } from './pages/dashboard';
import { renderRecord, ensureRecordSelection, initialValuesFor, valuesFromLog } from './pages/record';
import { renderHistory, renderHistoryBody } from './pages/history';
import { renderPlans } from './pages/plans';
import { renderAnalysis } from './pages/analysis';
import { renderCustomize, renderCustomBody } from './pages/customize';
import { renderSettings } from './pages/settings';
import { openPlanEditor } from './editors/planEditor';
import { openLogEditor } from './editors/logEditor';
import { openMuscleEditor } from './editors/muscleEditor';
import { openStatEditor } from './editors/statEditor';
import { openTypeEditor, openFieldEditor, openExerciseEditor } from './editors/defEditors';
import { closeEditor } from './editors/editorHost';

interface NavItem {
  page: PageId;
  tab?: string;
  label: [string, string];
  icon: string;
}

interface NavGroup {
  title: [string, string];
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    title: ['概览', 'Overview'],
    items: [{ page: 'dashboard', label: ['总览', 'Dashboard'], icon: 'grid' }],
  },
  {
    title: ['训练', 'Training'],
    items: [
      { page: 'record', label: ['记录一组', 'Log a set'], icon: 'plusCircle' },
      { page: 'history', label: ['训练日志', 'History'], icon: 'list' },
      { page: 'plans', label: ['训练计划', 'Plans'], icon: 'calendar' },
    ],
  },
  {
    title: ['分析', 'Analysis'],
    items: [
      { page: 'analysis', tab: 'stats', label: ['数据统计', 'Statistics'], icon: 'chart' },
      { page: 'analysis', tab: 'heatmap', label: ['肌肉热力图', 'Heatmap'], icon: 'activity' },
      { page: 'analysis', tab: 'day', label: ['当日总览', 'Day overview'], icon: 'table' },
    ],
  },
  {
    title: ['系统', 'System'],
    items: [
      { page: 'customize', label: ['自定义', 'Customize'], icon: 'sliders' },
      { page: 'settings', label: ['设置', 'Settings'], icon: 'gear' },
    ],
  },
];

const MOBILE_NAV: NavItem[] = [
  { page: 'dashboard', label: ['总览', 'Home'], icon: 'grid' },
  { page: 'record', label: ['记录', 'Log'], icon: 'plusCircle' },
  { page: 'history', label: ['日志', 'History'], icon: 'list' },
  { page: 'analysis', tab: 'stats', label: ['分析', 'Stats'], icon: 'chart' },
  { page: 'settings', label: ['设置', 'Settings'], icon: 'gear' },
];

const ANALYSIS_TABS: AnalysisTab[] = ['stats', 'heatmap', 'day'];
const CUSTOM_TABS: CustomTab[] = ['types', 'exercises', 'muscles', 'stats', 'plans'];

const PAGE_TITLE: Record<PageId, [string, string]> = {
  dashboard: ['总览', 'Dashboard'],
  record: ['记录一组', 'Log a set'],
  history: ['训练日志', 'History'],
  plans: ['训练计划', 'Plans'],
  analysis: ['训练分析', 'Analysis'],
  customize: ['自定义', 'Customize'],
  settings: ['设置', 'Settings'],
};

const SUBTITLE: Record<PageId, [string, string]> = {
  dashboard: ['今天，从一组开始', 'Start with one set today'],
  record: ['类型 → 动作 → 数值，5 秒记一组', 'Type, exercise, values — five seconds'],
  history: ['回看、编辑、再次记录', 'Review, edit and repeat'],
  plans: ['按周节奏推进训练', 'Keep a weekly rhythm'],
  analysis: ['统计、热力图与当日总览', 'Statistics, heatmap and daily view'],
  customize: ['类型、动作、肌肉与统计', 'Types, exercises, muscles and stats'],
  settings: ['偏好、数据与备份', 'Preferences, data and backups'],
};

const ANALYSIS_SUBTITLE: Record<AnalysisTab, [string, string]> = {
  stats: ['每个指标都随记录实时计算', 'Every metric is computed from your logs'],
  heatmap: ['主练 1.0 / 辅练 0.5 加权', 'Primary 1.0 / secondary 0.5'],
  day: ['按天拆解每一组', 'Every set, one day at a time'],
};

const CUSTOM_TITLE: Record<CustomTab, [string, string]> = {
  types: ['训练类型', 'Types'],
  exercises: ['动作库', 'Exercises'],
  muscles: ['肌肉与映射', 'Muscles'],
  stats: ['统计指标', 'Statistics'],
  plans: ['训练计划', 'Plans'],
};

function bytesText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function parseHash(hash: string): { page: PageId; tab?: string } {
  const raw = hash.replace(/^#\/?/, '').trim();
  const [pageRaw, tabRaw] = raw.split('/');
  const pages: PageId[] = ['dashboard', 'record', 'history', 'plans', 'analysis', 'customize', 'settings'];
  const page = (pages as string[]).includes(pageRaw) ? (pageRaw as PageId) : 'dashboard';
  return { page, tab: tabRaw || undefined };
}

function hashFor(page: PageId, tab?: string): string {
  return `#/${page}${tab ? `/${tab}` : ''}`;
}

function navActive(item: NavItem): boolean {
  if (item.page !== state.page) return false;
  if (item.page === 'analysis') return (item.tab ?? 'stats') === state.analysis.tab;
  if (item.page === 'customize') return true;
  return true;
}

function navHTML(mobile = false): string {
  if (mobile) {
    return MOBILE_NAV.map(
      (item) =>
        `<button class="mnav-item${navActive(item) ? ' on' : ''}" data-nav data-nav-page="${item.page}"${
          item.tab ? ` data-nav-tab="${item.tab}"` : ''
        }>${icon(item.icon)}<span>${esc(L(item.label[0], item.label[1]))}</span></button>`
    ).join('');
  }
  return NAV.map(
    (group) =>
      '<div class="nav-group">' +
      `<div class="nav-group-title">${esc(L(group.title[0], group.title[1]))}</div>` +
      group.items
        .map(
          (item) =>
            `<button class="nav-item${navActive(item) ? ' on' : ''}" data-nav data-nav-page="${item.page}"${
              item.tab ? ` data-nav-tab="${item.tab}"` : ''
            }>${icon(item.icon)}<span>${esc(L(item.label[0], item.label[1]))}</span></button>`
        )
        .join('') +
      '</div>'
  ).join('');
}

export class WebApp {
  private root: HTMLElement | null = null;
  private ctx: UiContext;

  constructor(private store: WebStore) {
    this.ctx = { store, refresh: () => this.renderView() };
    initState(store);
    resetRecordState(store);
    this.store.onChange(() => this.renderAll());
  }

  mount(root: HTMLElement): void {
    this.root = root;
    document.addEventListener('click', (event) => this.onClick(event));
    document.addEventListener('input', (event) => this.onInput(event));
    document.addEventListener('change', (event) => this.onChange(event));
    document.addEventListener('keydown', (event) => this.onKeydown(event));
    window.addEventListener('hashchange', () => this.applyRoute());
    // 写盘失败（配额满 / 隐私模式）：必须让用户知道这次改动没落盘
    this.store.onPersistError(() => {
      toast(
        L(
          '本地存储写入失败（可能已满或被禁用），本次改动只在内存里，刷新会丢失',
          'Saving locally failed (storage full or blocked). This change is in memory only and will be lost on reload.'
        )
      );
    });
    // 多标签页同步：别的标签改了数据，本标签跟随重载
    window.addEventListener('storage', (event) => {
      if (isStoreKey(event.key)) this.store.reloadFromStorage();
    });
    this.applyRoute();
  }

  // ============================ 路由与外壳 ============================

  go(page: PageId, tab?: string): void {
    this.hideSearchPop();
    const next = hashFor(page, tab);
    if (window.location.hash === next) {
      state.page = page;
      if (page === 'analysis') state.analysis.tab = (ANALYSIS_TABS.includes(tab as AnalysisTab) ? tab : 'stats') as AnalysisTab;
      if (page === 'customize') state.custom.tab = (CUSTOM_TABS.includes(tab as CustomTab) ? tab : state.custom.tab) as CustomTab;
      this.renderAll();
    } else {
      window.location.hash = next;
    }
  }

  private applyRoute(): void {
    const route = parseHash(window.location.hash);
    state.page = route.page;
    if (route.page === 'analysis') {
      state.analysis.tab = (ANALYSIS_TABS.includes(route.tab as AnalysisTab) ? route.tab : 'stats') as AnalysisTab;
    }
    if (route.page === 'customize' && route.tab && CUSTOM_TABS.includes(route.tab as CustomTab)) {
      state.custom.tab = route.tab as CustomTab;
    }
    this.renderAll();
  }

  private title(): [string, string] {
    if (state.page === 'analysis') return ANALYSIS_SUBTITLE[state.analysis.tab];
    if (state.page === 'customize') return CUSTOM_TITLE[state.custom.tab];
    return SUBTITLE[state.page];
  }

  private heading(): string {
    if (state.page === 'analysis') {
      const tab = state.analysis.tab;
      return L(
        tab === 'stats' ? '数据统计' : tab === 'heatmap' ? '肌肉热力图' : '当日总览',
        tab === 'stats' ? 'Statistics' : tab === 'heatmap' ? 'Muscle heatmap' : 'Day overview'
      );
    }
    if (state.page === 'customize') return L(CUSTOM_TITLE[state.custom.tab][0], CUSTOM_TITLE[state.custom.tab][1]);
    return L(PAGE_TITLE[state.page][0], PAGE_TITLE[state.page][1]);
  }

  private renderAll(): void {
    if (!this.root) return;
    document.documentElement.dataset.theme = this.store.settings.theme;
    const [subZh, subEn] = this.title();
    const subtitle = L(subZh, subEn);
    const bytes = this.store.storageBytes();
    const pct = Math.min(100, Math.round((bytes / (5 * 1024 * 1024)) * 100));
    const dark = this.store.settings.theme === 'dark';

    this.root.innerHTML =
      '<div class="app">' +
      '<aside class="sidebar">' +
      '<div class="sidebar-brand">' +
      `<div class="brand-mark">${icon('dumbbell')}</div>` +
      '<div><b>WorkOut Block</b><span>Web Edition</span></div>' +
      '</div>' +
      `<nav class="side-nav">${navHTML()}</nav>` +
      '<div class="sidebar-foot">' +
      '<div class="storage-card">' +
      `<div class="storage-head"><span>${esc(L('本地存储', 'Local storage'))}</span><b>${esc(
        bytesText(bytes)
      )}</b></div>` +
      `<div class="storage-bar"><i style="width:${pct}%"></i></div>` +
      `<div class="faint">${esc(
        L(`${this.store.logs.length} 条记录 · 仅存此浏览器`, `${this.store.logs.length} logs · this browser only`)
      )}</div>` +
      '</div>' +
      `<div class="user-chip"><span class="avatar">W</span><div><b>${esc(
        L('本地账户', 'Local account')
      )}</b><span>localStorage</span></div></div>` +
      '</div></aside>' +
      '<div class="main">' +
      '<header class="topbar">' +
      '<div class="topbar-title"><div class="topbar-eyebrow">' +
      esc(L('WorkOut Block · 训练记录', 'WorkOut Block · Training log')) +
      `</div><h1>${esc(this.heading())}</h1><p>${esc(subtitle)}</p></div>` +
      '<div class="topbar-search">' +
      icon('search') +
      `<input id="globalSearch" type="search" placeholder="${esc(
        L('搜索动作 / 备注，回车查看日志', 'Search exercise or note, press Enter')
      )}" autocomplete="off" />` +
      `<kbd>Ctrl K</kbd>` +
      '<div class="search-pop" id="searchPop" hidden></div>' +
      '</div>' +
      '<div class="topbar-actions">' +
      `<button class="icon-btn theme-btn" data-action="toggle-theme" title="${esc(
        dark ? L('切换浅色', 'Light theme') : L('切换深色', 'Dark theme')
      )}">${icon(dark ? 'sun' : 'moon')}</button>` +
      `<button class="btn btn-primary" data-page="record">${icon('plus')}${esc(L('记录一组', 'Log a set'))}</button>` +
      '</div></header>' +
      `<main class="view" id="view"></main>` +
      '</div>' +
      `<nav class="mobile-nav">${navHTML(true)}</nav>` +
      '</div>' +
      '<div id="modalRoot"></div>';
    // 注意：#toast 不能放在外壳 HTML 里——外壳会被整段重渲染（改设置、存记录都会），
    // 刚弹出的提示会被一起换掉。由 ui.toast() 自己在 <body> 上创建并复用。

    this.renderView();
  }

  private renderView(): void {
    const view = document.getElementById('view');
    if (!view) return;
    const ctx = this.ctx;
    switch (state.page) {
      case 'record':
        ensureRecordSelection(ctx);
        view.innerHTML = renderRecord(ctx);
        break;
      case 'history':
        view.innerHTML = renderHistory(ctx);
        break;
      case 'plans':
        view.innerHTML = renderPlans(ctx);
        break;
      case 'analysis':
        view.innerHTML = renderAnalysis(ctx);
        break;
      case 'customize':
        view.innerHTML = renderCustomize(ctx);
        break;
      case 'settings':
        view.innerHTML = renderSettings(ctx);
        break;
      default:
        view.innerHTML = renderDashboard(ctx);
    }
  }

  private renderViewKeepFocus(selector: string): void {
    const active = document.activeElement as HTMLInputElement | HTMLSelectElement | null;
    const start = active instanceof HTMLInputElement ? active.selectionStart : null;
    const end = active instanceof HTMLInputElement ? active.selectionEnd : null;
    this.renderView();
    const next = document.querySelector<HTMLElement>(selector);
    if (next) {
      next.focus();
      if (next instanceof HTMLInputElement && start !== null && end !== null) {
        try {
          next.setSelectionRange(start, end);
        } catch {
          /* 某些 input 类型不支持选区，忽略 */
        }
      }
    }
  }

  // ============================ 事件委托 ============================

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;

    const backdrop = target.closest<HTMLElement>('[data-action="backdrop"]');
    if (backdrop && backdrop === target) {
      closeModal();
      return;
    }

    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (actionEl) {
      event.preventDefault();
      this.action(actionEl);
      return;
    }

    const pageEl = target.closest<HTMLElement>('[data-page]');
    if (pageEl) {
      event.preventDefault();
      closeModal();
      this.go(pageEl.dataset.page as PageId, pageEl.dataset.tab);
      return;
    }

    const navEl = target.closest<HTMLElement>('[data-nav]');
    if (navEl) {
      event.preventDefault();
      this.go(navEl.dataset.navPage as PageId, navEl.dataset.navTab);
      return;
    }

    const scrollEl = target.closest<HTMLElement>('[data-scroll]');
    if (scrollEl) {
      event.preventDefault();
      const el = document.getElementById(scrollEl.dataset.scroll ?? '');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.querySelectorAll('.settings-nav button').forEach((btn) => btn.classList.toggle('on', btn === scrollEl));
    }

    // 兜底：点到搜索框以外的任何位置都收起建议面板
    if (!target.closest('.topbar-search')) this.hideSearchPop();
  }

  private action(el: HTMLElement): void {
    const action = el.dataset.action ?? '';
    const ctx = this.ctx;
    const unit = this.store.settings.unit;

    switch (action) {
      case 'close-modal':
        closeEditor();
        return;
      case 'confirm-yes':
        acceptConfirm();
        return;
      case 'toggle-theme':
        this.store.updateSettings({ theme: this.store.settings.theme === 'dark' ? 'light' : 'dark' });
        return;
      case 'trend': {
        const trend = el.dataset.trend;
        if (trend === 'sets' || trend === 'volume' || trend === 'time') {
          state.trend = trend;
          this.renderView();
        }
        return;
      }
      case 'quick-record': {
        const exerciseId = el.dataset.exercise ?? '';
        const exercise = this.store.config.exercises.find((item) => item.id === exerciseId);
        if (!exercise) {
          toast(L('该动作已不存在', 'Exercise no longer exists'));
          return;
        }
        state.record.typeId = exercise.category;
        state.record.exerciseId = exercise.id;
        state.record.values = initialValuesFor(ctx, exercise.id);
        state.record.time = nowLocalValue();
        state.record.note = '';
        state.record.error = '';
        state.record.planName = this.planNameForExercise(exercise.id);
        this.go('record');
        return;
      }
      case 'repeat-last': {
        const log = this.store.logs.find((row) => row.id === el.dataset.log);
        if (!log) return;
        const type = typeOf(this.store.config, log.category);
        state.record.typeId = log.category;
        state.record.exerciseId = log.exerciseId ?? '';
        state.record.values = valuesFromLog(log, type, unit);
        state.record.time = nowLocalValue();
        state.record.note = log.note ?? '';
        state.record.planName = log.plan ?? '';
        state.record.error = '';
        this.go('record');
        return;
      }
      case 'fill-last': {
        const log = this.store.logs.find((row) => row.id === el.dataset.log);
        if (!log) return;
        const type = typeOf(this.store.config, log.category);
        state.record.values = valuesFromLog(log, type, unit);
        state.record.error = '';
        this.renderView();
        toast(L('已填入上次数值', 'Last values filled'));
        return;
      }
      case 'edit-log': {
        const logId = el.dataset.log ?? '';
        if (logId) openLogEditor(ctx, logId);
        return;
      }
      case 'delete-log': {
        const logId = el.dataset.log ?? '';
        confirmDialog({
          title: L('删除这条记录？', 'Delete this log?'),
          message: L('删除后无法恢复，计划完成状态与配置不受影响。', 'This cannot be undone; plan progress and config are unaffected.'),
          confirmLabel: L('删除', 'Delete'),
          danger: true,
          onConfirm: () => {
            this.store.removeLog(logId);
            toast(L('已删除', 'Deleted'));
          },
        });
        return;
      }
      case 'record-type': {
        const typeId = el.dataset.type ?? '';
        state.record.typeId = typeId;
        const first = exercisesOfType(this.store.config, typeId)[0];
        state.record.exerciseId = first?.id ?? '';
        state.record.values = first ? initialValuesFor(ctx, first.id) : {};
        state.record.error = '';
        this.renderView();
        return;
      }
      case 'reset-fields':
        state.record.values = {};
        state.record.error = '';
        this.renderView();
        return;
      case 'save-log':
        this.saveLog(el.dataset.again === '1');
        return;
      case 'new-exercise': {
        const category = state.record.typeId || this.store.config.trainingTypes[0]?.id;
        openExerciseEditor(ctx, undefined, category, (id) => {
          state.record.exerciseId = id;
          state.record.values = initialValuesFor(ctx, id);
          this.renderView();
        });
        return;
      }
      case 'toggle-plan-set': {
        const planId = el.dataset.plan ?? '';
        const exerciseId = el.dataset.exercise ?? '';
        const setId = el.dataset.set ?? '';
        this.store.updateConfig((config) => {
          const plan = (config.plans ?? []).find((item) => item.id === planId);
          if (plan) toggleSetDone(plan, exerciseId, setId, todayStr());
        });
        return;
      }
      case 'new-plan':
        openPlanEditor(ctx);
        return;
      case 'edit-plan': {
        const planId = el.dataset.plan ?? '';
        if (planId) openPlanEditor(ctx, planId);
        return;
      }
      case 'delete-plan': {
        const planId = el.dataset.plan ?? '';
        const plan = (this.store.config.plans ?? []).find((item) => item.id === planId);
        if (!plan) return;
        confirmDialog({
          title: L('删除这个计划？', 'Delete this plan?'),
          message: L(
            `「${plan.name}」将被移除，历史训练记录不受影响。`,
            `“${plan.name}” will be removed. Existing logs are unaffected.`
          ),
          confirmLabel: L('删除计划', 'Delete plan'),
          danger: true,
          onConfirm: () => {
            this.store.updateConfig((config) => {
              config.plans = (config.plans ?? []).filter((item) => item.id !== planId);
            });
            toast(L('计划已删除', 'Plan deleted'));
          },
        });
        return;
      }
      case 'analysis-range': {
        const range = el.dataset.range;
        if (range === '7d' || range === '30d' || range === '90d' || range === 'all') {
          state.analysis.range = range;
          this.renderView();
        }
        return;
      }
      case 'analysis-side': {
        const side = el.dataset.side;
        if (side === 'front' || side === 'back') {
          state.analysis.side = side;
          this.renderView();
        }
        return;
      }
      case 'day-step': {
        const step = Number(el.dataset.step);
        state.analysis.day = addDays(state.analysis.day || todayStr(), step);
        this.renderView();
        return;
      }
      case 'export-heatmap':
        void this.exportHeatmapPng();
        return;
      case 'export-csv':
        downloadText('workout_logs.csv', this.store.exportCsv(), 'text/csv;charset=utf-8');
        toast('workout_logs.csv ✓');
        return;
      case 'export-config':
        downloadText('workout-config.json', this.store.exportConfigJson(), 'application/json');
        toast('workout-config.json ✓');
        return;
      case 'export-backup':
        downloadText(
          `workout-backup-${todayStr()}.json`,
          this.store.exportBackupJson(),
          'application/json'
        );
        toast(L('完整备份已导出', 'Backup exported'));
        return;
      case 'import-csv':
        this.clickImport('csv');
        return;
      case 'import-config':
        this.clickImport('json');
        return;
      case 'import-backup':
        this.clickImport('backup');
        return;
      case 'reset-all':
        confirmDialog({
          title: L('清空全部数据？', 'Reset everything?'),
          message: L(
            '浏览器内的训练记录、配置与设置都会被清空，并恢复默认种子数据。此操作不可撤销。',
            'All logs, config and settings in this browser will be erased and seed data restored. This cannot be undone.'
          ),
          confirmLabel: L('清空并重置', 'Reset all'),
          danger: true,
          onConfirm: () => {
            this.store.resetAll();
            initState(this.store);
            resetRecordState(this.store);
            toast(L('已恢复默认数据', 'Reset to defaults'));
            this.go('dashboard');
          },
        });
        return;
      case 'toggle-remember':
        this.store.updateSettings({ remember: !this.store.settings.remember });
        return;
      case 'toggle-autoclear':
        this.store.updateSettings({ autoClear: !this.store.settings.autoClear });
        return;
      case 'edit-type':
        openTypeEditor(ctx, el.dataset.type || undefined);
        return;
      case 'delete-type':
        this.deleteType(el.dataset.type ?? '');
        return;
      case 'edit-field':
        if (el.dataset.type) openFieldEditor(ctx, el.dataset.type, el.dataset.field ?? '');
        return;
      case 'delete-field':
        this.deleteField(el.dataset.type ?? '', el.dataset.field ?? '');
        return;
      case 'edit-exercise':
        openExerciseEditor(ctx, el.dataset.exercise || undefined);
        return;
      case 'delete-exercise':
        this.deleteExercise(el.dataset.exercise ?? '');
        return;
      case 'edit-muscle':
        openMuscleEditor(ctx, el.dataset.muscle || undefined);
        return;
      case 'delete-muscle':
        this.deleteMuscle(el.dataset.muscle ?? '');
        return;
      case 'apply-mapping': {
        const tier = el.dataset.tier === 'minimal' ? 'minimal' : 'default';
        confirmDialog({
          title: L('套用映射预设？', 'Apply mapping preset?'),
          message: L(
            '会覆盖当前所有肌肉的 SVG 路径选择，之后仍可逐块调整。',
            'This overwrites the current SVG path mapping for every muscle; you can still adjust each one afterwards.'
          ),
          confirmLabel: L('套用', 'Apply'),
          onConfirm: () => {
            this.store.updateConfig((config) => applyMappingTier(config, tier));
            toast(L('映射已套用', 'Mapping applied'));
          },
        });
        return;
      }
      case 'toggle-stat': {
        const statId = el.dataset.stat ?? '';
        this.store.updateConfig((config) => {
          const stat = config.statistics.find((item) => item.id === statId);
          if (stat) stat.enabled = !stat.enabled;
        });
        return;
      }
      case 'edit-stat':
        openStatEditor(ctx, el.dataset.stat || undefined);
        return;
      case 'delete-stat': {
        const statId = el.dataset.stat ?? '';
        const stat = this.store.config.statistics.find((item) => item.id === statId);
        if (!stat) return;
        confirmDialog({
          title: L('删除统计指标？', 'Delete statistic?'),
          message: L(
            `「${stat.name}」将从统计与热力图指标中移除，历史记录不受影响。`,
            `“${stat.name}” will be removed from statistics and heatmap metrics. Logs are unaffected.`
          ),
          confirmLabel: L('删除', 'Delete'),
          danger: true,
          onConfirm: () => {
            this.store.updateConfig((config) => {
              config.statistics = config.statistics.filter((item) => item.id !== statId);
            });
            toast(L('统计已删除', 'Statistic deleted'));
          },
        });
        return;
      }
      case 'history-more':
        state.history.limit += HISTORY_PAGE;
        this.renderView();
        return;
      case 'search-jump': {
        state.history.search = el.dataset.q ?? '';
        state.history.range = 'all';
        state.history.typeId = '';
        state.history.limit = HISTORY_PAGE;
        this.hideSearchPop();
        this.go('history');
        return;
      }
      case 'seed-demo': {
        const empty = this.store.logs.length === 0;
        confirmDialog({
          title: L('载入演示数据？', 'Load demo data?'),
          message: empty
            ? L(
                '将写入最近两周的 20 余条示例训练记录，方便直接看到统计与热力图效果。配置与设置不受影响，可随时在设置页清空。',
                'This adds ~20 sample logs from the last two weeks so stats and the heatmap have content. Config and settings are untouched; clear it anytime in Settings.'
              )
            : L(
                `当前已有 ${this.store.logs.length} 条记录，演示数据会追加在后面，不会覆盖你的记录。`,
                `You already have ${this.store.logs.length} logs; demo rows will be appended, nothing is overwritten.`
              ),
          confirmLabel: L('载入', 'Load'),
          onConfirm: () => {
            const { added } = seedDemoLogs(this.store);
            initState(this.store);
            resetRecordState(this.store);
            toast(L(`已载入 ${added} 条演示记录`, `Loaded ${added} demo logs`));
            this.go('dashboard');
          },
        });
        return;
      }
      default:
        return;
    }
  }

  private onInput(event: Event): void {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    if (target.closest('#modalRoot')) return;

    if (target.matches('[data-field]') && state.page === 'record') {
      const key = target.getAttribute('data-field') ?? '';
      state.record.values[key] = target.value;
      const grid = document.querySelector('.record-grid');
      const type = typeOf(this.store.config, state.record.typeId);
      if (grid) refreshComputedIn(grid, type, this.store.settings.unit, 'data-field');
      return;
    }
    if (target.matches('[data-record-time]')) {
      state.record.time = target.value;
      return;
    }
    if (target.matches('[data-record-plan]')) {
      state.record.planName = target.value;
      return;
    }
    if (target.matches('[data-record-note]')) {
      state.record.note = target.value;
      return;
    }
    if (target.matches('[data-history-search]')) {
      state.history.search = target.value;
      state.history.limit = HISTORY_PAGE;
      this.refreshHistoryBody();
      return;
    }
    if (target.matches('[data-custom-search]')) {
      const kind = target.getAttribute('data-custom-search');
      if (kind === 'exercise') state.custom.exerciseSearch = target.value;
      if (kind === 'muscle') state.custom.muscleSearch = target.value;
      const body = document.getElementById('customBody');
      if (body) body.innerHTML = renderCustomBody(this.ctx);
      return;
    }
    if (target.id === 'globalSearch') {
      this.refreshSearchPop((target as HTMLInputElement).value);
      return;
    }
  }

  /** 动作 id → 展示名（搜索建议用）。 */
  private exerciseLabel(exerciseId: string | undefined): string {
    return getExerciseNameById(this.store.config.exercises, exerciseId) || '';
  }

  /** 顶栏搜索的即时建议：动作与记录各取前几条，点选即跳日志页筛出结果。 */
  private refreshSearchPop(raw: string): void {
    const pop = document.getElementById('searchPop');
    if (!pop) return;
    const term = raw.trim().toLowerCase();
    if (!term) {
      pop.hidden = true;
      pop.innerHTML = '';
      return;
    }
    const exercises = this.store.config.exercises
      .map((item) => ({ id: item.id, name: this.exerciseLabel(item.id) }))
      .filter((item) => item.name.toLowerCase().includes(term))
      .slice(0, 4)
      .map(
        (item) =>
          `<button class="search-pop-item" data-action="search-jump" data-q="${esc(item.name)}">` +
          `${icon('dumbbell', 'ic-sm')}<b>${esc(item.name)}</b><span>${esc(L('动作', 'Exercise'))}</span></button>`
      );
    const logs = sortLogsDesc(
      this.store.logs.filter((log) => {
        const name = logExerciseName(this.store.config, log).toLowerCase();
        return name.includes(term) || (log.note ?? '').toLowerCase().includes(term) || (log.plan ?? '').toLowerCase().includes(term);
      })
    )
      .slice(0, 3)
      .map(
        (log) =>
          `<button class="search-pop-item" data-action="search-jump" data-q="${esc(
            logExerciseName(this.store.config, log)
          )}">${icon('list', 'ic-sm')}<b>${esc(logExerciseName(this.store.config, log))}</b>` +
          `<span>${esc(log.timestamp)}</span></button>`
      );
    if (!exercises.length && !logs.length) {
      pop.innerHTML = `<div class="search-pop-empty">${esc(L('没有匹配的动作或记录', 'No matching exercise or log'))}</div>`;
      pop.hidden = false;
      return;
    }
    pop.innerHTML = (exercises.join('') || '') + (logs.length ? `<div class="search-pop-sep"></div>${logs.join('')}` : '');
    pop.hidden = false;
  }

  private hideSearchPop(): void {
    const pop = document.getElementById('searchPop');
    if (pop) {
      pop.hidden = true;
      pop.innerHTML = '';
    }
  }

  private onChange(event: Event): void {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.closest('#modalRoot')) return;

    if (target.matches('[data-setting]')) {
      const key = target.getAttribute('data-setting') ?? '';
      const value = target.value;
      if (key === 'language' && (value === 'zh' || value === 'en')) this.store.updateSettings({ language: value });
      else if (key === 'unit' && (value === 'kg' || value === 'lb')) this.store.updateSettings({ unit: value });
      else if (key === 'theme' && (value === 'light' || value === 'dark')) this.store.updateSettings({ theme: value });
      else if (key === 'decimals') this.store.updateSettings({ decimals: (Number(value) === 1 ? 1 : Number(value) === 2 ? 2 : 0) as 0 | 1 | 2 });
      else if (key === 'defaultRange') this.store.updateSettings({ defaultRange: value as WebStore['settings']['defaultRange'] });
      else if (key === 'defaultMetricId') this.store.updateSettings({ defaultMetricId: value });
      return;
    }
    if (target.matches('[data-import-file]')) {
      const file = (target as HTMLInputElement).files?.[0];
      const kind = target.getAttribute('data-import-file') ?? '';
      if (file) void this.loadImport(file, kind);
      (target as HTMLInputElement).value = '';
      return;
    }
    if (target.matches('[data-record-exercise]')) {
      const exerciseId = target.value;
      state.record.exerciseId = exerciseId;
      state.record.values = initialValuesFor(this.ctx, exerciseId);
      state.record.error = '';
      state.record.planName = this.planNameForExercise(exerciseId);
      this.renderView();
      return;
    }
    if (target.matches('[data-record-time]')) {
      state.record.time = target.value;
      return;
    }
    if (target.matches('[data-history-type]')) {
      state.history.typeId = target.value;
      state.history.limit = HISTORY_PAGE;
      this.refreshHistoryBody();
      return;
    }
    if (target.matches('[data-history-range]')) {
      const value = target.value;
      if (value === 'all' || value === '7d' || value === '30d' || value === '90d') {
        state.history.range = value;
        state.history.limit = HISTORY_PAGE;
        this.refreshHistoryBody();
      }
      return;
    }
    if (target.matches('[data-analysis-metric]')) {
      state.analysis.metricId = target.value;
      this.renderView();
      return;
    }
    if (target.matches('[data-analysis-day]')) {
      state.analysis.day = target.value;
      this.renderView();
      return;
    }
  }

  private onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      const input = document.getElementById('globalSearch') as HTMLInputElement | null;
      input?.focus();
      input?.select();
      return;
    }
    if (event.key === 'Escape') {
      this.hideSearchPop();
      closeModal();
      return;
    }
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.id === 'globalSearch' && event.key === 'Enter') {
      state.history.search = target.value.trim();
      state.history.range = 'all';
      state.history.typeId = '';
      state.history.limit = HISTORY_PAGE;
      this.go('history');
    }
  }

  // ============================ 记录保存 ============================

  private planNameForExercise(exerciseId: string): string {
    if (!exerciseId) return '';
    const plan = (this.store.config.plans ?? []).find((item) =>
      item.items.some((planItem) => planItem.exerciseId === exerciseId)
    );
    return plan?.name ?? '';
  }

  private saveLog(again: boolean): void {
    const { settings } = this.store;
    const type = typeOf(this.store.config, state.record.typeId);
    if (!type) {
      state.record.error = L('请先创建训练类型', 'Create a training type first');
      this.renderView();
      return;
    }
    if (!state.record.exerciseId) {
      state.record.error = L('请选择训练动作', 'Choose an exercise');
      this.renderView();
      return;
    }
    const parsed = parseDraft(type, state.record.values, settings.unit);
    if (!parsed.ok) {
      state.record.error = parsed.error;
      this.renderView();
      return;
    }
    const exerciseId = state.record.exerciseId;
    const rawValues = { ...state.record.values };
    if (settings.remember) state.record.lastValues.set(exerciseId, rawValues);

    const log: Omit<LogRow, 'id'> = {
      timestamp: toStorageTime(state.record.time || nowLocalValue()),
      category: type.id,
      exerciseId,
      fields: parsed.fields,
      note: state.record.note.trim() || undefined,
      plan: state.record.planName.trim() || undefined,
    };

    state.record.error = '';
    state.record.time = nowLocalValue();
    state.record.note = '';
    if (!again && settings.autoClear) state.record.values = {};

    this.store.addLog(log);
    toast(again ? L('已保存，继续下一组', 'Saved — next set') : L('已记录一组', 'Set saved'));
  }

  private refreshHistoryBody(): void {
    const result = renderHistoryBody(this.ctx);
    const body = document.getElementById('historyBody');
    if (body) body.innerHTML = result.html;
    const count = document.getElementById('historyCount');
    if (count) count.textContent = result.countText;
  }

  // ============================ 导入导出 ============================

  private clickImport(kind: 'csv' | 'json' | 'backup'): void {
    const input = document.querySelector<HTMLInputElement>(`[data-import-file="${kind}"]`);
    input?.click();
  }

  private async loadImport(file: File, kind: string): Promise<void> {
    try {
      const text = await readFileText(file);
      if (kind === 'csv') {
        if (!text.trim()) {
          toast(L('文件为空', 'File is empty'));
          return;
        }
        const result = this.store.importCsv(text);
        if (result.added > 0) {
          toast(L(`导入 ${result.added} 条，跳过 ${result.skipped} 条`, `Imported ${result.added}, skipped ${result.skipped}`));
        } else if (result.skipped > 0) {
          toast(L('没有新记录（全部重复）', 'No new rows — all duplicates'));
        } else {
          toast(L('无法解析 CSV', 'Could not parse CSV'));
        }
      } else if (kind === 'json') {
        const result = this.store.importConfigJson(text);
        toast(result.ok ? L('配置已导入', 'Config imported') : L('配置格式无效', 'Invalid config file'));
      } else {
        const result = this.store.importBackupJson(text);
        toast(
          result.ok
            ? L(`备份已恢复：${result.logs} 条记录`, `Backup restored: ${result.logs} logs`)
            : L('备份格式无效', 'Invalid backup file')
        );
      }
    } catch {
      toast(L('读取文件失败', 'Could not read file'));
    }
  }

  private async exportHeatmapPng(): Promise<void> {
    const svg = document.querySelector<SVGSVGElement>('.heatmap-canvas .body-figure svg');
    if (!svg) {
      toast(L('当前没有可导出的热力图', 'No heatmap to export'));
      return;
    }
    const dark = this.store.settings.theme === 'dark';
    const base = dark ? '#3b3f47' : '#dedad0';
    const background = dark ? '#17181c' : '#f7f5ef';
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll('#head, #face').forEach((el) => el.remove());
    clone.querySelectorAll('path').forEach((path) => {
      if (!(path as SVGPathElement).style.fill) path.setAttribute('fill', base);
    });
    clone.setAttribute('width', '587');
    clone.setAttribute('height', '1137');
    const xml = new XMLSerializer().serializeToString(clone);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    const image = new Image();
    image.onload = () => {
      const width = 720;
      const height = Math.round((width * 1137) / 587);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        toast(L('导出失败', 'Export failed'));
        return;
      }
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) {
          toast(L('导出失败', 'Export failed'));
          return;
        }
        const link = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);
        link.href = objectUrl;
        link.download = `workout-heatmap-${todayStr()}.png`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        toast(L('热力图已导出', 'Heatmap exported'));
      }, 'image/png');
    };
    image.onerror = () => toast(L('导出失败', 'Export failed'));
    image.src = url;
  }

  // ============================ 定义删除 ============================

  private deleteType(typeId: string): void {
    const type = this.store.config.trainingTypes.find((item) => item.id === typeId);
    if (!type) return;
    const exercises = this.store.config.exercises.filter((item) => item.category === typeId);
    if (exercises.length > 0) {
      toast(
        L(
          `该类型下还有 ${exercises.length} 个动作，请先删除或移走它们`,
          `${exercises.length} exercises still use this type; remove or move them first`
        )
      );
      return;
    }
    confirmDialog({
      title: L('删除训练类型？', 'Delete training type?'),
      message: L(
        '已有记录会保留，但该类型将不再出现在录入与分析中。',
        'Existing logs are kept, but the type disappears from entry and analysis.'
      ),
      confirmLabel: L('删除', 'Delete'),
      danger: true,
      onConfirm: () => {
        this.store.updateConfig((config) => {
          config.trainingTypes = config.trainingTypes.filter((item) => item.id !== typeId);
          for (const stat of config.statistics) {
            stat.associatedTypes = stat.associatedTypes.filter((id) => id !== typeId);
          }
        });
        if (state.record.typeId === typeId) {
          resetRecordState(this.store);
        }
        toast(L('训练类型已删除', 'Type deleted'));
      },
    });
  }

  private deleteField(typeId: string, key: string): void {
    const type = this.store.config.trainingTypes.find((item) => item.id === typeId);
    const field = type?.fields.find((item) => item.key === key);
    if (!type || !field) return;
    confirmDialog({
      title: L('删除字段？', 'Delete field?'),
      message: L(
        `「${key}」会从该类型的表单中移除，历史记录里的同名数据仍会保留。`,
        `“${key}” is removed from the form; matching values in existing logs are preserved.`
      ),
      confirmLabel: L('删除', 'Delete'),
      danger: true,
      onConfirm: () => {
        this.store.updateConfig((config) => {
          const target = config.trainingTypes.find((item) => item.id === typeId);
          if (target) target.fields = target.fields.filter((item) => item.key !== key);
        });
        toast(L('字段已删除', 'Field deleted'));
      },
    });
  }

  private deleteExercise(exerciseId: string): void {
    const exercise = this.store.config.exercises.find((item) => item.id === exerciseId);
    if (!exercise) return;
    confirmDialog({
      title: L('删除动作？', 'Delete exercise?'),
      message: L(
        '历史记录会保留，但会显示为「未关联动作」；训练计划里的该动作也会移除。',
        'Logs are kept but will show as unlinked; the exercise is also removed from plans.'
      ),
      confirmLabel: L('删除', 'Delete'),
      danger: true,
      onConfirm: () => {
        this.store.updateConfig((config) => {
          config.exercises = config.exercises.filter((item) => item.id !== exerciseId);
          for (const plan of config.plans ?? []) {
            const removed = plan.items.filter((item) => item.exerciseId === exerciseId).flatMap((item) => item.sets.map((set) => `${item.exerciseId}#${set.id}`));
            plan.items = plan.items.filter((item) => item.exerciseId !== exerciseId);
            if (plan.completedSets) {
              for (const key of removed) delete plan.completedSets[key];
            }
          }
        });
        toast(L('动作已删除', 'Exercise deleted'));
      },
    });
  }

  private deleteMuscle(muscleId: string): void {
    const muscle = this.store.config.muscles.find((item) => item.id === muscleId);
    if (!muscle) return;
    confirmDialog({
      title: L('删除肌肉？', 'Delete muscle?'),
      message: L(
        '相关动作的肌肉关联会被移除，历史记录不受影响。',
        'Muscle links on exercises are removed; logs are unaffected.'
      ),
      confirmLabel: L('删除', 'Delete'),
      danger: true,
      onConfirm: () => {
        this.store.updateConfig((config) => {
          config.muscles = config.muscles.filter((item) => item.id !== muscleId);
          for (const exercise of config.exercises) {
            if (exercise.muscles) {
              exercise.muscles = exercise.muscles.filter((link) => link.muscleId !== muscleId);
            }
          }
        });
        toast(L('肌肉已删除', 'Muscle deleted'));
      },
    });
  }
}
