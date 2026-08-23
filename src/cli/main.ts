import './polyfill';
import { parseArgs, UsageError } from './args';
import { loadEnv } from './context';
import { CliError } from './vault';
import { cmdLocate, cmdConfig, cmdResolve } from './commands/configCmd';
import { cmdAdd, cmdList, cmdDelete, cmdCompact } from './commands/recordCmd';
import { cmdStats } from './commands/statsCmd';
import { cmdPlan } from './commands/planCmd';
import { cmdBlock } from './commands/blockCmd';
import { cmdDoctor } from './commands/doctorCmd';
import { cmdCapabilities, cmdQuery } from './commands/decisionCmd';

/*
 * main.ts —— workout-block CLI 入口。
 *
 * 退出码约定：0 成功；1 运行时错误（数据/文件问题）；2 用法错误（参数不对）。
 * 全部命令都需要 --vault <Obsidian仓库根目录>（或环境变量 WORKOUT_VAULT）。
 */

const HELP = `workout-block CLI —— 在 Obsidian 之外安全读写 workout-block 插件数据

用法：
  workout-cli <命令> --vault <仓库根目录> [选项]
  （也可用环境变量 WORKOUT_VAULT 代替 --vault）

定位与体检：
  locate                          显示数据文件定位（设置/CSV/配置路径、单位、语言）
  doctor                          数据体检（只读）：表头/脏行/重复 id/墓碑统计

查询配置：
  config exercises|types|stats|plans|muscles
  resolve <训练项名称或id>         中文名/英文名/id 反查训练项（录入前建议先跑）

写入配置（训练项/训练类型/肌肉/统计 的增改删，级联规则与插件一致）：
  config add-exercise --name <名> --category <类型> [--id ...] [--muscle <肌肉id>:primary|secondary ...]
  config update-exercise --exercise <名或id> [--new-id ...] [--name ...] [--category ...]
                         [--muscle ...（整体替换）] [--clear-muscles]
  config delete-exercise --exercise <名或id> --yes    （级联软删其全部记录）
  config add-type --name <名> --fields-json '[{"key":"weight","inputType":"number","mass":true,"required":true}]'
  config update-type --type <名或id> [--new-id ...] [--name ...] [--fields-json ...]
                     （改 id 级联改写记录 category/训练项/统计关联）
  config delete-type --type <名或id> --yes
  config add-muscle --name <名> [--coverage true|false] [--rest-days N] [--svg-ids a,b]
  config update-muscle --muscle <id> [--name ...] [--coverage ...] [--rest-days ...] [--svg-ids ...]
  config delete-muscle --muscle <id> --yes
  config add-stat --name <名> --types <类型,...> --builder count|sum:<字段>|productSum:<a>,<b>|oneRepMax:<重量>,<次数> | --expr "sum(reps*weight)"
  config update-stat --stat <名或id> [--name/--types/--builder/--expr/--granularity/--enabled/--unit ...]
  config delete-stat --stat <名或id> --yes

训练记录：
  add --exercise <名称或id> [key=value ...] [--field key=value]
      [--time "YYYY-MM-DD HH:mm"] [--sets N] [--note 文字] [--plan 计划名] [--no-ask]
      （交互终端下，若必填字段未提供会逐个询问；--no-ask 可关闭询问、缺失必填直接报错）
  list [--exercise <名>] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
       [--last N] [--limit N] [--all]
  delete --id <记录id>             软删除（追加墓碑，与插件删除同语义）
  compact                          压缩清理 CSV（清除墓碑与已删行）

统计：
  stats [--stat <名称或id>] [--exercise <名>] [--from ...] [--to ...]
        [--group date|week|none]

决策中心协议（P0 查询合约）：
  capabilities                    能力清单（静态，免 --vault）
  query --dimension <id> [--mode summary|records]
        [--filters '<json>'] [--page N] [--pageSize N]
                                  执行查询（--vault 直读数据；--json 输出机器可读 JSON）

训练计划：
  plan list
  plan show --plan <名称或id>      查看每组 set id 与完成状态
  plan complete --plan <名称或id> --exercise <名> --set <组id> [--date YYYY-MM-DD]
  plan add --name <计划名> [--date YYYY-MM-DD | --weekdays 1,3,5]
           [--source-note <方案笔记名> | --items-json '[{"exerciseId":"squat","sets":[{"fields":{"weight":60}}]}]']
  plan update --plan <名称或id> [--new-name ...] [--date | --weekdays ...] [--items-json ...]
              （改名会级联改写 vault 内 workout-plan 代码块）
  plan delete --plan <名称或id> --yes

代码块生成（输出可直接粘进笔记的代码块文本）：
  block <workout-log|workout-day|workout-heatmap|workout-plan> [--param key=value ...]

通用：
  --json    机器可读输出（add/list/stats/plan/config/locate/doctor 均支持）
  --yes     删除类危险操作的显式确认（未加时只给影响预览、不动数据）
  --force   跳过「--vault 必须是真实 Obsidian 仓库」校验（仅测试/高级场景）

注意：
  - 所有命令都会校验 --vault 指向真实 Obsidian 仓库（含 .obsidian 目录），
    指向错误位置（如插件源码目录）会直接报错而非静默写入；
  - 质量字段（如 weight）按插件设置的单位解析输入，统一以 kg 存储；
  - 时长字段（如 duration_sec）支持 90 / 1分30秒 / 1h30m / 1:30:20；
  - 写入后 Obsidian 内的插件会自动重载并刷新代码块渲染；
  - 避免在 Obsidian 正在编辑记录的同一时刻批量写入。
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return;
  }

  const args = parseArgs(argv.slice(1), {
    flags: ['json', 'all', 'yes', 'clear-muscles', 'no-ask', 'force'],
    repeated: ['field', 'param', 'muscle'],
  });

  // capabilities 是静态能力声明，无需读取 vault，提前处理（AI 免 --vault 也能发现能力）。
  if (command === 'capabilities') {
    cmdCapabilities();
    return;
  }

  const vaultPath = args.options['vault'] || process.env['WORKOUT_VAULT'] || '';
  if (!vaultPath) {
    throw new UsageError('缺少 vault 定位：请加 --vault <仓库根目录> 或设置环境变量 WORKOUT_VAULT');
  }

  // locate/doctor 等命令允许配置文件缺失，loadEnv 已内置兜底；
  // .obsidian 仓库校验默认开启（防误写），--force 可显式跳过（测试/高级场景）
  const env = await loadEnv(vaultPath, { allowNonVault: args.flags.has('force') });

  switch (command) {
    case 'locate': return cmdLocate(env, args);
    case 'config': return cmdConfig(env, args);
    case 'resolve': return cmdResolve(env, args);
    case 'add': return cmdAdd(env, args);
    case 'list': return cmdList(env, args);
    case 'delete': return cmdDelete(env, args);
    case 'compact': return cmdCompact(env, args);
    case 'stats': return cmdStats(env, args);
    case 'plan': return cmdPlan(env, args);
    case 'block': return cmdBlock(env, args);
    case 'doctor': return cmdDoctor(env, args);
    case 'query': return cmdQuery(env, args);
    default:
      throw new UsageError(`未知命令 "${command}"。运行 workout-cli help 查看全部命令。`);
  }
}

main().catch((e: unknown) => {
  if (e instanceof UsageError) {
    process.stderr.write(`用法错误：${e.message}\n`);
    process.exit(2);
  }
  if (e instanceof CliError) {
    process.stderr.write(`错误：${e.message}\n`);
    process.exit(1);
  }
  process.stderr.write(`未预期的错误：${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
