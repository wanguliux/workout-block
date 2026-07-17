import { zh } from './zh';
import { en } from './en';

/*
 * index.ts —— i18n（国际化）核心模块
 * 职责：统一管理「当前语言」并提供 t() 取文案的函数。
 * 工作流程：setLocale() 切换 zh/en 并记录当前字典 → 任意界面调用 t('key.path') 取文字。
 * 字典本体在 zh.ts（中文）和 en.ts（英文）。本文件不直接存文字，只负责「按 key 找文字」。
 */

// 由 zh 字典的顶层 key 推导出语言种类类型（'zh' | 'en' 的等价别名），仅用于类型约束
export type LocaleKey = keyof typeof zh;

// 当前语言，默认中文
let currentLocale: 'zh' | 'en' = 'zh';
// 当前使用的字典对象（zh 或 en），默认指向中文字典
let currentDict = zh;

// 切换语言：把全局变量改成指定的字典，后续 t() 就会从新字典取文字
export function setLocale(locale: 'zh' | 'en') {
  currentLocale = locale;
  currentDict = locale === 'zh' ? zh : en;
}

// 获取当前语言（其他地方需要按语言做格式化的判断时会用到，例如 duration.ts）
export function getLocale(): 'zh' | 'en' {
  return currentLocale;
}

// 获取某个 i18n key 在全部支持语言（zh / en）中的翻译结果，用于多语言反向查找。
// 例如 getAllTranslations('exercise.squat') 会返回 ['深蹲', 'Squat']。
export function getAllTranslations(key: string): string[] {
  const values = new Set<string>();
  for (const dict of [zh, en]) {
    const keys = key.split('.');
    let value: unknown = dict;
    for (const k of keys) {
      if (typeof value === 'object' && value !== null && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        value = undefined;
        break;
      }
    }
    if (typeof value === 'string' && value) {
      values.add(value);
    }
  }
  return Array.from(values);
}

// 核心取文案函数：t('codeblock.edit') 返回当前语言里对应的文字
// 第二个参数 params 用于替换文案里的占位符，例如 t('codeblock.addRecord', { exercise: '深蹲' })
// 会把文案里的 {exercise} 替换成 '深蹲'
export function t(key: string, params?: Record<string, string>): string {
  // 把 'a.b.c' 这样的路径按点号拆成数组 ['a','b','c']，便于一层层往下找
  const keys = key.split('.');
  let value: unknown = currentDict;
  
  // 逐层进入嵌套对象：先 currentDict['a']，再 ['b']，再 ['c']
  for (const k of keys) {
    // 当前层是对象且存在该 key 时，继续往里走；否则说明 key 写错了
    if (typeof value === 'object' && value !== null && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      // 找不到就原样返回 key 本身，方便在界面上立刻发现「文案缺失」
      return key;
    }
  }
  
  // 最终取到的值必须是字符串才算成功，不是字符串也原样返回 key
  if (typeof value !== 'string') {
    return key;
  }
  
  // 有占位符参数时，做正则替换
  // 正则 /{(\w+)}/g 匹配所有 {...} 占位符，(\w+) 捕获花括号里的名字
  // 例如 {exercise} 被替换成 params.exercise 的值；若 params 里没有该参数则保留 {exercise} 原样
  if (params) {
    return value.replace(/{(\w+)}/g, (_, paramName) => params[paramName] || `{${paramName}}`);
  }
  
  // 没有占位符，直接返回文案
  return value;
}