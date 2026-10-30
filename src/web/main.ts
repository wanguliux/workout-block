/*
 * main.ts —— 网页版入口。
 * 装配 Store（localStorage 数据层）→ App（外壳 + 五视图）→ 挂载到 #app。
 * 同时挂载 window.__workoutWeb 供冒烟测试与调试使用。
 */

import './styles.css';
import { WebStore } from './store';
import { WebApp } from './app';

const root = document.getElementById('app');
if (!root) {
  throw new Error('workout-block web: #app container not found');
}

const store = new WebStore();
const app = new WebApp(store);
app.mount(root);

// 冒烟测试 / 调试入口（见 scripts/web-smoke.mjs）
(window as unknown as { __workoutWeb: unknown }).__workoutWeb = { app, store };
