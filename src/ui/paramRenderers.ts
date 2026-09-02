/*
 * ui/paramRenderers.ts —— 参数控件渲染器（BlockProvider 契约 v2：参数渲染委托）
 *
 * 宿主（InsertCodeBlockParamModal）对「自身不认识的 type」不再一律降级文本，
 * 而是按 block.pluginId 定向委托给定义方插件的 renderParamField()（见 blockProvider
 * getPluginParamRenderer）。本模块即 workout-block 侧的实现：main.ts 的 renderParamField
 * 委托到这里，渲染本插件声明的自定义参数控件。
 *
 * 渲染器契约（与宿主的边界）：
 * - 渲染器自含「字段名/描述 + 控件」的完整内容块（宿主委托时直接把整块 append 进表单区，
 *   不包宿主自己的 label 结构）——被委托的控件是提供方私有，外观只能由契约 CSS 保障。
 * - 字段名/描述用契约前缀 block-param-*（CSS 片段随共享契约分发，宿主各复制一份，见
 *   obsidian-block-dev/references/blockprovider-contract.md §参数渲染委托）。
 * - 值变更一律经 ctx.onChange 回写宿主表单，渲染器不持有表单状态。
 * - 下拉面板复用 workout 自有 workout-combo-* 类：委托触发的前提是本插件已启用，
 *   其 styles.css 必然已被 Obsidian 全局加载，外观与自家弹窗一致。
 * - 生命周期卫生：不用 document 级 mousedown 监听（宿主弹窗关闭后无法回收），
 *   改用 input blur 关闭 + 候选 mousedown preventDefault 保焦。
 */

import { t } from '../i18n';
import { getExerciseName, getTrainingTypeName } from '../data/display';
import type { BlockParamDef, ParamRenderContext } from '../blockProvider';
import type { WorkoutConfig } from '../data/types';

/** workout 自定义参数控件统一入口（main.renderParamField 委托到此；未知 type 防御性回落文本） */
export function renderParamControl(
  container: HTMLElement,
  param: BlockParamDef,
  ctx: ParamRenderContext,
  config: WorkoutConfig,
): void {
  switch (param.type) {
    case 'exercise': {
      // 渲染器自含完整字段块：宿主委托时不套自己的 label 结构
      const field = container.createDiv({ cls: 'block-param-ms' });
      field.createDiv({ cls: 'block-param-field-name', text: param.label });
      if (param.description) {
        field.createDiv({ cls: 'block-param-field-desc', text: param.description });
      }
      renderExerciseCombobox(field, param, ctx, config);
      break;
    }
    default:
      // 防御：宿主理论上只委托「宿主不认识、定义方声明」的 type；漏网之鱼回落文本
      renderTextField(container, param, ctx);
      break;
  }
}

/**
 * 训练项搜索 combobox（与 RecordModal / 自家插入弹窗同款交互）。
 * 选中后回填训练项展示名（与 workout 代码块解析端一致），并通知宿主。
 */
function renderExerciseCombobox(
  container: HTMLElement,
  param: BlockParamDef,
  ctx: ParamRenderContext,
  config: WorkoutConfig,
): void {
  const exercises = config.exercises ?? [];
  const trainingTypes = config.trainingTypes ?? [];

  const wrapper = container.createDiv({ cls: 'workout-combo-wrapper' });
  const input = wrapper.createEl('input', { type: 'text' });
  input.addClass('workout-input');
  input.addClass('workout-combo-input');
  if (param.placeholder) input.placeholder = param.placeholder;

  const dropdown = wrapper.createDiv();
  dropdown.addClass('workout-combo-dropdown');
  dropdown.setCssStyles({ display: 'none' });

  let filtered = [...exercises];
  let highlighted = -1;

  const notify = (): void => {
    ctx.onChange(input.value.trim());
  };

  const renderDropdown = (): void => {
    dropdown.empty();
    const q = input.value.trim().toLowerCase();
    filtered = q
      ? exercises.filter((ex) => {
          const name = getExerciseName(ex).toLowerCase();
          return name.includes(q) || ex.id.toLowerCase().includes(q);
        })
      : [...exercises];
    highlighted = -1;

    if (filtered.length === 0) {
      const emptyItem = dropdown.createDiv({ text: t('modal.recordSet.noMatchingExercise') });
      emptyItem.addClass('workout-combo-item');
      emptyItem.addClass('workout-combo-empty');
      return;
    }

    for (const ex of filtered) {
      const item = dropdown.createDiv();
      item.addClass('workout-combo-item');
      item.createSpan({ text: getExerciseName(ex) });
      const typeTag = item.createSpan({
        text: getTrainingTypeName(trainingTypes.find((tt) => tt.id === ex.category)) || ex.category,
      });
      typeTag.addClass('workout-combo-type-tag');

      // mousedown 阻止默认行为：避免 input 先失焦触发 blur 关闭，导致 click 落空
      item.addEventListener('mousedown', (e) => e.preventDefault());
      item.addEventListener('click', () => {
        input.value = getExerciseName(ex);
        dropdown.setCssStyles({ display: 'none' });
        notify();
      });
      item.addEventListener('mouseenter', () => {
        highlighted = filtered.indexOf(ex);
        const items = dropdown.querySelectorAll('.workout-combo-item');
        items.forEach((el, i) => (el as HTMLElement).toggleClass('workout-combo-highlighted', i === highlighted));
      });
    }
  };

  const openDropdown = (): void => {
    renderDropdown();
    dropdown.setCssStyles({ display: 'block' });
  };
  const closeDropdown = (): void => {
    dropdown.setCssStyles({ display: 'none' });
    highlighted = -1;
  };

  if (ctx.initial) input.value = ctx.initial;

  input.addEventListener('focus', openDropdown);
  input.addEventListener('input', () => {
    openDropdown();
    notify();
  });
  input.addEventListener('blur', closeDropdown);
  input.addEventListener('keydown', (e) => {
    if (dropdown.style.display === 'none') {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        openDropdown();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = dropdown.querySelectorAll('.workout-combo-item');
      if (items.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      highlighted = Math.min(Math.max(highlighted + step, 0), items.length - 1);
      items.forEach((el, i) => (el as HTMLElement).toggleClass('workout-combo-highlighted', i === highlighted));
      (items[highlighted] as HTMLElement).scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const ex = filtered[highlighted];
      if (ex) {
        input.value = getExerciseName(ex);
        notify();
      }
      closeDropdown();
    }
  });
}

/** 防御性文本输入回落（自含字段名/描述 + 文本框） */
function renderTextField(
  container: HTMLElement,
  param: BlockParamDef,
  ctx: ParamRenderContext,
): void {
  const field = container.createDiv({ cls: 'block-param-ms' });
  field.createDiv({ cls: 'block-param-field-name', text: param.label });
  if (param.description) {
    field.createDiv({ cls: 'block-param-field-desc', text: param.description });
  }
  const input = field.createEl('input', { type: 'text', cls: 'block-param-text' });
  if (param.placeholder) input.placeholder = param.placeholder;
  input.value = ctx.initial ?? '';
  input.addEventListener('input', () => ctx.onChange(input.value.trim()));
}
