import { App, TFile } from 'obsidian';
import { WorkoutConfig, CONFIG_FILENAME } from './types';

import { DataManager } from './DataManager';
import { migrateConfig } from './configMigrate';
import { getDefaultConfig } from './seed';

/*
 * ConfigStore.ts —— 聚合配置（训练类型/训练项/肌肉）的数据层（vault 内 workout-config.json）。
 *
 * 配置文件也留在 vault 内，便于用户用 Dataview / 外部工具查询或备份。
 * 配置改动属低频操作，使用 vault.modify 整体写入即可（与记录 CSV 同套缓存安全 API）。
 */
export class ConfigStore {
  private dm: DataManager;   // 数据中枢，用于取设置与 App 实例
  private app: App;
  private cache: WorkoutConfig | null = null; // 内存缓存；null 表示尚未加载

  constructor(dm: DataManager) {
    this.dm = dm;
    this.app = dm.app;
  }

  // 配置文件路径（基于设置里的 configDirectory，空 = vault 根目录）
  private get path(): string {
    const dir = this.dm.getSettings().configDirectory || '';
    return dir ? `${dir}/${CONFIG_FILENAME}` : CONFIG_FILENAME;
  }

  // 读取配置文件文本：优先走 vault 缓存层，兜底走 adapter 直接读磁盘。
  // 与 CSVStore 同理：首次打开仓库时 fileMap 可能未就绪，getAbstractFileByPath 漏返回
  // 已存在的配置文件 → 误判为「无配置」→ 表格列定义/训练项缺失。adapter.read 兜底修复。
  // 文件确实不存在时返回 null。
  private async readFileContent(): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (file instanceof TFile) {
      return await this.app.vault.read(file);
    }
    try {
      return await this.app.vault.adapter.read(this.path);
    } catch {
      return null;
    }
  }

  // 确保配置已加载（带缓存）。首次无配置文件时用默认配置并落盘。
  // legacyConfig：来自旧版插件私有 data 的配置，仅在「vault 内尚无配置文件」时作为兜底导入。
  async ensureLoaded(legacyConfig?: WorkoutConfig): Promise<void> {
    if (this.cache) return;
    const content = await this.readFileContent();
    if (content !== null) {
      try {
        this.cache = this.migrate(JSON.parse(content) as WorkoutConfig);
      } catch {
        // 配置文件损坏：回退到默认（或 legacy）并覆盖写入，避免一直报错
        const fallback = legacyConfig ? this.migrate(legacyConfig) : this.migrate(getDefaultConfig());
        this.cache = fallback;
        await this.writeConfig(fallback);
      }
      return;
    }
    // vault 内无配置文件：优先用 legacy（旧版迁移），否则默认配置
    const initial = legacyConfig ? this.migrate(legacyConfig) : this.migrate(getDefaultConfig());
    this.cache = initial;
    await this.writeConfig(initial);
  }

  // 读取配置：有缓存直接返回，否则加载。
  async load(): Promise<WorkoutConfig> {
    await this.ensureLoaded();
    return this.cache!;
  }

  // 写入配置：更新缓存 + vault 文件。由 DataManager.saveConfig 在 selfWriting 期间调用。
  async save(config: WorkoutConfig): Promise<void> {
    this.cache = config;
    await this.writeConfig(config);
  }

  // 真正写盘：存在则改、否则建。
  private async writeConfig(config: WorkoutConfig): Promise<void> {
    const content = JSON.stringify(config, null, 2);
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
    } else {
      try {
        await this.app.vault.create(this.path, content);
      } catch (e: unknown) {
        if (String((e as Error)?.message ?? '').includes('File already exists')) {
          // 并发初始化竞态：文件已在，回退为 modify
          const existing = this.app.vault.getAbstractFileByPath(this.path);
          if (existing instanceof TFile) await this.app.vault.modify(existing, content);
        } else {
          throw e;
        }
      }
    }
  }

  // 清空缓存（配置被外部改动或路径变化时调用，迫使下次重新读取）。
  clearCache(): void {
    this.cache = null;
  }

  // 获取当前缓存（可能为 null）。
  getCache(): WorkoutConfig | null {
    return this.cache;
  }

  // 数据迁移(migrate)：实现收敛在纯模块 configMigrate（与 workout-block CLI 共用），
  // 补全缺失结构、幂等并入种子、迁移旧单位模型、补齐 nameKey，保证向后兼容。
  private migrate(config: WorkoutConfig): WorkoutConfig {
    return migrateConfig(config);
  }
}
