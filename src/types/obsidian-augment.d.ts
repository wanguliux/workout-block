// 类型增强：补齐 obsidian 包未声明、但 Obsidian 运行时真实存在的成员，
// 以及 SVG 资源的模块声明，使 tsc 类型检查通过。仅影响类型世界，不改变任何运行时行为。
import 'obsidian';

declare module 'obsidian' {
  interface App {
    /** 当前是否处于移动端（运行时提供，obsidian 类型桩未声明） */
    isMobile: boolean;
    /** 设置页管理器，用于打开本插件对应的设置标签 */
    setting: {
      open(): void;
      openTabById(id: string): void;
    };
  }

  // AbstractInputSuggest 的 inputEl 在运行时存在，但 obsidian 类型桩未声明。
  interface AbstractInputSuggest<T> {
    inputEl: HTMLInputElement;
  }
}
