# workout-block-cli（配套技能）

给 workout-block 插件终端用户的 Agent Skill：让 AI 助手「听一句话」就能安全地记录训练、
查询历史、跑统计、给训练计划打卡——所有写操作由 `scripts/workout-cli.js` 这个确定性
脚本完成，与插件共用同一套数据层代码（`src/data/csvFormat.ts` / `configMigrate.ts` /
`statExpr.ts` / `display.ts` / `codeBlockDefs.ts`），不存在第二份 schema。

## 目录结构

```
workout-block-cli/
├── SKILL.md                 # 技能入口：触发词、命令语法、自然语言→参数映射规则
├── README.md                # 本文件：安装与再构建说明
└── scripts/
    └── workout-cli.js       # esbuild 打包的单文件 CLI（Node 18+，无其他运行时依赖）
```

CLI 源码在插件仓库 `src/cli/`，与插件本体同仓维护。

## 安装（终端用户）

1. 确认本机有 Node.js 18+（`node -v`）。
2. 把整个 `workout-block-cli` 文件夹复制到 QoderWork 技能目录：
   - Windows：`%USERPROFILE%\.qoderworkcn\skills\workout-block-cli\`
   - macOS/Linux：`~/.qoderworkcn/skills/workout-block-cli/`
3. 对 AI 助手说「记一笔训练：深蹲 100 公斤 5 次三组」之类的话即可触发。
   助手首次使用会询问你的 Obsidian 仓库根目录路径（--vault 参数）。

## 再构建（插件开发者）

CLI 与插件共享源码，修改 `src/data` 纯模块或 `src/cli` 后需要重新打包：

```bash
npm run build:cli        # 仅重建 CLI 脚本
npm run build            # 生产构建（插件 main.js + CLI 两个产物）
```

产物固定输出到 `workout-block-cli/scripts/workout-cli.js`。

## 命令速览

`node scripts/workout-cli.js help` 查看全部命令。核心：
`locate / doctor / config / resolve / add / list / delete / compact / stats / plan / block`。

## 安全设计

- 写 CSV 一律走 Papa.unparse（嵌套 JSON 引号转义正确）+ 强制规范列序；
- 删除 = 软删除墓碑（与插件同语义），`compact` 才物理清理；
- 整文件写为「临时文件 + rename」原子替换；
- 计划完成 = completedSets 持久化 + 追加记录双写，与插件「完成」按钮逐条一致；
- 代码块生成拒绝未知参数（防「参数写了等于没写」的静默失效坑）。
