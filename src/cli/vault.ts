import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PluginSettings, DEFAULT_SETTINGS, CSV_FILENAME, CONFIG_FILENAME } from '../data/types';
import { CSV_HEADER } from '../data/csvFormat';
import { CliError } from './errors';

// 兼容既有导入路径（commands 多从 './vault' 引 CliError）
export { CliError } from './errors';

/*
 * vault.ts —— CLI 的 vault 文件 I/O 层（Node fs 实现，替代插件里的 Obsidian vault API）。
 *
 * 与插件语义对齐的要点：
 *  - 数据文件定位：先读 .obsidian/plugins/workout-block/data.json（插件私有设置，
 *    含 csvDirectory/configDirectory 与 unit/language），并套用与
 *    DataManager.applySettingsMigration 相同的旧字段名兼容映射；
 *  - 追加写：文件不存在时先落表头（等价 CSVStore.appendRow 的首建分支）；
 *  - 整文件写：写临时文件再 rename（原子替换），把与 Obsidian 并发写盘的窗口压到最小。
 */

const PLUGIN_ID = 'workout-block';


export class VaultIO {
  constructor(public readonly vaultPath: string) {}

  /** 插件私有设置文件（data.json）的绝对路径。 */
  get settingsPath(): string {
    return path.join(this.vaultPath, '.obsidian', 'plugins', PLUGIN_ID, 'data.json');
  }

  /** 训练记录 CSV 的绝对路径（目录取自设置 csvDirectory，空 = vault 根）。 */
  csvPath(settings: PluginSettings): string {
    const dir = settings.csvDirectory || '';
    return path.join(this.vaultPath, dir, CSV_FILENAME);
  }

  /** 配置 JSON 的绝对路径（目录取自设置 configDirectory，空 = vault 根）。 */
  configPath(settings: PluginSettings): string {
    const dir = settings.configDirectory || '';
    return path.join(this.vaultPath, dir, CONFIG_FILENAME);
  }

  /**
   * vault 根目录必须存在、是目录、且是真实 Obsidian 仓库（含 .obsidian 目录），
   * 否则提前给出明确错误，避免把训练数据静默写到错误位置（如插件源码目录）。
   * allowNonVault=true 时跳过 .obsidian 校验（仅用于测试 / 显式 --force 高级场景）。
   */
  async assertVault(opts?: { allowNonVault?: boolean }): Promise<void> {
    let stat;
    try {
      stat = await fs.stat(this.vaultPath);
    } catch {
      throw new CliError(
        `找不到 vault 目录：${this.vaultPath}\n` +
        `（请用 --vault 指定 Obsidian 仓库根目录，即包含 .obsidian 文件夹的那个文件夹）`
      );
    }
    if (!stat.isDirectory()) {
      throw new CliError(`--vault 指向的不是目录：${this.vaultPath}`);
    }
    if (opts?.allowNonVault) return;

    const obsidianDir = path.join(this.vaultPath, '.obsidian');
    let obsStat: Awaited<ReturnType<typeof fs.stat>> | null = null;
    try {
      obsStat = await fs.stat(obsidianDir);
    } catch {
      obsStat = null;
    }
    if (!obsStat || !obsStat.isDirectory()) {
      throw new CliError(
        `--vault 指向的不是 Obsidian 仓库：${this.vaultPath}\n` +
        `（未找到 .obsidian 目录。请使用 Obsidian 仓库根目录——即包含 .obsidian 文件夹的那个文件夹。\n` +
        ` 若确定要把数据写到此目录，可加 --force 跳过仓库校验。）`
      );
    }
  }

  /**
   * 读取插件设置。文件不存在时返回默认设置（settingsFound=false）；
   * JSON 损坏时抛错（不静默——读错目录配置会把数据写到错误位置）。
   * 套用与 DataManager.applySettingsMigration 一致的旧字段兼容映射。
   */
  async loadSettings(): Promise<{ settings: PluginSettings; settingsFound: boolean }> {
    const text = await this.readTextIfExists(this.settingsPath);
    if (text === null) {
      return { settings: { ...DEFAULT_SETTINGS }, settingsFound: false };
    }
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new CliError(`插件设置文件损坏（JSON 解析失败）：${this.settingsPath}`);
    }
    const settings: PluginSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<PluginSettings>) };
    // 与 DataManager.applySettingsMigration 同款旧字段映射（dataDirectory/csvPath/configPath）
    if (typeof raw['dataDirectory'] === 'string' && raw['dataDirectory']) {
      if (!settings.csvDirectory) settings.csvDirectory = raw['dataDirectory'];
      if (!settings.configDirectory) settings.configDirectory = raw['dataDirectory'];
    }
    if (typeof raw['csvPath'] === 'string' && raw['csvPath']) {
      const parts = raw['csvPath'].split('/');
      parts.pop();
      if (!settings.csvDirectory) settings.csvDirectory = parts.join('/');
    }
    if (typeof raw['configPath'] === 'string' && raw['configPath']) {
      const parts = raw['configPath'].split('/');
      parts.pop();
      if (!settings.configDirectory) settings.configDirectory = parts.join('/');
    }
    return { settings, settingsFound: true };
  }

  /** 读文本；文件不存在返回 null。 */
  async readTextIfExists(absPath: string): Promise<string | null> {
    try {
      return await fs.readFile(absPath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  /**
   * 追加 CSV 行（一次写入多行，行间 \n，末尾补 \n）。
   * 文件不存在时先写表头（与 CSVStore.appendRow 首建分支等价）；
   * 已存在时剥掉末尾空白后追加，避免空行堆积。
   */
  async appendCsvLines(absPath: string, lines: string): Promise<void> {
    const existing = await this.readTextIfExists(absPath);
    let next: string;
    if (existing === null) {
      next = CSV_HEADER + '\n' + lines + '\n';
    } else {
      next = existing.replace(/\s+$/, '') + '\n' + lines + '\n';
    }
    await this.writeAtomic(absPath, next);
  }

  /** 整文件原子写：写同目录临时文件后 rename 覆盖（压缩与配置写盘共用）。 */
  async writeAtomic(absPath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const tmp = path.join(
      path.dirname(absPath),
      `.${path.basename(absPath)}.${process.pid}.tmp`
    );
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, absPath);
  }
}
