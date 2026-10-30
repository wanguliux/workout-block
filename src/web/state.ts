/*
 * state.ts —— 网页端会话内 UI 状态（不落盘）。
 * 只保存「当前在看什么 / 表单草稿」，业务数据始终以 WebStore 为准。
 */

import type { WebRange, WebStore } from './store';
import { nowLocalValue, todayStr } from './format';

export type PageId = 'dashboard' | 'record' | 'history' | 'plans' | 'analysis' | 'customize' | 'settings';
export type AnalysisTab = 'stats' | 'heatmap' | 'day';
export type CustomTab = 'types' | 'exercises' | 'muscles' | 'stats' | 'plans';
export type TrendMetric = 'sets' | 'volume' | 'time';

export interface RecordUiState {
  initialized: boolean;
  typeId: string;
  exerciseId: string;
  values: Record<string, string>;
  time: string;
  note: string;
  planName: string;
  error: string;
  /** 会话内「上次输入值」记忆（动作 id → 原始输入串）。 */
  lastValues: Map<string, Record<string, string>>;
}

export interface HistoryUiState {
  search: string;
  typeId: string;
  range: WebRange;
  /** 当前已渲染的记录条数上限（「显示更多」每次 +HISTORY_PAGE，筛选条件变化时重置）。 */
  limit: number;
}

/** 日志页每次加载的条数：记录多了也不至于一次渲染几千行卡住。 */
export const HISTORY_PAGE = 100;

export interface AnalysisUiState {
  tab: AnalysisTab;
  range: WebRange;
  metricId: string;
  side: 'front' | 'back';
  day: string;
}

export interface CustomUiState {
  tab: CustomTab;
  exerciseSearch: string;
  muscleSearch: string;
}

export interface AppState {
  page: PageId;
  trend: TrendMetric;
  analysis: AnalysisUiState;
  custom: CustomUiState;
  record: RecordUiState;
  history: HistoryUiState;
}

export const state: AppState = {
  page: 'dashboard',
  trend: 'sets',
  analysis: {
    tab: 'stats',
    range: '7d',
    metricId: '',
    side: 'front',
    day: todayStr(),
  },
  custom: {
    tab: 'types',
    exerciseSearch: '',
    muscleSearch: '',
  },
  record: {
    initialized: false,
    typeId: '',
    exerciseId: '',
    values: {},
    time: nowLocalValue(),
    note: '',
    planName: '',
    error: '',
    lastValues: new Map(),
  },
  history: {
    search: '',
    typeId: '',
    range: 'all',
    limit: HISTORY_PAGE,
  },
};

export function initState(store: WebStore): void {
  state.analysis.range = store.settings.defaultRange;
  state.analysis.metricId = store.settings.defaultMetricId;
  state.analysis.day = todayStr();
}

export function resetRecordState(store: WebStore): void {
  const firstType = store.config.trainingTypes[0];
  const firstExercise = store.config.exercises.find((e) => e.category === firstType?.id);
  state.record = {
    initialized: true,
    typeId: firstType?.id ?? '',
    exerciseId: firstExercise?.id ?? '',
    values: {},
    time: nowLocalValue(),
    note: '',
    planName: '',
    error: '',
    lastValues: state.record.lastValues,
  };
}
