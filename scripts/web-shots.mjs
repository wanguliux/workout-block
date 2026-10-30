/*
 * web-shots.mjs —— 网页版投稿截图生成器（开发机可选工具，非构建/测试链必需）。
 *
 * 用途：给「WorkBuddy 1024 造物挑战」投稿批量生成界面截图（细则要求 1–9 张）。
 * 流程：先起静态服务（在 web/ 目录跑任意静态服务器，默认 127.0.0.1:8787），
 *       本脚本驱动系统 Chrome 打开页面 → 用页面自带的「载入演示数据」灌两周数据
 *       → 逐页截图到 投稿素材/，并额外生成 web/og.png（社媒分享卡预览图）。
 *
 * 依赖：playwright（本机开发环境安装；用系统 Chrome channel，无需下载浏览器）。
 *   运行：PLAYWRIGHT_NODE_MODULES=<playwright 所在 node_modules> node scripts/web-shots.mjs
 *   例：PLAYWRIGHT_NODE_MODULES=C:/Users/wanguliu/.workbuddy/binaries/node/workspace/node_modules node scripts/web-shots.mjs
 *   （ESM import 不吃 NODE_PATH，故用 createRequire 从指定目录解析）
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, '投稿素材');
const webDir = path.join(root, 'web');
const BASE = process.env.WEB_SHOTS_URL || 'http://127.0.0.1:8787/index.html';

// playwright 解析：优先环境变量指定，其次仓库本地 node_modules
const nmDir = process.env.PLAYWRIGHT_NODE_MODULES || path.join(root, 'node_modules');
const require = createRequire(path.join(nmDir, 'package.json'));
const { chromium } = require('playwright');

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.side-nav');

const goto = async (hash) => {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await page.waitForTimeout(450);
};

const shot = async (hash, filename) => {
  await goto(hash);
  await page.screenshot({ path: path.join(outDir, filename), fullPage: true });
  console.log(`  ✓ ${filename}`);
};

console.log('\n生成投稿截图 →', outDir);

// 用页面自带的演示数据入口灌数（与真人操作路径一致）
const seedButton = await page.$('.demo-banner [data-action="seed-demo"]');
if (seedButton) {
  await seedButton.click();
  await page.waitForTimeout(300);
  await page.click('#modalRoot [data-action="confirm-yes"]');
  await page.waitForTimeout(900);
}

await shot('#/dashboard', '00-总览.png');
await shot('#/record', '01-记录.png');
await shot('#/history', '02-日志.png');
await shot('#/analysis/stats', '03-统计.png');
await shot('#/analysis/heatmap', '04-肌肉热力图.png');
await shot('#/plans', '09-训练计划.png');
await shot('#/customize', '05-自定义.png');
await shot('#/settings', '10-设置.png');

// 英文版一张（展示双语能力）
await goto('#/settings');
await page.selectOption('[data-setting="language"]', 'en');
await page.waitForTimeout(500);
await shot('#/record', '06-英文版-记录.png');
await goto('#/settings');
await page.selectOption('[data-setting="language"]', 'zh');
await page.waitForTimeout(400);

// 深色模式一张
await page.click('[data-action="toggle-theme"]');
await page.waitForTimeout(500);
await shot('#/dashboard', '08-深色模式.png');
await page.click('[data-action="toggle-theme"]');
await page.waitForTimeout(400);

// 社媒分享卡预览图：1200×630，供 index.html 的 og:image 使用
await goto('#/dashboard');
await page.setViewportSize({ width: 1200, height: 630 });
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(webDir, 'og.png') });
console.log('  ✓ web/og.png');
await ctx.close();

// 移动端一张
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const mp = await mobile.newPage();
await mp.goto(BASE, { waitUntil: 'load' });
await mp.waitForTimeout(800);
const mbanner = await mp.$('.demo-banner [data-action="seed-demo"]');
if (mbanner) {
  await mbanner.click();
  await mp.waitForTimeout(300);
  await mp.click('#modalRoot [data-action="confirm-yes"]');
  await mp.waitForTimeout(900);
}
await mp.screenshot({ path: path.join(outDir, '07-移动端.png'), fullPage: true });
console.log('  ✓ 07-移动端.png');
await mobile.close();

await browser.close();
console.log('\n完成\n');
