/*
 * polyfill.ts —— Node 运行时的 crypto 兜底。
 *
 * src/util/id.ts 的 generateId 依赖全局 crypto.getRandomValues（Obsidian/Electron 自带）。
 * Node 19+ 已内置全局 crypto，更早的版本（Node 18 LTS）需要显式挂载 webcrypto。
 * 本模块在 CLI 入口最先导入，保证 generateId 在任何受支持的 Node 版本可用。
 */
import { webcrypto } from 'node:crypto';

if (typeof (globalThis as { crypto?: unknown }).crypto === 'undefined') {
  (globalThis as unknown as { crypto: unknown }).crypto = webcrypto;
}
