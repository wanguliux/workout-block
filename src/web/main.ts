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

// 调试 / 冒烟测试入口：只在本地或显式 ?debug=1 时暴露，别把 store 挂到每个访客页面上
const isLocal =
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:');
const debugRequested = typeof location !== 'undefined' && /(?:^|[?&])debug=1(?:&|$)/.test(location.search);
if (isLocal || debugRequested) {
  (window as unknown as { __workoutWeb: unknown }).__workoutWeb = { app, store };
}
