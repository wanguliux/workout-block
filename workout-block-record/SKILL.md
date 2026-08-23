---
name: workout-block-record
description: 通过随附 workout-cli 脚本在 Obsidian 之外安全读写 workout-block 训练插件的数据：一句话记录训练、查询历史、跑统计、训练计划打卡、修改配置（训练项/训练类型/肌肉/统计/计划的增删改）、生成 workout 代码块、数据体检。当用户说「记一笔训练」「我今天练了…」「帮我记录深蹲/卧推/跑步…」「查我最近的训练」「这周训练量多少」「完成训练计划某组」「加一个新训练项/训练类型」「生成 workout-log 代码块」，或需要批量/定时操作训练数据时使用。
---

# Workout Block CLI

在 Obsidian UI 之外读写 workout-block 插件的数据。**自然语言理解由你（agent）完成，
一切落盘操作必须交给随附脚本**——脚本与插件共用同一套数据层代码，CSV 转义、列序、
软删除、计划完成态语义与插件逐字节同构。绝不手动编辑 `workout_logs.csv` / `workout-config.json`。

## 前置与调用方式

需要 Node.js 18+。脚本在本技能目录 `scripts/workout-cli.js`：

```bash
node <本技能目录>/scripts/workout-cli.js <命令> --vault <Obsidian仓库根目录> [选项]
```

- 首次接入先跑 `locate` 核对数据落点（设置/CSV/配置路径、重量单位、语言）。
- 所有查询类命令支持 `--json` 获取机器可读输出。
- 写入后 Obsidian 里的插件会自动重载数据并刷新代码块渲染，无需额外操作。

## 自然语言 → 参数映射规则

1. **训练项名**：中文/英文/id 均可（深蹲、Squat、squat 等价）。拿不准先 `resolve <名字>` 确认。
2. **字段 key 用内部标识**（weight/reps/duration_sec…），不是中文标签；`resolve` 的输出里有字段清单，`*` 为必填。
3. **质量字段**（如 weight）：把用户说的数字原样传入，脚本按插件设置的单位（kg/lb）解析并统一以 kg 存储。用户没提单位就按插件设置走，**不要自行换算**。
4. **时长字段**（如 duration_sec）：可传 `90`（秒）、`1分30秒`、`1h30m`、`1:30:20`。
5. **时间**：用户说「今天/刚练完」省略 `--time`（默认当前时刻）；指定了具体时间用 `--time "YYYY-MM-DD HH:mm"`，只给日期会自动补 00:00。
6. **「N 组」**：字段值相同时用 `--sets N`，时间戳自动逐组 +1 分钟；每组字段不同就分多次 add。
7. **完成后复述**：向用户复述已记录的内容（项目/字段/时间）；脚本报错时按错误信息修正参数重试。

## 命令参考

定位与体检：

```bash
workout-cli locate --vault <V>                     # 数据文件定位（首次必跑）
workout-cli doctor --vault <V>                     # 数据体检（只读）：表头/脏行/墓碑/重复 id
```

查询配置（录入前建议先 resolve）：

```bash
workout-cli config exercises|types|stats|plans|muscles --vault <V>
workout-cli resolve 深蹲 --vault <V>                # 中/英/id 反查训练项与字段清单
```

写入配置（训练项/训练类型/肌肉/统计 增改删；级联规则与插件一致；删除需 --yes）：

```bash
workout-cli config add-exercise --name 哑铃飞鸟 --category strength --muscle chest:primary --vault <V>
workout-cli config update-exercise --exercise 哑铃飞鸟 --new-id dumbbell_fly --vault <V>
#   改 id 会级联改写已有记录的 exerciseId
workout-cli config delete-exercise --exercise dumbbell_fly --yes --vault <V>
#   级联软删除该训练项的全部记录
workout-cli config add-type --name 柔韧 --fields-json '[{"key":"duration_sec","inputType":"duration","required":true}]' --vault <V>
workout-cli config update-type --type 柔韧 --new-id flexibility --vault <V>   # 级联记录/训练项/统计
workout-cli config add-muscle --name 前锯肌 --rest-days 5 --vault <V>
workout-cli config add-stat --name 总时长 --types aerobic --builder sum:duration_sec --vault <V>
#   --builder：count / sum:<字段> / avg|max|min:<字段> / productSum:<a>,<b> / oneRepMax:<重量>,<次数>；也可 --expr "sum(reps*weight)"
workout-cli config update-stat --stat 总时长 --enabled false --vault <V>
workout-cli config delete-stat --stat 总时长 --yes --vault <V>
```

训练记录：

```bash
workout-cli add --exercise 深蹲 weight=100 reps=5 --sets 3 --note 状态不错 --vault <V>
workout-cli add --exercise Running duration_sec=30m --time "2026-08-07 07:30" --vault <V>
workout-cli list --exercise 深蹲 --from 2026-08-01 --to 2026-08-07 --last 10 --vault <V>
workout-cli delete --id <记录id> --vault <V>        # 软删除（与插件删除同语义）
workout-cli compact --vault <V>                    # 清理墓碑、压缩 CSV
```

统计（与插件 workout-log 代码块同一套求值器）：

```bash
workout-cli stats --vault <V>                                  # 全部启用统计，不分组的总量
workout-cli stats --stat 训练总量 --exercise 深蹲 --group date --vault <V>
workout-cli stats --from 2026-08-01 --to 2026-08-07 --group week --vault <V>
```

训练计划（set id 用 `plan show` 查看）：

```bash
workout-cli plan list --vault <V>
workout-cli plan show --plan 推拉腿 --vault <V>
workout-cli plan complete --plan 推拉腿 --exercise 深蹲 --set s1 --vault <V>
#   与插件「完成」按钮完全一致：持久化完成态 + 同时写一条训练记录；
#   删除该记录不影响完成态。
workout-cli plan add --name 推拉日 --weekdays 1,3,5 --source-note 推拉方案 --vault <V>
#   方案笔记 = 含 ≥2 个 workout-log 代码块的笔记，训练项从代码块 exercise 参数提取；
#   也可 --items-json '[{"exerciseId":"squat","sets":[{"fields":{"weight":60}}]}]' 手动指定
workout-cli plan update --plan 推拉日 --new-name 推拉腿 --vault <V>
#   改名级联改写 vault 内 workout-plan 代码块；完成态在更新中保留
workout-cli plan delete --plan 推拉腿 --yes --vault <V>
```

生成代码块（输出可直接粘进笔记；未知参数会被拦截而非静默失效）：

```bash
workout-cli block workout-log --param exercise=深蹲 --param day=7 --vault <V>
workout-cli block workout-plan --param plan=推拉腿 --vault <V>
```

## 注意事项

- `delete` 只加墓碑行；真正释放体积用 `compact`。
- 脚本在 Obsidian 之外直接写文件：批量操作时避免用户同时在 Obsidian 界面编辑记录。
- `doctor` 报表头过时或脏行时，让用户在 Obsidian 中打开一次插件即可自愈，不要自己修文件。
- 退出码：0 成功；1 数据/文件错误；2 用法错误。错误信息已含修正提示，照做即可。
