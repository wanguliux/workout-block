import { Modal, Notice } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { getMuscleName } from '../data/display';
import { MUSCLE_FITNESS_GROUP } from '../data/muscleMapping';
import { FITNESS_GROUPS, formatSvgMuscleLabel, SVG_MUSCLE_CATALOG, SvgMuscleEntry } from '../data/svgMuscleCatalog';
import { HeatmapLevel, Muscle, StatDef, WorkoutConfig } from '../data/types';
import { getLocale, t } from '../i18n';

/* MuscleEditModal —— 编辑单个肌肉的弹窗（新增或编辑共用）。
 * 字段：ID、名称、是否计入覆盖、未练天数阈值、SVG 肌肉映射（1→N 多选）、热力图设置。 */

interface MuscleEditModalOptions {
  muscle?: Muscle;
}

const DEFAULT_HEATMAP_SCALE: HeatmapLevel[] = [
  { color: '#3b82f6', max: 5 },
  { color: '#22c55e', max: 10 },
  { color: '#f97316', max: 20 },
  { color: '#ef4444', max: 40 },
];

// 生成"轻→重"渐变色：蓝(220)→红(0) 的 HSL 插值，作为分级数的默认配色。
function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function hexForIndex(i: number, n: number): string {
  const start = 220, end = 0;
  const hue = n <= 1 ? start : start + (end - start) * (i / (n - 1));
  return hslToHex(hue, 72, 50);
}

const RANGE_OPTIONS = ['7d', '30d', '90d', 'all'];

export class MuscleEditModal extends Modal {
  private dataManager: DataManager;
  private options: MuscleEditModalOptions;
  private config!: WorkoutConfig;

  private idInput!: HTMLInputElement;
  private nameInput!: HTMLInputElement;
  private coverageToggle!: HTMLInputElement;
  private restThresholdInput!: HTMLInputElement;

  private selectedIds = new Set<string>();
  private searchQuery = '';
  private metricId = '';
  private rangeValue = '';
  private customRange = '';
  private muscleLevels: HeatmapLevel[] | null = null; // 该肌的 4 色分档（逐肌可配）

  private mappingContainer!: HTMLDivElement;
  private countEl!: HTMLElement;
  private heatmapSection!: HTMLDivElement;

  constructor(dataManager: DataManager, options: MuscleEditModalOptions = {}) {
    super(dataManager.app);
    this.dataManager = dataManager;
    this.options = options;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('workout-edit-modal');

    this.config = await this.dataManager.getConfig();

    const muscle = this.options.muscle;
    if (muscle) {
      this.selectedIds = new Set(muscle.svgRegionIds ?? []);
      this.metricId = muscle.heatmapMetric ?? '';
      this.rangeValue = muscle.heatmapRange ?? '';
      this.muscleLevels = muscle.heatmapLevels ? this.normalizeLevels(muscle.heatmapLevels) : null;
      if (!RANGE_OPTIONS.includes(this.rangeValue) && this.rangeValue) {
        this.customRange = this.rangeValue;
        this.rangeValue = 'custom';
      }
    }

    contentEl.createEl('h2', { text: muscle ? t('modal.muscleManager.editTitle') : t('modal.muscleManager.add') });

    // 两列网格：ID + 名称
    const idNameCol = contentEl.createDiv();
    idNameCol.addClass('workout-two-col');

    // ID
    const idRow = idNameCol.createDiv();
    idRow.addClass('workout-field');
    idRow.createEl('label', { text: 'ID' });
    this.idInput = idRow.createEl('input', { type: 'text' });
    this.idInput.addClass('workout-input');
    this.idInput.placeholder = 'id';
    if (muscle?.id) {
      this.idInput.value = muscle.id;
      this.idInput.disabled = true;
    }

    // 名称
    const nameRow = idNameCol.createDiv();
    nameRow.addClass('workout-field');
    nameRow.createEl('label', { text: t('modal.muscleManager.name') });
    this.nameInput = nameRow.createEl('input', { type: 'text' });
    this.nameInput.addClass('workout-input');
    if (muscle) {
      this.nameInput.value = getMuscleName(muscle);
    }

    // 两列网格：计入覆盖（开关）+ 未练天数阈值
    const coverRestCol = contentEl.createDiv();
    coverRestCol.addClass('workout-two-col');

    // 覆盖（布尔开关）
    const coverageToggleWrap = coverRestCol.createDiv();
    coverageToggleWrap.addClass('workout-toggle');
    this.coverageToggle = coverageToggleWrap.createEl('input', { type: 'checkbox', cls: 'workout-switch' });
    coverageToggleWrap.createSpan({ text: t('modal.muscleManager.coverage') });
    if (muscle?.contributesToCoverage) {
      this.coverageToggle.checked = true;
    }

    // 未练天数阈值
    const restRow = coverRestCol.createDiv();
    restRow.addClass('workout-field');
    restRow.createEl('label', { text: t('modal.muscleManager.restThreshold') });
    this.restThresholdInput = restRow.createEl('input', { type: 'number' });
    this.restThresholdInput.addClass('workout-input');
    this.restThresholdInput.setAttribute('step', 'any');
    this.restThresholdInput.setAttribute('inputmode', 'numeric');
    this.restThresholdInput.min = '1';
    this.restThresholdInput.value = String(muscle?.restThresholdDays ?? 7);

    // SVG 肌肉映射
    contentEl.createEl('h3', { text: t('modal.muscleManager.svgMapping'), cls: 'workout-section-title' });
    this.renderMappingHeader(contentEl);
    this.mappingContainer = contentEl.createDiv();
    this.mappingContainer.addClass('workout-fields-list');
    this.mappingContainer.setCssStyles({ maxHeight: '320px', overflow: 'auto' });
    this.renderMappingList();

    // 热力图设置
    contentEl.createEl('h3', { text: t('modal.muscleManager.heatmapSettings'), cls: 'workout-section-title' });
    this.heatmapSection = contentEl.createDiv();
    this.renderHeatmapSettings();

    // 底部按钮
    const btnRow = contentEl.createDiv();
    btnRow.addClass('workout-btn-row');

    const cancelBtn = btnRow.createEl('button', { text: t('common.cancel') });
    cancelBtn.addClass('mod-muted');
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = btnRow.createEl('button', { text: t('common.save') });
    saveBtn.addClass('mod-cta');
    saveBtn.addEventListener('click', () => { void this.save(); });
  }

  private renderMappingHeader(parent: HTMLElement): void {
    const header = parent.createDiv();
    header.addClass('workout-mapping-toolbar');

    const search = header.createEl('input', { type: 'text' });
    search.addClass('workout-input');
    search.placeholder = t('modal.muscleManager.searchPaths');
    search.addEventListener('input', () => {
      this.searchQuery = search.value.trim().toLowerCase();
      this.renderMappingList();
    });

    this.countEl = header.createSpan({ text: this.countText() });
    this.countEl.addClass('workout-mapping-count');

    const clearBtn = header.createEl('button', { text: t('modal.muscleManager.clearMapping') });
    clearBtn.addClass('mod-muted');
    clearBtn.addEventListener('click', () => {
      this.selectedIds.clear();
      this.renderMappingList();
    });

    const presetBtn = header.createEl('button', { text: t('modal.muscleManager.applyGroupPreset') });
    presetBtn.addClass('mod-cta');
    presetBtn.addEventListener('click', () => this.applyGroupPreset());
  }

  private countText(): string {
    return t('modal.muscleManager.selectedCount', { count: String(this.selectedIds.size) });
  }

  private applyGroupPreset(): void {
    const muscleId = this.options.muscle?.id ?? this.idInput.value.trim();
    const group = MUSCLE_FITNESS_GROUP[muscleId];
    if (!group) return;
    for (const entry of SVG_MUSCLE_CATALOG) {
      if (entry.fitnessGroup === group) {
        this.selectedIds.add(entry.id);
      }
    }
    this.renderMappingList();
  }

  // SVG 路径显示标签：复用目录层格式化，自动区分段号与左右。
  private formatEntryLabel(entry: SvgMuscleEntry, locale: string): string {
    return formatSvgMuscleLabel(entry, locale);
  }

  private renderMappingList(): void {
    this.mappingContainer.empty();
    this.countEl.textContent = this.countText();

    const locale = getLocale();
    const query = this.searchQuery;
    const filtered = query
      ? SVG_MUSCLE_CATALOG.filter((e) =>
          e.id.toLowerCase().includes(query) ||
          e.zh.toLowerCase().includes(query) ||
          e.en.toLowerCase().includes(query)
        )
      : SVG_MUSCLE_CATALOG;

    if (filtered.length === 0) {
      this.mappingContainer.createEl('p', { text: t('modal.muscleManager.noPaths') });
      return;
    }

    // 按 side + fitnessGroup 分组
    const grouped = new Map<string, Map<string, typeof SVG_MUSCLE_CATALOG>>();
    for (const entry of filtered) {
      if (!grouped.has(entry.side)) grouped.set(entry.side, new Map());
      const sideMap = grouped.get(entry.side)!;
      if (!sideMap.has(entry.fitnessGroup)) sideMap.set(entry.fitnessGroup, []);
      sideMap.get(entry.fitnessGroup)!.push(entry);
    }

    const sideOrder: Array<'front' | 'back'> = ['front', 'back'];
    for (const side of sideOrder) {
      const sideMap = grouped.get(side);
      if (!sideMap) continue;

      const sideHeader = this.mappingContainer.createEl('h4', { text: t(side === 'front' ? 'modal.muscleManager.front' : 'modal.muscleManager.back') });
      sideHeader.setCssStyles({ margin: '8px 0 4px' });

      for (const group of FITNESS_GROUPS) {
        const entries = sideMap.get(group.key);
        if (!entries || entries.length === 0) continue;

        const groupWrap = this.mappingContainer.createDiv();
        groupWrap.addClass('workout-mapping-group');

        const groupHeader = groupWrap.createDiv();
        groupHeader.addClass('workout-mapping-group-title');
        groupHeader.textContent = locale === 'zh' ? group.zh : group.en;

        const grid = groupWrap.createDiv();
        grid.addClass('workout-check-grid');

        for (const entry of entries) {
          const item = grid.createEl('label');
          item.addClass('workout-check-item');
          const checkbox = item.createEl('input', { type: 'checkbox' });
          checkbox.checked = this.selectedIds.has(entry.id);
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) this.selectedIds.add(entry.id);
            else this.selectedIds.delete(entry.id);
            this.countEl.textContent = this.countText();
          });
          item.createSpan({ text: this.formatEntryLabel(entry, locale), title: entry.id });
        }
      }
    }
  }

  private renderHeatmapSettings(): void {
    this.heatmapSection.empty();

    // —— 两列网格：时间窗 + 指标
    const rangeMetricCol = this.heatmapSection.createDiv();
    rangeMetricCol.addClass('workout-two-col');

    // —— 时间窗（已调到指标上方）
    const rangeRow = rangeMetricCol.createDiv();
    rangeRow.addClass('workout-field');
    rangeRow.createEl('label', { text: t('modal.muscleManager.heatmapRange') });
    const rangeSelect = rangeRow.createEl('select');
    rangeSelect.addClass('workout-select');
    rangeSelect.createEl('option', { value: '', text: t('modal.muscleManager.followDefaultRange') });
    for (const r of RANGE_OPTIONS) {
      const opt = rangeSelect.createEl('option', { value: r, text: r });
      if (this.rangeValue === r) opt.selected = true;
    }
    const customOpt = rangeSelect.createEl('option', { value: 'custom', text: t('modal.muscleManager.customRange') });
    if (this.rangeValue === 'custom') customOpt.selected = true;

    const customInput = rangeRow.createEl('input', { type: 'text' });
    customInput.addClass('workout-input');
    customInput.placeholder = 'YYYY-MM-DD..YYYY-MM-DD';
    customInput.setCssStyles({ display: this.rangeValue === 'custom' ? 'block' : 'none' });
    customInput.value = this.customRange;

    rangeSelect.addEventListener('change', () => {
      this.rangeValue = rangeSelect.value;
      customInput.setCssStyles({ display: this.rangeValue === 'custom' ? 'block' : 'none' });
    });
    customInput.addEventListener('input', () => {
      this.customRange = customInput.value.trim();
    });

    // —— 指标
    const metricRow = rangeMetricCol.createDiv();
    metricRow.addClass('workout-field');
    metricRow.createEl('label', { text: t('modal.muscleManager.heatmapMetric') });
    const metricSelect = metricRow.createEl('select');
    metricSelect.addClass('workout-select');
    metricSelect.createEl('option', { value: '', text: t('modal.muscleManager.followDefaultMetric') });
    for (const stat of this.config.statistics) {
      const opt = metricSelect.createEl('option', { value: stat.id, text: stat.name });
      if (stat.id === this.metricId) opt.selected = true;
    }
    metricSelect.addEventListener('change', () => {
      this.metricId = metricSelect.value;
      // 阈值逐肌独立，不随指标切换清空；若从未设置，会自动按新指标/默认指标模板初始化。
      this.renderHeatmapSettings();
    });

    // —— 颜色分档（逐肌，始终可配）
    // 已有则用已有分档；否则用所选/默认指标(StatDef)的默认分档初始化。
    if (!this.muscleLevels) {
      const stat = this.resolveMetricStat();
      this.muscleLevels = this.normalizeLevels(stat?.heatmapScale ?? DEFAULT_HEATMAP_SCALE);
    }

    const hint = this.heatmapSection.createEl('p', {
      text: t('modal.muscleManager.scaleHint'),
      cls: 'workout-manager-detail',
    });
    hint.setCssStyles({ marginTop: '4px' });

    // —— 颜色分级数（控制在指标下方）：决定下方颜色设置栏的数量 ——
    const countRow = this.heatmapSection.createDiv();
    countRow.addClass('workout-field');
    countRow.createEl('label', { text: t('modal.muscleManager.colorLevels') });
    const countInput = countRow.createEl('input', { type: 'number' });
    countInput.addClass('workout-input');
    countInput.setAttribute('step', 'any');
    countInput.setAttribute('inputmode', 'numeric');
    countInput.min = '1';
    countInput.max = '99';
    countInput.value = String(this.muscleLevels.length);
    countInput.setCssStyles({ width: '70px' });
    countInput.addEventListener('input', () => {
      let n = parseInt(countInput.value, 10);
      if (isNaN(n)) n = 1;
      n = Math.max(1, Math.min(99, n));
      this.setLevelCount(n);
      this.renderHeatmapSettings();
    });

    // —— 颜色设置栏：左侧色块(可拾取/预览)+十六进制代码，中间 ≤，右侧阈值 ——
    const scaleContainer = this.heatmapSection.createDiv();
    for (let i = 0; i < this.muscleLevels.length; i++) {
      const level = this.muscleLevels[i];
      const isLast = i === this.muscleLevels.length - 1;
      const row = scaleContainer.createDiv();
      row.addClass('workout-scale-row');

      // 色块：原生拾色器兼作预览小圆点
      const swatch = row.createEl('input', { type: 'color' });
      swatch.value = this.normalizeHex(level.color);
      swatch.addClass('workout-scale-swatch');

      // 十六进制颜色代码输入框
      const hexInput = row.createEl('input', { type: 'text' });
      hexInput.addClass('workout-input', 'workout-scale-hex');
      hexInput.value = level.color;
      hexInput.placeholder = '#3b82f6';
      hexInput.title = t('modal.muscleManager.colorHex');

      // 色块 <-> hex 双向同步
      swatch.addEventListener('input', () => {
        level.color = swatch.value;
        hexInput.value = swatch.value;
      });
      hexInput.addEventListener('input', () => {
        const v = hexInput.value.trim();
        level.color = v;
        if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
          swatch.value = this.normalizeHex(v);
        }
      });

      // ≤ 分隔符（末档为无穷大，不显示阈值输入框）
      const le = row.createSpan({ text: '≤' });
      le.addClass('workout-scale-sep');

      if (isLast) {
        const unbounded = row.createSpan({ text: t('modal.muscleManager.scaleUnbounded') });
        unbounded.addClass('workout-scale-unbounded');
      } else {
        const maxInput = row.createEl('input', { type: 'number' });
        maxInput.addClass('workout-input', 'workout-scale-max');
        maxInput.setAttribute('step', 'any');
        maxInput.setAttribute('inputmode', 'decimal');
        maxInput.value = level.max === undefined ? '' : String(level.max);
        maxInput.addEventListener('input', () => {
          const v = parseFloat(maxInput.value);
          level.max = isNaN(v) ? undefined : v;
        });
      }
    }
  }

  // 解析当前应作为「默认分档模板」的 StatDef：
  // 显式选了指标 → 用该指标；跟随默认 → 找全局默认指标（heatmapDefault: true，种子默认「次数」）。
  private resolveMetricStat(): StatDef | undefined {
    if (this.metricId) {
      return this.config.statistics.find((s) => s.id === this.metricId);
    }
    return this.config.statistics.find((s) => s.heatmapDefault) ?? this.config.statistics[0];
  }

  private colorCss(color: string): string {
    const map: Record<string, string> = {
      blue: '#3b82f6',
      green: '#22c55e',
      orange: '#f97316',
      red: '#ef4444',
    };
    if (color.startsWith('#')) return color; // 十六进制直接返回
    return map[color] ?? color;
  }

  // 把任意来源的分档规整为「可显示/可保存」形态：命名色→hex；缺失阈值补默认。
  private normalizeLevels(input?: HeatmapLevel[]): HeatmapLevel[] {
    const base = input && input.length ? input : DEFAULT_HEATMAP_SCALE;
    const levels = base.map((l) => ({
      color: this.colorCss(l.color),
      max: l.max,
    }));
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].max === undefined) {
        const prev = i > 0 ? levels[i - 1].max ?? 0 : 0;
        levels[i].max = prev <= 0 ? 5 : prev + 10;
      }
    }
    return levels;
  }

  // 把颜色规整为 6 位十六进制，供原生 <input type="color"> 使用（短写 #abc → #aabbcc）。
  private normalizeHex(c: string): string {
    if (c.startsWith('#')) {
      if (/^#[0-9a-fA-F]{3}$/.test(c)) {
        return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
      }
      if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
    }
    const mapped = this.colorCss(c);
    return mapped.startsWith('#') && /^#[0-9a-fA-F]{6}$/.test(mapped) ? mapped : '#3b82f6';
  }

  // 按分级数调整分档数组：减少则截断，增加则追加（新档用渐变默认色 + 递增阈值）。
  private setLevelCount(n: number): void {
    const levels = this.muscleLevels ? this.muscleLevels.slice() : [];
    if (n <= levels.length) {
      this.muscleLevels = levels.slice(0, n);
      return;
    }
    let prevMax = levels.length ? (levels[levels.length - 1].max ?? 0) : 0;
    while (levels.length < n) {
      const idx = levels.length;
      prevMax = prevMax <= 0 ? 5 : Math.round(prevMax * 1.8);
      levels.push({ color: hexForIndex(idx, n), max: prevMax });
    }
    this.muscleLevels = levels;
  }

  private async save(): Promise<void> {
    const id = this.idInput.value.trim();
    const name = this.nameInput.value.trim();

    if (!id) {
      new Notice(t('modal.muscleManager.idRequired'));
      return;
    }
    if (!name) {
      new Notice(t('modal.muscleManager.nameRequired'));
      return;
    }

    const range = this.rangeValue === 'custom' ? (this.customRange || '') : this.rangeValue;

    const muscleData: Muscle = {
      id,
      nameKey: this.options.muscle?.nameKey,
      name,
      contributesToCoverage: this.coverageToggle.checked,
      restThresholdDays: parseInt(this.restThresholdInput.value) || 7,
      svgRegionIds: Array.from(this.selectedIds),
      heatmapMetric: this.metricId || undefined,
      heatmapRange: range || undefined,
      heatmapLevels: this.muscleLevels ? JSON.parse(JSON.stringify(this.muscleLevels)) : undefined,
    };

    try {
      if (this.options.muscle) {
        await this.dataManager.updateMuscle(id, muscleData);
      } else {
        await this.dataManager.addMuscle(muscleData);
      }
      new Notice(t('modal.muscleManager.saved'));
      this.close();
    } catch {
      new Notice(t('modal.muscleManager.saveFailed'));
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
