import { Modal, Notice } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { getMuscleName } from '../data/display';
import { FITNESS_GROUPS, formatSvgMuscleLabel, SVG_MUSCLE_CATALOG, SvgMuscleEntry } from '../data/svgMuscleCatalog';
import { DEFAULT_HEATMAP_SCALE, colorToCss } from '../data/heatmapDefaults';
import { HeatmapLevel, Muscle, RecoveryTuning, StatDef, WorkoutConfig } from '../data/types';
import { DEFAULT_RECOVERY_PARAMS, mergeRecoveryParams } from '../data/recovery';
import { DEFAULT_GROWTH_WINDOW, GROWTH_SCALE } from '../data/muscleGrowth';
import { renderRecoveryPreview } from './recoveryPreview';
import { hasRecoveryTuning as hasRecoveryTuningIn, renderRecoveryTuningForm } from './recoveryTuningForm';
import { parseNumberInput } from '../util/number';

/** 折叠区里可编辑的四个数值参数（RecoveryTuning 中的非 levels 字段）。 */
type NumericTuningKey =
  | 'fatiguePerSet'
  | 'fatigueTau'
  | 'fitnessPerSet'
  | 'fitnessTau'
  | 'detrainDepth'
  | 'detrainTau'
  | 'detrainRef';
import { getLocale, t } from '../i18n';

/* MuscleEditModal —— 编辑单个肌肉的弹窗（新增或编辑共用）。
 * 字段：ID、名称、是否计入覆盖、未练天数阈值、SVG 肌肉映射（1→N 多选）、热力图设置。 */

interface MuscleEditModalOptions {
  muscle?: Muscle;
}

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
  private restThresholdInput!: HTMLInputElement;

  private selectedIds = new Set<string>();
  private searchQuery = '';
  private metricId = '';
  private rangeValue = '';
  private customRange = '';
  private muscleLevels: HeatmapLevel[] | null = null; // 该肌的 4 色分档（逐肌可配）
  // 逐肌恢复曲线微调（留空＝跟随默认；与热力图设置同层，同在「恢复设置」折叠区）
  private recoveryTuning: RecoveryTuning = {};
  // 发展视图色标（比值为分档）；null = 跟随内置那套（<50/50-80/80-120/120-160/>160%）
  private growthLevels: HeatmapLevel[] | null = null;
  // 发展视图的两个时间窗（天）：近期窗算「最近练得怎么样」，中位数窗算「你的常态」。
  // undefined = 跟随默认（28 / 84），不写进配置。
  private growthRecentDays?: number;
  private growthBaselineDays?: number;
  // 编辑中的草稿：只在真正改动时才写回 growthLevels，避免「展开看一眼」就变成自定义
  private growthDraft: HeatmapLevel[] = [];

  private mappingContainer!: HTMLDivElement;
  private countEl!: HTMLElement;
  private recoveryPreviewEl?: HTMLDivElement;
  private heatmapSection!: HTMLDivElement;
  // 热力图设置区块内当前显示哪个视图（恢复 / 发展），只影响这一块的设置项
  private heatmapView: 'recovery' | 'growth' = 'recovery';

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
      this.recoveryTuning = muscle.recovery ? { ...muscle.recovery } : {};
      this.growthLevels = muscle.growthLevels ? this.normalizeLevels(muscle.growthLevels) : null;
      this.growthRecentDays = muscle.growthRecentDays;
      this.growthBaselineDays = muscle.growthBaselineDays;
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

    // 未练天数阈值（决策中心据此提醒「这块肌肉已 N 天没练」）。
    // 原「计入覆盖」开关已删：该字段从不被任何计算消费，只是 UI 标签（见 muscleStats 头注释）。
    const restRow = contentEl.createDiv();
    restRow.addClass('workout-field');
    restRow.createEl('label', { text: t('modal.muscleManager.restThreshold') });
    this.restThresholdInput = restRow.createEl('input', { type: 'number' });
    this.restThresholdInput.addClass('workout-input');
    this.restThresholdInput.setAttribute('step', 'any');
    this.restThresholdInput.setAttribute('inputmode', 'numeric');
    this.restThresholdInput.min = '1';
    this.restThresholdInput.value = String(muscle?.restThresholdDays ?? 7);

    // —— 三个可折叠区块，次序固定：SVG 映射 / 热力图设置 / 恢复曲线设置 ——
    // 这页本来平铺了七八段（ID、阈值、几十个 SVG 路径、色阶、七个曲线参数），滚起来像一堵墙。
    // 折叠后只留基础字段常显，其余按需展开。

    // ① SVG 肌肉映射：长列表，默认收起（搜索框也在里面，展开就能搜）
    const svgDetails = this.makeDetails(contentEl, t('modal.muscleManager.svgMapping'), false);
    this.renderMappingHeader(svgDetails);
    this.mappingContainer = svgDetails.createDiv();
    this.mappingContainer.addClass('workout-fields-list');
    this.mappingContainer.setCssStyles({ maxHeight: '320px', overflow: 'auto' });
    this.renderMappingList();

    // ② 热力图设置：展开后先选视图（恢复 / 发展），下面是该视图对应的设置
    const hmDetails = this.makeDetails(contentEl, t('modal.muscleManager.heatmapSettings'), false);
    const hmSwitch = hmDetails.createDiv();
    hmSwitch.addClass('workout-heatmap-switch');
    const recoveryBtn = hmSwitch.createEl('button', { text: t('codeblock.heatmap.viewRecovery') });
    const growthBtn = hmSwitch.createEl('button', { text: t('codeblock.heatmap.viewGrowth') });
    const syncHmSwitch = (): void => {
      // 用 classList 而不是 toggleClass：后者是 Obsidian 的扩展方法，jsdom 里没有
      recoveryBtn.classList.toggle('mod-cta', this.heatmapView === 'recovery');
      growthBtn.classList.toggle('mod-cta', this.heatmapView === 'growth');
      recoveryBtn.classList.toggle('mod-muted', this.heatmapView === 'growth');
      growthBtn.classList.toggle('mod-muted', this.heatmapView === 'recovery');
    };
    recoveryBtn.addEventListener('click', () => {
      this.heatmapView = 'recovery';
      syncHmSwitch();
      this.renderHeatmapSettings();
    });
    growthBtn.addEventListener('click', () => {
      this.heatmapView = 'growth';
      syncHmSwitch();
      this.renderHeatmapSettings();
    });
    this.heatmapSection = hmDetails.createDiv();
    // 发展视图的色标改动即视为自定义（草稿 → 落库），监听挂一次即可（empty() 只清子节点）
    this.heatmapSection.addEventListener('input', () => {
      if (this.heatmapView !== 'growth') return;
      this.growthLevels = JSON.parse(JSON.stringify(this.growthDraft)) as HeatmapLevel[];
    });
    syncHmSwitch();
    this.renderHeatmapSettings();

    // ③ 恢复曲线设置：默认收起（七个数字参数平时没人动）
    this.renderRecoverySection(contentEl);

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

  /** 建一个「可展开区块」：标题行 + 内容区，默认开合由 open 决定。 */
  private makeDetails(parent: HTMLElement, title: string, open: boolean): HTMLElement {
    const details = parent.createEl('details');
    details.addClass('workout-advanced');
    details.open = open;
    const summary = details.createEl('summary');
    summary.addClass('workout-advanced-summary');
    summary.createSpan({ text: title });
    return details;
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
  }

  private countText(): string {
    return t('modal.muscleManager.selectedCount', { count: String(this.selectedIds.size) });
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

  // —— 发展视图设置（画在「热力图设置」展开区里，切换到发展视图时出现）——
  // 发展视图按「近 4 周练度 ÷ 12 周中位数」的**比值**上色，阈值是百分比（0.5 = 50%），
  // 与热力图的绝对量分档不是一回事，必须单独一套；不动它＝跟随内置那套（不写配置）。
  private renderGrowthSettings(container: HTMLElement): void {
    container.createEl('p', { text: t('modal.muscleManager.growthHint'), cls: 'workout-hint' });

    // 两个时间窗（单位天）：近期窗决定「最近练得怎么样」看多长，中位数窗决定「你的常态」看多长。
    // 留空＝跟随默认（28 / 84），不写进配置；填了才是逐肌自定义。
    const winRow = container.createDiv();
    winRow.addClass('workout-two-col');
    const windowFields: Array<{ key: 'growthRecentDays' | 'growthBaselineDays'; label: string; def: number }> = [
      { key: 'growthRecentDays', label: t('modal.muscleManager.growthRecentWindow'), def: DEFAULT_GROWTH_WINDOW.recentDays },
      { key: 'growthBaselineDays', label: t('modal.muscleManager.growthBaselineWindow'), def: DEFAULT_GROWTH_WINDOW.baselineDays },
    ];
    for (const f of windowFields) {
      const field = winRow.createDiv();
      field.addClass('workout-field');
      field.createEl('label', { text: f.label });
      const input = field.createEl('input', { type: 'number' });
      input.addClass('workout-input');
      input.setAttribute('step', 'any');
      input.setAttribute('inputmode', 'numeric'); // 移动端直接弹数字键盘
      input.min = '7';
      input.max = '730';
      const current = this[f.key];
      input.value = typeof current === 'number' ? String(current) : '';
      input.placeholder = String(f.def);
      input.addEventListener('input', () => {
        const v = parseNumberInput(input.value);
        if (v === undefined || v < 7) {
          delete this[f.key];
        } else {
          this[f.key] = Math.min(730, Math.round(v));
        }
      });
    }

    // 草稿与落库分开：只是展开看一眼不该把默认值写成「自定义」
    if (this.growthDraft.length === 0) {
      this.growthDraft = this.growthLevels
        ? (JSON.parse(JSON.stringify(this.growthLevels)) as HeatmapLevel[])
        : this.normalizeLevels(GROWTH_SCALE);
    }

    const countRow = container.createDiv();
    countRow.addClass('workout-field');
    countRow.createEl('label', { text: t('modal.muscleManager.colorLevels') });
    const countInput = countRow.createEl('input', { type: 'number' });
    countInput.addClass('workout-input');
    countInput.setAttribute('step', 'any');
    countInput.setAttribute('inputmode', 'numeric');
    countInput.min = '2';
    countInput.max = '9';
    countInput.value = String(this.growthDraft.length);
    countInput.setCssStyles({ width: '70px' });
    countInput.addEventListener('input', () => {
      let n = parseInt(countInput.value, 10);
      if (isNaN(n)) n = this.growthDraft.length;
      n = Math.max(2, Math.min(9, n));
      this.setGrowthLevelCount(n);
      this.growthLevels = JSON.parse(JSON.stringify(this.growthDraft)) as HeatmapLevel[];
      this.renderHeatmapSettings();
    });

    const scaleContainer = container.createDiv();
    this.renderScaleRows(scaleContainer, this.growthDraft);
  }

  /** 按分级数增减发展视图色标（新增档沿用内置色板，末档永远开口）。 */
  private setGrowthLevelCount(n: number): void {
    const levels = this.growthDraft.slice();
    if (n <= levels.length) {
      this.growthDraft = levels.slice(0, n).map((l, i) => ({ ...l, max: i === n - 1 ? Infinity : l.max }));
      return;
    }
    for (let i = levels.length; i < n; i++) {
      const src = GROWTH_SCALE[Math.min(i, GROWTH_SCALE.length - 1)];
      const prev = i > 0 ? levels[i - 1].max ?? 0.8 : 0;
      levels.push({
        color: src.color,
        max: Number.isFinite(prev) ? Math.round((prev + 0.4) * 100) / 100 : Infinity,
      });
    }
    levels[levels.length - 1] = { ...levels[levels.length - 1], max: Infinity };
    this.growthDraft = levels;
  }

  // —— 恢复曲线设置（折叠区）——
  // 七个形状参数逐肌可覆盖，留空＝跟随默认（与热力图 heatmapMetric/heatmapLevels 同形态）。
  // 表单本身抽在 recoveryTuningForm.ts（代码块的设置弹窗用同一份，避免字段顺序/校验两处漂移）。
  private renderRecoverySection(parent: HTMLElement): void {
    const details = this.makeDetails(parent, t('modal.muscleManager.recoverySettings'), false);

    // 参数一变就重画预览：这是这组数字唯一的「说人话」方式
    renderRecoveryTuningForm(details, this.recoveryTuning, () => this.renderRecoveryPreviewNow());

    // 底部预览：一次标准训练（8 练度）之后曲线的样子，坐标轴固定，改参数即可比形状。
    this.recoveryPreviewEl = details.createDiv();
    this.recoveryPreviewEl.addClass('workout-recovery-preview');
    this.renderRecoveryPreviewNow();
  }

  /** 用当前草稿参数重画预览（未填的字段自动回落默认）。 */
  private renderRecoveryPreviewNow(): void {
    if (!this.recoveryPreviewEl) return;
    renderRecoveryPreview(this.recoveryPreviewEl, mergeRecoveryParams(DEFAULT_RECOVERY_PARAMS, this.recoveryTuning));
  }

  private hasRecoveryTuning(): boolean {
    return hasRecoveryTuningIn(this.recoveryTuning);
  }

  private renderHeatmapSettings(): void {
    this.heatmapSection.empty();
    // 发展视图的色标与恢复视图的指标/分级不是一套东西，直接切分支渲染
    if (this.heatmapView === 'growth') {
      this.renderGrowthSettings(this.heatmapSection);
      return;
    }

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
    this.renderScaleRows(scaleContainer, this.muscleLevels);
  }

  /**
   * 渲染一组色阶行（色块 / hex / ≤ / 阈值）。
   * 热力图色标与发展视图色标是同一套结构（HeatmapLevel[]），共用这一份渲染，
   * 否则两处各写一遍，改个交互要改两个地方、迟早不一致。
   */
  private renderScaleRows(scaleContainer: HTMLElement, levels: HeatmapLevel[]): void {
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const isLast = i === levels.length - 1;
      const row = scaleContainer.createDiv();
      row.addClass('workout-scale-row');

      // 色块：原生拾色器兼作预览小圆点
      const swatch = row.createEl('input', { type: 'color' });
      swatch.value = this.normalizeHex(level.color);
      swatch.addClass('workout-scale-swatch');

      const hexInput = row.createEl('input', { type: 'text' });
      hexInput.addClass('workout-input', 'workout-scale-hex');
      hexInput.value = level.color;
      hexInput.placeholder = '#3b82f6';
      hexInput.title = t('modal.muscleManager.colorHex');

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

  // 把任意来源的分档规整为「可显示/可保存」形态：命名色→hex；缺失阈值补默认。
  private normalizeLevels(input?: HeatmapLevel[]): HeatmapLevel[] {
    const base = input && input.length ? input : DEFAULT_HEATMAP_SCALE;
    const levels = base.map((l) => ({
      color: colorToCss(l.color),
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
    const mapped = colorToCss(c);
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
      // 字段仍保留在数据里（向后兼容），只是不再让用户配：编辑时沿用原值，新建默认 true
      contributesToCoverage: this.options.muscle?.contributesToCoverage ?? true,
      restThresholdDays: parseInt(this.restThresholdInput.value) || 7,
      svgRegionIds: Array.from(this.selectedIds),
      heatmapMetric: this.metricId || undefined,
      heatmapRange: range || undefined,
      heatmapLevels: this.muscleLevels ? (JSON.parse(JSON.stringify(this.muscleLevels)) as HeatmapLevel[]) : undefined,
      growthLevels: this.growthLevels ? (JSON.parse(JSON.stringify(this.growthLevels)) as HeatmapLevel[]) : undefined,
      growthRecentDays: this.growthRecentDays,
      growthBaselineDays: this.growthBaselineDays,
      recovery: this.hasRecoveryTuning() ? { ...this.recoveryTuning } : undefined,
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
