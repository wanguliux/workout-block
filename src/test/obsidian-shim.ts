/*
 * obsidian-shim.ts（测试桩 / mock 文件）
 * 文件作用：用假的（fake）类模拟 Obsidian 的 API，让单元测试能在 Node/浏览器环境里运行，而不依赖真正的 Obsidian 软件。
 * 为什么需要它：单元测试跑在 vitest + jsdom 里，没有真实的 Obsidian 运行环境。vitest.config.ts 会把代码里 `import ... from 'obsidian'`
 * 这个导入"重定向"到本文件，于是测试使用的就是我们这里写的简化版类，而不是真实的 Obsidian。
 * 概念解释："测试桩/打桩(mock/stub)"——用假对象替代外部依赖，使代码可独立、可重复地测试。
 *
 * 注意：这里只是"够测试用"的简化实现，不是 Obsidian 完整 API。
 */

// 收集所有弹出的 Notice（通知）文字，供测试断言；这是真实 Obsidian 没有的测试辅助功能
const notices: string[] = [];

// 测试可读取当前累计的通知列表
export function __getNotices(): string[] {
  return notices;
}

// 测试在每个用例前调用，清空通知记录，保证用例之间互不干扰
export function __resetNotices(): void {
  notices.length = 0;
}

// 模拟 Obsidian 的事件中心：可按事件名注册(on)、注销(off)、触发(trigger)回调
export class Events {
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, callback: (...args: unknown[]) => void): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)?.add(callback);
  }

  off(event: string, callback: (...args: unknown[]) => void): void {
    this.handlers.get(event)?.delete(callback);
  }

  trigger(event: string, ...args: unknown[]): void {
    for (const callback of this.handlers.get(event) ?? []) {
      callback(...args);
    }
  }
}

// App：极简占位，真实插件里它代表整个 Obsidian 应用上下文；测试里通常不需要内容
export class App {}

// Modal：模拟弹窗基类。contentEl 是一个真实 <div>，用于承载弹窗内容。
export class Modal {
  app: any;
  contentEl: HTMLDivElement;

  constructor(app: any) {
    this.app = app;
    this.contentEl = document.createElement('div');
  }

  // 打开弹窗：若子类实现了 onOpen 就调用它（真实 Obsidian 还会把弹窗挂到界面上）
  open(): unknown {
    return (this as any).onOpen?.();
  }

  // 关闭弹窗：若子类实现了 onClose 就调用它
  close(): unknown {
    return (this as any).onClose?.();
  }
}

// 设置页基类：每个插件在"设置"里看到的页面都继承它
export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: HTMLDivElement;

  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement('div');
  }
}

// 模拟"按钮"UI 组件：自动创建一个 <button> 并挂到容器里
export class ButtonComponent {
  buttonEl: HTMLButtonElement;

  constructor(containerEl: HTMLElement) {
    this.buttonEl = document.createElement('button');
    containerEl.appendChild(this.buttonEl);
  }

  setButtonText(text: string): this {
    this.buttonEl.textContent = text;
    return this;
  }

  // 真实 Obsidian 的 ButtonComponent 提供 setWarning()：把按钮设为警告样式（红色）。
  // 这里只做占位，返回 this 以支持链式调用。
  setWarning(): this {
    this.buttonEl.classList.add('mod-warning');
    return this;
  }

  onClick(callback: () => void): this {
    this.buttonEl.addEventListener('click', callback);
    return this;
  }
}

// 模拟"单行文本输入框"组件：创建一个 <input>
export class TextComponent {
  inputEl: HTMLInputElement;

  constructor(containerEl: HTMLElement) {
    this.inputEl = document.createElement('input');
    containerEl.appendChild(this.inputEl);
  }

  setPlaceholder(text: string): this {
    this.inputEl.placeholder = text;
    return this;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  onChange(callback: (value: string) => void): this {
    this.inputEl.addEventListener('change', () => callback(this.inputEl.value));
    return this;
  }
}

// 模拟"下拉选择框"组件：创建一个 <select>
export class DropdownComponent {
  selectEl: HTMLSelectElement;

  constructor(containerEl: HTMLElement) {
    this.selectEl = document.createElement('select');
    containerEl.appendChild(this.selectEl);
  }

  addOption(value: string, label: string): this {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    this.selectEl.appendChild(option);
    return this;
  }

  setValue(value: string): this {
    this.selectEl.value = value;
    return this;
  }

  onChange(callback: (value: string) => void): this {
    this.selectEl.addEventListener('change', () => callback(this.selectEl.value));
    return this;
  }
}

// 模拟"开关(复选框)"组件：创建一个 type=checkbox 的 <input>
export class ToggleComponent {
  toggleEl: HTMLInputElement;

  constructor(containerEl: HTMLElement) {
    this.toggleEl = document.createElement('input');
    this.toggleEl.type = 'checkbox';
    containerEl.appendChild(this.toggleEl);
  }

  setValue(value: boolean): this {
    this.toggleEl.checked = value;
    return this;
  }

  onChange(callback: (value: boolean) => void): this {
    this.toggleEl.addEventListener('change', () => callback(this.toggleEl.checked));
    return this;
  }
}

// 模拟"设置项"组件：一行设置，左边是名称+描述(info)，右边是控件(control)
export class Setting {
  settingEl: HTMLDivElement;
  private infoEl: HTMLDivElement;
  private controlEl: HTMLDivElement;

  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement('div');
    this.infoEl = document.createElement('div');
    this.controlEl = document.createElement('div');
    this.settingEl.append(this.infoEl, this.controlEl);
    containerEl.appendChild(this.settingEl);
  }

  setName(name: string): this {
    const nameEl = document.createElement('div');
    nameEl.textContent = name;
    this.infoEl.appendChild(nameEl);
    return this;
  }

  setDesc(desc: string): this {
    const descEl = document.createElement('div');
    descEl.textContent = desc;
    this.infoEl.appendChild(descEl);
    return this;
  }

  // 往右侧控件区添加一个按钮组件，并把组件交给回调去配置
  addButton(callback: (component: ButtonComponent) => void): this {
    callback(new ButtonComponent(this.controlEl));
    return this;
  }

  addText(callback: (component: TextComponent) => void): this {
    callback(new TextComponent(this.controlEl));
    return this;
  }

  addDropdown(callback: (component: DropdownComponent) => void): this {
    callback(new DropdownComponent(this.controlEl));
    return this;
  }

  addToggle(callback: (component: ToggleComponent) => void): this {
    callback(new ToggleComponent(this.controlEl));
    return this;
  }
}

// 模拟"通知(Notice)"：弹窗提示。构造时把消息文字记到 notices 数组，供测试检查
export class Notice {
  constructor(message: string) {
    notices.push(message);
  }
}

// 模拟输入框自动补全的基类（对应 VaultPathSuggest 继承的那个）
export class AbstractInputSuggest<T> {
  app: any;
  inputEl: HTMLInputElement;

  constructor(app: any, inputEl: HTMLInputElement) {
    this.app = app;
    this.inputEl = inputEl;
  }

  close(): void {}
}

// 模糊/普通选择弹窗的基类链（仅为让导入它们的代码能正常实例化）
export class SuggestModal<T> extends Modal {}

export class FuzzySuggestModal<T> extends SuggestModal<T> {}

// 文件对象占位（测试里基本只用到其 path）
export class TFile {}

// 文件夹对象：带一个 path 字段，对应 VaultFolderSuggestModal 使用的内容
export class TFolder {
  path = '';
}

// 规整路径：把 Windows 的反斜杠 \ 统一替换为正斜杠 /（Obsidian 路径约定用 /）
export function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}
