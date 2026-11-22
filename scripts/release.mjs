#!/usr/bin/env node
/*
 * release.mjs —— 一条命令把当前插件版本发成 GitHub Release（含附件上传）。
 *
 * 为什么需要它：Obsidian 插件不从仓库构建产物安装，而是从 Release 的附件下载
 * main.js / manifest.json / styles.css。所以「打 tag + 建 Release + 挂附件」是发版的
 * 必备三件套，手工在网页点容易漏附件或漏 tag。
 *
 * 用法（仓库根目录）：
 *   node scripts/release.mjs                          # 用 manifest.version 作 tag，自动生成发行说明
 *   node scripts/release.mjs --notes "修复 xxx"        # 手写说明
 *   node scripts/release.mjs --notes-file notes.md    # 从文件读说明
 *   node scripts/release.mjs --tag 1.0.9 --draft      # 指定 tag / 存为草稿
 *   node scripts/release.mjs --dry-run                # 只打印将要做什么
 *
 * 前置：① manifest.json 版本已 bump；② 产物已构建（npm run build）；③ tag 已推到远端
 *       （脚本会检查，缺失就提示，不代推）。
 *
 * 凭据：从系统 git 凭据管理器取（`git credential fill`），不读环境变量、不落盘。
 *       取不到时先跑一次 `git push` 让凭据管理器存下，或安装 gh 后 `gh auth login`。
 *
 * 幂等：Release 已存在则复用，附件已存在则跳过（--force-upload 可覆盖重传）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.github.com';

function sh(cmd, args, input) {
  return spawnSync(cmd, args, { input, encoding: 'utf8' });
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const cwd = process.cwd();
const manifestPath = path.join(cwd, 'manifest.json');
if (!fs.existsSync(manifestPath)) fail(`找不到 manifest.json（请在插件仓库根目录运行）：${cwd}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const tag = opt('tag', manifest.version);
if (!tag) fail('manifest.json 里没有 version，且未用 --tag 指定');
if (!manifest.version) fail('manifest.json 里没有 version');

// —— 远端坐标 ——
const remote = sh('git', ['remote', 'get-url', 'origin']).stdout?.trim();
if (!remote) fail('没有 origin 远端');
const m = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
if (!m) fail(`origin 不是 GitHub 地址：${remote}`);
const [, owner, repo] = m;

// —— tag 必须已存在且已推（Release 依附 tag，凭空建会得到一个无代码的快照）——
const localTag = sh('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]);
if (localTag.status !== 0) fail(`本地没有 tag ${tag}：先 git tag ${tag} && git push origin ${tag}`);
const remoteTag = sh('git', ['ls-remote', '--tags', 'origin', tag]).stdout?.trim();
if (!remoteTag) fail(`远端还没有 tag ${tag}：先 git push origin ${tag}`);

// —— 附件清单（生产构建产物；版本/ 不存在时回退根目录）——
function pick(name) {
  const candidates = [path.join(cwd, '版本', name), path.join(cwd, name)];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}
const wanted = ['main.js', 'manifest.json', 'styles.css', 'versions.json'];
const assets = [];
for (const name of wanted) {
  const p = pick(name);
  if (p) assets.push([name, p]);
}
if (!assets.some(([n]) => n === 'main.js')) {
  fail('找不到 main.js —— Obsidian 从 Release 附件装插件，main.js 不能缺（先 npm run build）');
}
const manifestAsset = assets.find(([n]) => n === 'manifest.json');
if (manifestAsset) {
  const v = JSON.parse(fs.readFileSync(manifestAsset[1], 'utf8')).version;
  if (v !== tag) fail(`附件 manifest.json 版本是 ${v}，与 tag ${tag} 不一致——重新构建产物或改 tag`);
}

const notes = opt('notes') ?? (opt('notes-file') ? fs.readFileSync(opt('notes-file'), 'utf8').trim() : null);

console.log(`仓库    ${owner}/${repo}`);
console.log(`tag     ${tag}（本地/远端均存在）`);
console.log(`附件    ${assets.map(([n]) => n).join(', ')}`);
console.log(`说明    ${notes ? '手写' : '由 GitHub 自动生成'}`);
if (flag('dry-run')) {
  console.log('— dry-run，未做任何写操作');
  process.exit(0);
}

// —— 凭据 ——
const cred = sh('git', ['credential', 'fill'], 'protocol=https\nhost=github.com\n\n');
const token = /password=(.+)/.exec(cred.stdout || '')?.[1]?.trim();
if (!token) {
  fail('取不到 GitHub 凭据：先跑一次 git push 让凭据管理器保存，或安装 gh 后 gh auth login');
}

const H = {
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'obsidian-plugin-release',
};

// —— 建/取 Release ——
let rel = null;
const probe = await fetch(`${API}/repos/${owner}/${repo}/releases/tags/${tag}`, { headers: H });
if (probe.status === 200) {
  rel = await probe.json();
  console.log(`Release 已存在，复用 id=${rel.id}`);
} else if (probe.status !== 404) {
  fail(`查询 Release 失败 HTTP ${probe.status}：${(await probe.text()).slice(0, 200)}`);
} else {
  const payload = { tag_name: tag, name: tag, draft: flag('draft'), prerelease: false };
  if (notes) payload.body = notes;
  else payload.generate_release_notes = true;
  const r = await fetch(`${API}/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  rel = await r.json();
  if (!rel.id) fail(`创建 Release 失败：${JSON.stringify(rel).slice(0, 300)}`);
  console.log(`已创建 Release id=${rel.id}`);
}

// —— 上传附件 ——
const existing = new Set((rel.assets || []).map((a) => a.name));
const force = flag('force-upload');
for (const [name, file] of assets) {
  if (existing.has(name) && !force) {
    console.log(`跳过（远端已有） ${name}`);
    continue;
  }
  // 覆盖重传：先删旧附件，否则 GitHub 会因同名而拒绝
  if (existing.has(name)) {
    const old = rel.assets.find((a) => a.name === name);
    await fetch(`${API}/repos/${owner}/${repo}/releases/assets/${old.id}`, { method: 'DELETE', headers: H });
  }
  const data = fs.readFileSync(file);
  const r = await fetch(
    `https://uploads.github.com/repos/${owner}/${repo}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/octet-stream', 'Content-Length': String(data.length) },
      body: data,
    }
  );
  const j = await r.json();
  if (j.state) console.log(`✓ ${name} (${j.size} bytes)`);
  else fail(`上传 ${name} 失败：${JSON.stringify(j).slice(0, 200)}`);
}

console.log(`\n完成：https://github.com/${owner}/${repo}/releases/tag/${tag}`);
