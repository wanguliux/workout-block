/*
 * muscleEditor.ts —— 肌肉编辑：名称、覆盖开关、休息阈值、热力图指标/分档与 SVG 路径映射。
 * 路径选择按健身群分组，支持搜索、默认/精简档一键套用与清空。
 */

import { Muscle } from '../../data/types';
import { getMuscleName } from '../../data/display';
import { FITNESS_GROUPS, SVG_MUSCLE_CATALOG, formatSvgMuscleLabel } from '../../data/svgMuscleCatalog';
import { DEFAULT_HEATMAP_SCALE, colorToCss } from '../../data/heatmapDefaults';
import { buildMappings } from '../../data/muscleMapping';
import { getLocale } from '../../i18n';
import { generateId } from '../../util/id';
import { icon } from '../icons';
import { UiContext } from '../context';
import { L, esc, slugId } from '../format';
import { modalFrame, showModal, toast } from '../ui';
import { editorSignal, closeEditor } from './editorHost';

interface LevelDraft {
  color: string;
  max: string;
}

interface MuscleDraft {
  id: string;
  existing: boolean;
  name: string;
  initialName: string;
  hasNameKey: boolean;
  contributes: boolean;
  rest: string;
  metric: string;
  range: string;
  useDefaultScale: boolean;
  levels: LevelDraft[];
  regionIds: string[];
}

function draftFrom(muscle?: Muscle): MuscleDraft {
  const name = getMuscleName(muscle) || '';
  const levels = (muscle?.heatmapLevels?.length ? muscle.heatmapLevels : DEFAULT_HEATMAP_SCALE).map((level) => ({
    color: colorToCss(level.color),
    max: level.max === undefined ? '' : String(level.max),
  }));
  while (levels.length < 4) levels.push({ color: '#ef4444', max: '' });
  return {
    id: muscle?.id ?? generateId(8),
    existing: !!muscle,
    name,
    initialName: name,
    hasNameKey: !!muscle?.nameKey,
    contributes: muscle?.contributesToCoverage ?? true,
    rest: String(muscle?.restThresholdDays ?? 7),
    metric: muscle?.heatmapMetric ?? '',
    range: muscle?.heatmapRange ?? '',
    useDefaultScale: !muscle?.heatmapLevels?.length,
    levels,
    regionIds: [...(muscle?.svgRegionIds ?? [])],
  };
}

// 同一路径 id 可能同时存在于正面/背面两个 SVG；映射只存 id，展示时合并。
const UNIQUE_PATHS = (() => {
  const seen = new Map<string, (typeof SVG_MUSCLE_CATALOG)[number]>();
  for (const entry of SVG_MUSCLE_CATALOG) {
    if (!seen.has(entry.id)) seen.set(entry.id, entry);
  }
  return [...seen.values()];
})();

function pathGroups(draft: MuscleDraft, search: string): string {
  const term = search.trim().toLowerCase();
  const locale = getLocale();
  const groups = FITNESS_GROUPS.map((group) => {
    const entries = UNIQUE_PATHS.filter((entry) => {
      if (entry.fitnessGroup !== group.key) return false;
      if (!term) return true;
      const label = formatSvgMuscleLabel(entry, locale).toLowerCase();
      return (
        label.includes(term) ||
        entry.id.toLowerCase().includes(term) ||
        entry.zh.includes(term) ||
        entry.en.toLowerCase().includes(term)
      );
    });
    if (entries.length === 0) return '';
    return (
      '<div class="svg-group">' +
      `<div class="svg-group-title"><span>${esc(locale === 'zh' ? group.zh : group.en)}</span>` +
      `<span class="faint">${entries.filter((entry) => draft.regionIds.includes(entry.id)).length}/${entries.length}</span></div>` +
      '<div class="svg-path-list">' +
      entries
        .map(
          (entry) =>
            `<label class="check-inline"><input type="checkbox" data-path-id="${esc(entry.id)}"${
              draft.regionIds.includes(entry.id) ? ' checked' : ''
            } />${esc(formatSvgMuscleLabel(entry, locale))}</label>`
        )
        .join('') +
      '</div></div>'
    );
  }).join('');
  return groups || `<div class="empty">${esc(L('没有匹配的路径', 'No matching paths'))}</div>`;
}

function levelsHTML(draft: MuscleDraft): string {
  if (draft.useDefaultScale) {
    return (
      '<div class="scale-preview">' +
      DEFAULT_HEATMAP_SCALE.map((level) => colorToCss(level.color))
        .map((color) => `<i style="background:${color}"></i>`)
        .join('') +
      `<span class="faint">${esc(L('跟随指标的默认四档', 'Follows the metric default bands'))}</span></div>`
    );
  }
  return (
    '<div class="level-grid">' +
    draft.levels
      .map(
        (level, index) =>
          '<div class="level-row">' +
          `<span class="level-no">${index + 1}</span>` +
          `<input type="color" data-level-color="${index}" value="${esc(level.color)}" />` +
          `<input class="input" type="number" min="0" step="any" data-level-max="${index}" value="${esc(
            level.max
          )}" placeholder="${index === 3 ? '∞' : L('上限', 'Max')}" />` +
          '</div>'
      )
      .join('') +
    `<div class="faint">${esc(L('数值 ≤ 上限时取该档颜色；最后一档留空表示无穷大', 'A value uses the first band whose max it is under; leave the last blank for infinity'))}</div>` +
    '</div>'
  );
}

function bodyHTML(ctx: UiContext, draft: MuscleDraft): string {
  const stats = ctx.store.config.statistics;
  return (
    '<div class="muscle-editor">' +
    '<div class="editor-grid">' +
    '<div class="field"><label>' +
    esc(L('肌肉名称', 'Muscle name')) +
    `</label><input class="input" data-editor-name value="${esc(draft.name)}" placeholder="${esc(
      L('如 腹直肌', 'e.g. Rectus abdominis')
    )}" /></div>` +
    '<div class="field"><label>' +
    esc(L('休息阈值（天）', 'Rest threshold (days)')) +
    `</label><input class="input" type="number" min="0" step="1" data-editor-rest value="${esc(draft.rest)}" /></div>` +
    '</div>' +
    '<div class="setting-row compact"><div class="setting-info"><b>' +
    esc(L('计入肌肉覆盖统计', 'Count toward coverage')) +
    '</b><span>' +
    esc(L('关闭后不计入覆盖与频率', 'Excluded from coverage and frequency')) +
    `</span></div><button class="switch${draft.contributes ? ' on' : ''}" data-editor-action="toggle-coverage"></button></div>` +
    '<div class="section-title">' +
    esc(L('热力图', 'Heatmap')) +
    '</div>' +
    '<div class="editor-grid">' +
    '<div class="field"><label>' +
    esc(L('指标', 'Metric')) +
    '</label><select class="select" data-editor-metric><option value="">' +
    esc(L('跟随全局默认', 'Follow default')) +
    '</option>' +
    stats
      .map(
        (stat) =>
          `<option value="${esc(stat.id)}"${draft.metric === stat.id ? ' selected' : ''}>${esc(stat.name)}</option>`
      )
      .join('') +
    '</select></div>' +
    '<div class="field"><label>' +
    esc(L('时间窗', 'Range')) +
    '</label><select class="select" data-editor-range><option value="">' +
    esc(L('跟随全局默认', 'Follow default')) +
    '</option>' +
    [
      ['7d', L('最近 7 天', 'Last 7 days')],
      ['30d', L('最近 30 天', 'Last 30 days')],
      ['90d', L('最近 90 天', 'Last 90 days')],
      ['all', L('全部', 'All')],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}"${draft.range === value ? ' selected' : ''}>${esc(label)}</option>`
      )
      .join('') +
    '</select></div></div>' +
    '<div class="setting-row compact"><div class="setting-info"><b>' +
    esc(L('颜色分档', 'Color bands')) +
    '</b><span>' +
    esc(L('默认四档由指标提供，也可以为这块肌肉单独设置', 'The metric provides four bands; override them per muscle')) +
    `</span></div><button class="switch${draft.useDefaultScale ? ' on' : ''}" data-editor-action="toggle-scale"></button></div>` +
    levelsHTML(draft) +
    '<div class="section-title">' +
    esc(L('SVG 路径映射', 'SVG path mapping')) +
    `<span class="faint">${esc(L(`${draft.regionIds.length} 条已选`, `${draft.regionIds.length} selected`))}</span>` +
    '</div>' +
    '<div class="mini-toolbar">' +
    '<div class="search-inline">' +
    icon('search') +
    `<input class="input" type="search" data-muscle-path-search value="" placeholder="${esc(
      L('搜索肌肉 / 路径 id', 'Search muscle / path id')
    )}" /></div>` +
    `<button class="btn btn-ghost btn-sm" data-editor-action="tier" data-tier="default">${esc(
      L('套用默认', 'Default'))
    }</button>` +
    `<button class="btn btn-ghost btn-sm" data-editor-action="tier" data-tier="minimal">${esc(
      L('精简', 'Minimal'))
    }</button>` +
    `<button class="btn btn-ghost btn-sm" data-editor-action="clear-paths">${esc(L('清空', 'Clear'))}</button>` +
    '</div>' +
    `<div id="musclePathList" class="svg-path-groups">${pathGroups(draft, '')}</div>` +
    '<div class="form-error" id="muscleEditorError"></div>' +
    '</div>'
  );
}

function save(ctx: UiContext, draft: MuscleDraft): void {
  const name = draft.name.trim();
  if (!name) {
    setError(L('请填写肌肉名称', 'Muscle name is required'));
    return;
  }
  const rest = Number(draft.rest);
  if (!Number.isFinite(rest) || rest < 0) {
    setError(L('休息阈值需要是非负数字', 'Rest threshold must be a non-negative number'));
    return;
  }

  let levels: Muscle['heatmapLevels'];
  if (!draft.useDefaultScale) {
    const parsed = draft.levels.map((level, index) => ({
      color: level.color,
      max: level.max.trim() === '' ? (index === 3 ? undefined : NaN) : Number(level.max),
    }));
    for (let i = 0; i < parsed.length; i++) {
      if (parsed[i].max === undefined) continue;
      if (!Number.isFinite(parsed[i].max) || (parsed[i].max as number) < 0) {
        setError(L('颜色分档的上限需要是非负数字', 'Band max values must be non-negative numbers'));
        return;
      }
      if (i > 0 && parsed[i - 1].max !== undefined && (parsed[i].max as number) <= (parsed[i - 1].max as number)) {
        setError(L('颜色分档上限需要逐档递增', 'Band max values must increase'));
        return;
      }
    }
    levels = parsed.map((level) => ({ color: level.color, max: level.max }));
  }

  const next: Muscle = {
    id: draft.id,
    name,
    contributesToCoverage: draft.contributes,
    restThresholdDays: Math.round(rest),
    svgRegionIds: [...new Set(draft.regionIds)],
    heatmapMetric: draft.metric || undefined,
    heatmapRange: draft.range || undefined,
    heatmapLevels: levels,
  };
  if (draft.hasNameKey && name === draft.initialName) {
    const original = ctx.store.config.muscles.find((muscle) => muscle.id === draft.id);
    if (original?.nameKey) next.nameKey = original.nameKey;
  }
  if (!draft.existing) {
    let id = slugId(name);
    if (ctx.store.config.muscles.some((muscle) => muscle.id === id)) id = `${id}-${generateId(4)}`;
    next.id = id;
  }

  ctx.store.updateConfig((config) => {
    const index = config.muscles.findIndex((muscle) => muscle.id === next.id);
    if (index >= 0) config.muscles[index] = next;
    else config.muscles.push(next);
  });
  closeEditor();
  toast(L('肌肉已保存', 'Muscle saved'));
}

function setError(message: string): void {
  const el = document.getElementById('muscleEditorError');
  if (el) el.textContent = message;
}

export function openMuscleEditor(ctx: UiContext, muscleId?: string): void {
  const muscle = muscleId ? ctx.store.config.muscles.find((item) => item.id === muscleId) : undefined;
  const draft = draftFrom(muscle);
  const signal = editorSignal();
  const root = document.getElementById('modalRoot');
  if (!root) return;

  showModal(
    modalFrame({
      title: muscle ? L('编辑肌肉', 'Edit muscle') : L('新建肌肉', 'New muscle'),
      sub: L('一块肌肉可以映射多条 SVG 路径', 'One muscle can map to multiple SVG paths'),
      body: bodyHTML(ctx, draft),
      foot:
        `<button class="btn btn-ghost" data-action="close-modal">${esc(L('取消', 'Cancel'))}</button>` +
        `<button class="btn btn-primary" data-editor-action="save">${icon('check', 'ic-sm')}${esc(L('保存', 'Save'))}</button>`,
      large: true,
    })
  );

  const refreshPaths = (search: string): void => {
    const list = document.getElementById('musclePathList');
    if (list) list.innerHTML = pathGroups(draft, search);
  };

  root.addEventListener(
    'input',
    (event) => {
      const input = event.target as HTMLInputElement;
      if (input.matches('[data-editor-name]')) draft.name = input.value;
      else if (input.matches('[data-editor-rest]')) draft.rest = input.value;
      else if (input.matches('[data-muscle-path-search]')) refreshPaths(input.value);
      else if (input.matches('[data-level-color]')) draft.levels[Number(input.dataset.levelColor)].color = input.value;
      else if (input.matches('[data-level-max]')) draft.levels[Number(input.dataset.levelMax)].max = input.value;
    },
    { signal }
  );

  root.addEventListener(
    'change',
    (event) => {
      const target = event.target as HTMLInputElement;
      if (target.matches('[data-path-id]')) {
        const id = target.dataset.pathId ?? '';
        if (target.checked) {
          if (!draft.regionIds.includes(id)) draft.regionIds.push(id);
        } else {
          draft.regionIds = draft.regionIds.filter((item) => item !== id);
        }
      } else if (target.matches('[data-editor-metric]')) {
        draft.metric = target.value;
      } else if (target.matches('[data-editor-range]')) {
        draft.range = target.value;
      } else if (target.matches('[data-editor-name]')) {
        draft.name = target.value;
      }
    },
    { signal }
  );

  root.addEventListener(
    'click',
    (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-editor-action]');
      if (!target) return;
      const action = target.dataset.editorAction;
      if (action === 'toggle-coverage') {
        draft.contributes = !draft.contributes;
        target.classList.toggle('on', draft.contributes);
      } else if (action === 'toggle-scale') {
        draft.useDefaultScale = !draft.useDefaultScale;
        if (!draft.useDefaultScale) {
          draft.levels = DEFAULT_HEATMAP_SCALE.map((level) => ({
            color: colorToCss(level.color),
            max: level.max === undefined ? '' : String(level.max),
          }));
        }
        showModal(
          modalFrame({
            title: muscle ? L('编辑肌肉', 'Edit muscle') : L('新建肌肉', 'New muscle'),
            sub: L('一块肌肉可以映射多条 SVG 路径', 'One muscle can map to multiple SVG paths'),
            body: bodyHTML(ctx, draft),
            foot:
              `<button class="btn btn-ghost" data-action="close-modal">${esc(L('取消', 'Cancel'))}</button>` +
              `<button class="btn btn-primary" data-editor-action="save">${icon('check', 'ic-sm')}${esc(
                L('保存', 'Save')
              )}</button>`,
            large: true,
          })
        );
      } else if (action === 'tier') {
        const tier = target.dataset.tier === 'minimal' ? 'minimal' : 'default';
        const mapping = buildMappings(tier);
        draft.regionIds = [...(mapping[draft.id] ?? [])];
        if (draft.regionIds.length === 0) {
          // 新肌肉 id 未必在默认映射表里，退回到按健身群匹配（提示用户手动勾选）
          toast(L('该肌肉不在默认映射表中，请手动勾选路径', 'No default mapping for this muscle; pick paths manually'));
        }
        refreshPaths((root.querySelector('[data-muscle-path-search]') as HTMLInputElement | null)?.value ?? '');
      } else if (action === 'clear-paths') {
        draft.regionIds = [];
        refreshPaths((root.querySelector('[data-muscle-path-search]') as HTMLInputElement | null)?.value ?? '');
      } else if (action === 'save') {
        save(ctx, draft);
      }
    },
    { signal }
  );
}
