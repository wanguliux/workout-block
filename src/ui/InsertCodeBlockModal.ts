import { Modal, setIcon } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { t } from '../i18n';
import { CODE_BLOCK_DEFS, CodeBlockDef } from '../codeBlockDefs';
import { InsertCodeBlockParamModal } from './InsertCodeBlockParamModal';

/*
 * InsertCodeBlockModal —— 快捷插入代码块（主弹窗）
 * 侧边栏点「插入代码块」后弹出：顶部搜索框过滤，下方列出全部训练代码块，
 * 每张卡片含图标/名称/功能说明/「N 个可选参数」徽标；点卡片即进入参数弹窗。
 */
export class InsertCodeBlockModal extends Modal {
  private dataManager: DataManager;
  private searchInput!: HTMLInputElement;
  private listEl!: HTMLDivElement;
  private filtered: CodeBlockDef[] = CODE_BLOCK_DEFS;

  constructor(dataManager: DataManager) {
    super(dataManager.app);
    this.dataManager = dataManager;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('workout-insert-modal');

    contentEl.createEl('h2', { text: t('modal.insertCodeblock.title') });

    // 搜索框
    const searchField = contentEl.createDiv();
    searchField.addClass('workout-field');
    this.searchInput = searchField.createEl('input', { type: 'text' });
    this.searchInput.addClass('workout-input');
    this.searchInput.placeholder = t('modal.insertCodeblock.searchPlaceholder');
    this.searchInput.addEventListener('input', () => this.filter(this.searchInput.value));

    // 卡片列表容器
    this.listEl = contentEl.createDiv();
    this.listEl.addClass('workout-insert-list');

    this.renderList();
  }

  // 按搜索词过滤（匹配标题或说明，大小写不敏感）
  private filter(query: string): void {
    const q = query.trim().toLowerCase();
    if (!q) {
      this.filtered = CODE_BLOCK_DEFS;
    } else {
      this.filtered = CODE_BLOCK_DEFS.filter(
        (d) => d.title.toLowerCase().includes(q) || d.desc.toLowerCase().includes(q)
      );
    }
    this.renderList();
  }

  // 渲染卡片列表
  private renderList(): void {
    this.listEl.empty();
    if (this.filtered.length === 0) {
      this.listEl
        .createDiv({ text: t('modal.insertCodeblock.noMatch') })
        .addClass('workout-insert-empty');
      return;
    }
    for (const def of this.filtered) {
      const card = this.listEl.createDiv();
      card.addClass('workout-insert-card');
      card.setAttribute('role', 'button');
      card.tabIndex = 0;

      // 左侧图标
      const iconEl = card.createSpan();
      iconEl.addClass('workout-insert-card-icon');
      setIcon(iconEl, def.icon);

      // 右侧文字区
      const textWrap = card.createDiv();
      textWrap.addClass('workout-insert-card-text');

      const titleRow = textWrap.createDiv();
      titleRow.addClass('workout-insert-card-title');
      titleRow.createSpan({ text: def.title });

      const badge = titleRow.createSpan({
        text: t('modal.insertCodeblock.paramsCount', { n: String(def.params.length) }),
      });
      badge.addClass('workout-insert-card-badge');

      textWrap.createDiv({ text: def.desc, cls: 'workout-insert-card-desc' });

      // 点击：打开参数弹窗并关闭自身
      const open = () => {
        this.close();
        new InsertCodeBlockParamModal(this.dataManager, def).open();
      };
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
