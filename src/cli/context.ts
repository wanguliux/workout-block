import { LogRow, WorkoutConfig, PluginSettings } from '../data/types';
import { migrateConfig } from '../data/configMigrate';
import { getDefaultConfig } from '../data/seed';
import { parseCsvContent } from '../data/csvFormat';
import { setLocale } from '../i18n';
import { CliError, VaultIO } from './vault';

/*
 * context.ts —— 命令执行环境：一次性装载「设置 + 生效配置 + 存活记录」。
 *
 * 「生效配置」= 磁盘配置经 migrateConfig 归一后的内存视图，与插件加载后看到的
 * 完全一致（种子已并入、nameKey 已补齐）；读命令只读内存视图不落盘，
 * 写命令（plan complete）才把归一后的配置写回——与插件自身保存配置时的行为一致。
 * 配置文件不存在时使用默认配置（与插件 ensureLoaded 一致），configFound=false 供提示。
 */

export interface CliEnv {
  vault: VaultIO;
  settings: PluginSettings;
  settingsFound: boolean;
  config: WorkoutConfig;
  configFound: boolean;
  logs: LogRow[];
  deletedIds: string[];
  droppedRows: number;
  csvFound: boolean;
}

export async function loadEnv(
  vaultPath: string,
  opts?: { allowNonVault?: boolean }
): Promise<CliEnv> {
  const vault = new VaultIO(vaultPath);
  await vault.assertVault(opts);

  const { settings, settingsFound } = await vault.loadSettings();
  // 显示名/单位文案跟随插件语言设置（名称反查本身双语全匹配，不受此影响）
  setLocale(settings.language === 'en' ? 'en' : 'zh');

  // 配置：优先磁盘文件；缺失时用默认配置（不落盘）
  let config: WorkoutConfig;
  let configFound = false;
  const configText = await vault.readTextIfExists(vault.configPath(settings));
  if (configText !== null) {
    configFound = true;
    try {
      config = migrateConfig(JSON.parse(configText) as WorkoutConfig);
    } catch (e) {
      throw new CliError(
        `配置文件解析失败：${vault.configPath(settings)}（${(e as Error).message}）。` +
        '请先在 Obsidian 中打开插件让它自愈，或手动修复该 JSON。'
      );
    }
  } else {
    config = migrateConfig(getDefaultConfig());
  }

  // 记录：CSV 缺失视为空库
  let logs: LogRow[] = [];
  let deletedIds: string[] = [];
  let droppedRows = 0;
  let csvFound = false;
  const csvText = await vault.readTextIfExists(vault.csvPath(settings));
  if (csvText !== null) {
    csvFound = true;
    const parsed = parseCsvContent(csvText);
    logs = parsed.rows;
    deletedIds = parsed.deletedIds;
    droppedRows = parsed.dropped;
  }

  return { vault, settings, settingsFound, config, configFound, logs, deletedIds, droppedRows, csvFound };
}

/** 现有记录 id + 已软删除 id 的全集（新记录 id 需避开两者）。 */
export function takenIds(env: CliEnv): Set<string> {
  return new Set([...env.logs.map((r) => r.id), ...env.deletedIds]);
}
