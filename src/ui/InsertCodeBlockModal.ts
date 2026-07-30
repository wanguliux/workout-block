/*
 * InsertCodeBlockModal —— 跨插件通用代码块插入器（主弹窗）
 *
 * 布局：标题 → 搜索框 → 横向 Tab 栏（按插件切换，可滚动） → 当前插件的卡片列表。
 * 用户点击顶部 Tab 切换不同插件的代码块；搜索框在当前 Tab 范围内过滤。
 * 单插件时 Tab 栏隐藏（无需切换）。
 *
 * 架构角色：first-claim wins 宿主策略下的"宿主 UI"——
 * 第一个注册 insert-block 命令的插件创建此弹窗，
 * 合并所有已注册 BlockProvider 的定义并通过 Tab 分组展示。
 */

import { Modal, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { t } from '../i18n';
import { getBlockProviders, type ProviderGroup, type BlockDefinitionWithParams } from '../blockProvider';
import { InsertCodeBlockParamModal } from './InsertCodeBlockParamModal';

export class InsertCodeBlockModal extends Modal {
  private dataManager: DataManager;
  private searchInput!: HTMLInputElement;
  private tabBarEl!: HTMLDivElement;
  private listEl!: HTMLDivElement;
  private groups: ProviderGroup[] = [];
  private activeTab = 0;
  private tabButtons: HTMLButtonElement[] = [];

  constructor(app: App, dataManager: DataManager) {
    super(app);
    this.dataManager = dataManager;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('workout-insert-modal');

    contentEl.createEl('h2', { text: t('modal.insertCodeblock.title') });

    // 搜索框
    const searchField = contentEl.createDiv({ cls: 'workout-field' });
    this.searchInput = searchField.createEl('input', { type: 'text' });
    this.searchInput.addClass('workout-input');
    this.searchInput.placeholder = t('modal.insertCodeblock.searchPlaceholder');
    this.searchInput.addEventListener('input', () => this.renderCards());

    // Tab 栏（横向可滚动）
    this.tabBarEl = contentEl.createDiv({ cls: 'workout-insert-tabs' });

    // 卡片列表容器
    this.listEl = contentEl.createDiv({ cls: 'workout-insert-list' });

    // 加载 provider 数据
    this.groups = getBlockProviders(this.app);

    // 构建 Tab 按钮
    this.buildTabs();

    // 初始渲染
    this.renderCards();

    // 自动聚焦搜索框
    this.searchInput.focus();
  }

  /** 构建 Tab 按钮（单插件时隐藏 Tab 栏） */
  private buildTabs(): void {
    this.tabBarEl.empty();
    this.tabButtons = [];

    if (this.groups.length <= 1) {
      this.tabBarEl.style.display = 'none';
      return;
    }

    for (let i = 0; i < this.groups.length; i++) {
      const group = this.groups[i];
      const btn = this.tabBarEl.createEl('button', { cls: 'workout-insert-tab' });
      btn.setText(group.pluginId);
      btn.setAttribute('data-index', String(i));

      btn.addEventListener('click', () => {
        this.activeTab = i;
        this.updateTabActive();
        this.renderCards();
      });

      this.tabButtons.push(btn);
    }

    this.updateTabActive();
  }

  /** 更新 Tab 激活状态 */
  private updateTabActive(): void {
    for (let i = 0; i < this.tabButtons.length; i++) {
      this.tabButtons[i].toggleClass('is-active', i === this.activeTab);
    }
  }

  /** 渲染当前 Tab + 搜索条件下的卡片列表 */
  private renderCards(): void {
    this.listEl.empty();

    if (this.groups.length === 0) {
      this.listEl.createDiv({ text: t('modal.insertCodeblock.noMatch'), cls: 'workout-insert-empty' });
      return;
    }

    // 确保 activeTab 有效
    if (this.activeTab >= this.groups.length) {
      this.activeTab = 0;
    }

    const group = this.groups[this.activeTab];
    const q = this.searchInput.value.trim().toLowerCase();

    const matched = q
      ? group.blocks.filter(
          (b) =>
            b.name.toLowerCase().includes(q) ||
            (b.description ?? '').toLowerCase().includes(q),
        )
      : group.blocks;

    if (matched.length === 0) {
      this.listEl.createDiv({ text: t('modal.insertCodeblock.noMatch'), cls: 'workout-insert-empty' });
      return;
    }

    for (const block of matched) {
      this.renderCard(block);
    }
  }

  /** 渲染单张卡片 */
  private renderCard(block: BlockDefinitionWithParams): void {
    const card = this.listEl.createDiv();
    card.addClass('workout-insert-card');
    card.setAttribute('role', 'button');
    card.tabIndex = 0;

    // 左侧图标
    if (block.icon) {
      const iconEl = card.createSpan();
      iconEl.addClass('workout-insert-card-icon');
      setIcon(iconEl, block.icon);
    }

    // 右侧文字区
    const textWrap = card.createDiv();
    textWrap.addClass('workout-insert-card-text');

    const titleRow = textWrap.createDiv();
    titleRow.addClass('workout-insert-card-title');
    titleRow.createSpan({ text: block.name });

    if (block.params.length > 0) {
      const badge = titleRow.createSpan({
        text: t('modal.insertCodeblock.paramsCount', { n: String(block.params.length) }),
      });
      badge.addClass('workout-insert-card-badge');
    }

    if (block.description) {
      textWrap.createDiv({ text: block.description, cls: 'workout-insert-card-desc' });
    }

    // 点击：打开参数弹窗并关闭自身
    const open = () => {
      this.close();
      new InsertCodeBlockParamModal(this.app, this.dataManager, block).open();
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
