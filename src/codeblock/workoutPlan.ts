import { MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownView, TFile } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { FieldDef, TrainingPlanInstance, WorkoutConfig } from '../data/types';
import { t } from '../i18n';
import { getExerciseNameById, getFieldUnit, getTrainingTypeName, renderFieldValue, formatTimeRule } from '../data/display';
import { registerRenderedBlock, unregisterRenderedBlock, rerenderBlocksByType } from './registry';
import { PlanSetEditModal } from '../ui/PlanSetEditModal';

/*
 * workoutPlan.ts —— 把 ```workout-plan 代码块渲染成「训练计划完成面板」。
 * 代码块只需要一个 plan 参数（= 计划名，全局唯一），即决定显示哪个具体计划实例。
 * 无 plan 时渲染「选择计划」下拉框，选中后把计划名写回代码块（变为 plan: 选中的计划名）。
 * 有 plan 时渲染完成面板：每个训练项的每组展示预设值 + [编辑][完成]；点「完成」写一条 CSV 记录
 * （时间=点击时刻），点「编辑」弹小窗改该组值（复用编辑记录界面的字段渲染）。
 */

interface PlanParams {
  plan?: string;
}

function parseParams(source: string): PlanParams {
  const params: PlanParams = {};
  for (const line of source.split('\n')) {
    // 只在第一个冒号处切分，保证值里带冒号（如计划名「推胸: A」）也能完整保留，
    // 否则 `line.split(':')` 只取第二段会导致写回代码块后无法正确解析。
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    if (key === 'plan') params.plan = value;
  }
  return params;
}

// 把一组的字段渲染成「值 单位」空格分隔的展示文字（如 `60 kg 8 次`）。
function formatSetFields(fields: Record<string, unknown>, typeFields: FieldDef[], unit: 'kg' | 'lb'): string {
  return typeFields
    .map((f) => {
      const v = fields[f.key];
      if (v === undefined || v === null) return '';
      const rv = renderFieldValue(v, f, unit);
      if (f.mass) return `${rv} ${unit}`; // 质量字段附上单位（kg/lb，跟随设置）
      const u = getFieldUnit(f, unit);
      return u ? `${rv} ${u}` : rv;
    })
    .filter(Boolean)
    .join(' ');
}

const registeredComponents = new WeakMap<HTMLElement, boolean>();

export async function renderWorkoutPlan(
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  dataManager: DataManager
): Promise<void> {
  if (!registeredComponents.has(el)) {
    const child = new MarkdownRenderChild(el);
    child.onunload = () => {
      unregisterRenderedBlock(el);
      registeredComponents.delete(el);
    };
    ctx.addChild(child);
    registeredComponents.set(el, true);
    registerRenderedBlock(el, 'workout-plan', source, ctx);
  }

  const params = parseParams(source);
  const config = await dataManager.getConfig();
  const plans = config.plans ?? [];
  const plan = params.plan ? plans.find((p) => p.name === params.plan) : undefined;

  if (!plan) {
    renderSelectPlan(el, dataManager, ctx, plans);
    return;
  }

  renderPanel(el, dataManager, plan, config);
}

// 无 plan（或 plan 找不到）：渲染「选择计划」下拉框；选中后把计划名写回代码块。
function renderSelectPlan(el: HTMLElement, dataManager: DataManager, ctx: MarkdownPostProcessorContext, plans: TrainingPlanInstance[]): void {
  const wrap = el.createDiv();
  wrap.addClass('workout-plan-select');

  const label = wrap.createEl('label', { text: t('codeblock.plan.select') });
  label.addClass('workout-plan-select-label');

  if (plans.length === 0) {
    wrap.createDiv({ text: t('codeblock.plan.noPlan') }).addClass('workout-hint');
    return;
  }

  const select = wrap.createEl('select');
  select.addClass('workout-select');
  select.createEl('option', { value: '', text: t('codeblock.plan.selectPlaceholder') });
  for (const p of plans) {
    select.createEl('option', { value: p.name, text: p.name });
  }
  select.addEventListener('change', () => {
    void (async () => {
      const name = select.value;
      if (!name) return;
      await writePlanToCodeBlock(dataManager, ctx, el, name);
    })();
  });
}

// 把选中的计划名写入代码块源（改写笔记里的 ```workout-plan 块），随后 Obsidian 自动重渲染。
// 修复机制 B：原先用 vault.modify(file, ...) 整文件改写当前正在编辑的笔记，
// Obsidian 会当成「外部改动」重新加载该笔记，导致编辑器光标/选区/撤销栈全部重置（光标丢失、无法输入）。
// 改为：若当前文件正好在 Markdown 编辑器（Live Preview/源码）中打开，则仅用 editor.replaceRange
// 做「局部替换」——编辑器内部事务，不触发整文件 reload，焦点与光标得以保留；只有在无法拿到
// 对应编辑器（如阅读模式、或在别的文件里）时，才退回 vault.modify 兜底（该场景没有可丢失的光标）。
async function writePlanToCodeBlock(dataManager: DataManager, ctx: MarkdownPostProcessorContext, el: HTMLElement, name: string): Promise<void> {
  const section = ctx.getSectionInfo(el);
  if (!section) return;
  const file = dataManager.app.vault.getAbstractFileByPath(ctx.sourcePath);
  if (!(file instanceof TFile)) return;
  const newBlock = '```workout-plan\nplan: ' + name.trim() + '\n```';

  // 找到正在编辑该文件的 Markdown 视图，优先用编辑器事务局部替换。
  const mdView = dataManager.app.workspace
    .getLeavesOfType('markdown')
    .map((leaf) => leaf.view)
    .find((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === ctx.sourcePath);
  if (mdView && mdView.editor) {
    const editor = mdView.editor;
    const from = { line: section.lineStart, ch: 0 };
    const to = { line: section.lineEnd, ch: editor.getLine(section.lineEnd).length };
    editor.replaceRange(newBlock, from, to);
    return;
  }

  // 兜底：当前笔记未在可编辑视图打开（如阅读模式），只能用整文件改写；
  // 此场景不存在「正在编辑的光标」，故不会造成光标丢失。
  const content = await dataManager.app.vault.read(file);
  const lines = content.split('\n');
  lines.splice(section.lineStart, section.lineEnd - section.lineStart + 1, newBlock);
  await dataManager.app.vault.modify(file, lines.join('\n'));
}

function renderPanel(el: HTMLElement, dataManager: DataManager, plan: TrainingPlanInstance, config: WorkoutConfig): void {
  const unit = dataManager.getSettings().unit;
  const container = el.createDiv();
  container.addClass('workout-plan-panel');

  // 计算进度：完成状态来自计划配置里持久化的 completedSets（独立于训练记录），
  // 这样即使删除了该组产生的训练记录，完成状态依然保留。
  const enabledItems = plan.items.filter((i) => i.enabled);
  const completedSets = plan.completedSets ?? {};
  const completedKeys = new Set(Object.keys(completedSets));
  let totalSets = 0;
  let doneSets = 0;
  for (const item of enabledItems) {
    for (const set of item.sets) {
      totalSets++;
      if (completedKeys.has(`${item.exerciseId}#${set.id}`)) doneSets++;
    }
  }

  // 计划头
  const header = container.createDiv();
  header.addClass('workout-plan-header');
  header.createSpan({ text: plan.name }).addClass('workout-plan-name');
  const timeText = formatTimeRule(plan.timeRule);
  if (timeText) {
    header.createSpan({ text: timeText }).addClass('workout-plan-time');
  }
  header.createSpan({ text: t('codeblock.plan.progress', { done: String(doneSets), total: String(totalSets) }) }).addClass('workout-plan-progress');

  // 训练项 + 组
  for (const item of enabledItems) {
    const type = config.trainingTypes.find((tt) => tt.id === item.category);
    const exerciseName = getExerciseNameById(config.exercises, item.exerciseId);
    const typeName = getTrainingTypeName(type);

    const itemEl = container.createDiv();
    itemEl.addClass('workout-plan-item');
    itemEl.createDiv({ text: `${exerciseName}${typeName ? ` [${typeName}]` : ''}` }).addClass('workout-plan-item-title');

    const setsEl = itemEl.createDiv();
    setsEl.addClass('workout-plan-sets');

    item.sets.forEach((set, sidx) => {
      const isCompleted = completedKeys.has(`${item.exerciseId}#${set.id}`);
      const row = setsEl.createDiv();
      row.addClass('workout-row', 'workout-plan-set');

      row.createSpan({ text: t('modal.newPlan.setName', { n: String(sidx + 1) }) }).addClass('workout-plan-setno');
      const fieldsText = formatSetFields(set.fields, type?.fields ?? [], unit);
      row.createSpan({ text: fieldsText || t('codeblock.plan.emptyFields') }).addClass('workout-plan-setfields');

      if (isCompleted) {
        row.createSpan({ text: t('codeblock.plan.completed') }).addClass('workout-plan-completed');
      } else {
        // 编辑按钮（仅未完成时显示：改该组计划预设值）
        const editBtn = row.createEl('button', { text: t('codeblock.plan.edit') });
        editBtn.addClass('mod-cta', 'workout-plan-set-edit');
        editBtn.addEventListener('click', () => {
          new PlanSetEditModal(dataManager, {
            exerciseId: item.exerciseId,
            category: item.category,
            title: t('codeblock.plan.editTitle', { exercise: exerciseName, n: String(sidx + 1) }),
            initialFields: set.fields,
            onSave: async (fields) => {
              await dataManager.updatePlanSetFields(plan.name.trim(), item.exerciseId, set.id, fields);
              rerenderBlocksByType('workout-plan');
            },
          }).open();
        });

        // 完成按钮（仅未完成显示）
        const completeBtn = row.createEl('button', { text: t('codeblock.plan.complete') });
        completeBtn.addClass('mod-cta', 'workout-plan-set-complete');
        completeBtn.addEventListener('click', () => {
          void (async () => {
            // 1) 持久化「已完成」状态到计划配置（独立于训练记录，删除记录不影响）
            await dataManager.markPlanSetCompleted(plan, item.exerciseId, set.id);
            // 2) 同时往训练记录库写一条数据；plan 存稳定方案标识（sourceNote 或 id），而非可改的计划名
            await dataManager.addLog({
              exerciseId: item.exerciseId,
              category: item.category,
              fields: { ...set.fields, _planSet: set.id },
              plan: plan.sourceNote || plan.id,
            });
            rerenderBlocksByType('workout-plan');
          })();
        });
      }
    });
  }
}
