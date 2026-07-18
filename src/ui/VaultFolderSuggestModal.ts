/*
 * VaultFolderSuggestModal.ts
 * 文件作用：实现一个"模糊搜索选择文件夹"的弹窗，让用户从 Obsidian 仓库（vault）里挑选一个目录。
 * 架构角色：继承 Obsidian 内置的 FuzzySuggestModal（模糊搜索弹窗），用于设置数据文件存放位置。
 * 当用户在设置页点"Browse"时打开这个弹窗，选中文件夹后把路径回传给调用方。
 */

import { App, FuzzySuggestModal, TFolder } from 'obsidian';

// 继承 FuzzySuggestModal<TFolder>：泛型 TFolder 表示弹窗里每条可选项都是一个文件夹对象
export class VaultFolderSuggestModal extends FuzzySuggestModal<TFolder> {
  // 用户选中某个文件夹后，通过这个回调把路径（字符串）交还给外部
  private onSelectCallback: (value: string) => void;

  constructor(app: App, onSelect: (value: string) => void) {
    super(app);
    this.onSelectCallback = onSelect;
    // 输入框里的占位提示文字
    this.setPlaceholder('Select a folder');
  }

  // 返回弹窗里要展示的全部可选项：取出 vault 里所有"已加载的文件"，过滤出其中的文件夹（TFolder）
  getItems(): TFolder[] {
    return this.app.vault.getAllLoadedFiles().filter((file) => file instanceof TFolder);
  }

  // 决定每个文件夹在列表里显示的文本（这里用它的路径，空路径显示根目录 '/'）
  getItemText(item: TFolder): string {
    return item.path || '/';
  }

  // 用户用键盘/鼠标选中某一项时触发：拿到它的路径并回调给外部
  onChooseItem(item: TFolder): void {
    const value = item.path || '';
    this.onSelectCallback(value);
  }
}
