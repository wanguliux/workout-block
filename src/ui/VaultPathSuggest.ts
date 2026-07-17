/*
 * VaultPathSuggest.ts
 * 文件作用：在设置页的"数据目录"文本框里输入路径时，实时下拉提示匹配的文件夹（输入建议）。
 * 架构角色：继承 Obsidian 的 AbstractInputSuggest，给一个 HTML 输入框绑定自动补全能力。
 * 与 VaultFolderSuggestModal 的区别：这里是在文本框里"边打字边提示"，而不是弹出整屏选择窗。
 */

import { App, AbstractInputSuggest, TFolder } from 'obsidian';

// 继承 AbstractInputSuggest<string>：泛型 string 表示建议项是路径字符串
export class VaultPathSuggest extends AbstractInputSuggest<string> {
  // 用户从下拉里选中某条建议后，通过这个回调把路径交还外部
  private onSelectCallback: (value: string) => void;

  constructor(
    app: App,
    inputEl: HTMLInputElement,
    onSelect: (value: string) => void
  ) {
    super(app, inputEl);
    this.onSelectCallback = onSelect;
  }

  // 核心逻辑：根据当前输入框内容 query，计算要展示的文件夹路径建议列表
  getSuggestions(query: string): string[] {
    const suggestions: string[] = [];
    // 取出 vault 里所有文件夹（真实 Obsidian API 用 getAllLoadedFiles + TFolder 过滤）
    const folders = this.app.vault.getAllLoadedFiles().filter((file) => file instanceof TFolder);

    // Obsidian 路径用 '/' 分段（如 logs/config/2024）。把输入按 '/' 切分：
    // currentPrefix 是最后一个 '/' 之前的部分（已写好、不可变的父路径）
    const parts = query.split('/');
    const currentPrefix = parts.slice(0, -1).join('/');
    // searchTerm 是当前正在输入的"最后一段"，转小写以便忽略大小写匹配
    const searchTerm = parts[parts.length - 1].toLowerCase();

    for (const folder of folders) {
      const folderPath = folder.path;

      if (currentPrefix) {
        // 已有父路径前缀：只在"该前缀直接下属"的文件夹里找当前段匹配的
        if (folderPath.startsWith(currentPrefix + '/')) {
          // 去掉父前缀，得到相对路径再判断开头是否匹配 searchTerm
          const relativePath = folderPath.substring(currentPrefix.length + 1);
          if (relativePath.toLowerCase().startsWith(searchTerm)) {
            suggestions.push(currentPrefix + '/' + relativePath);
          }
        }
      } else {
        // 没有父路径前缀（用户还在输入第一段）：直接按整个路径前缀匹配
        if (folderPath.toLowerCase().startsWith(searchTerm)) {
          suggestions.push(folderPath);
        }
      }
    }

    // 最多只展示前 10 条建议，避免列表过长
    return suggestions.slice(0, 10);
  }

  // 在一条下拉建议里显示的文字（空路径显示根目录 '/'）
  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value || '/');
  }

  // 用户从下拉里选中某条建议：把文本框内容设为该路径、回调外部、并关闭下拉
  selectSuggestion(value: string): void {
    this.inputEl.value = value;
    this.onSelectCallback(value);
    this.close();
  }
}
