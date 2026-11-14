/*
 * muscleOptions.ts —— 「肌肉 / 肌群」参数的候选列表（纯函数，零 DOM）。
 *
 * 插入代码块时不该让人凭记忆拼肌肉名：拼错就是「找不到该肌肉」，而报错要等到渲染代码块才出现。
 * 这里给出可下拉选择的候选，且**匹配串包含解剖别名**——这样写 `股四头肌`（解剖名）
 * 也能筛到 `quads`（你库里叫「股四头」），因为解析端 resolveSubject 本来就支持这两种写法。
 *
 * 肌群只在「真正含 ≥2 块肌肉」时才进列表：本库多数群体只含一块肌肉，那时群名与单块名等价，
 * 列两遍反而让人以为是两个不同的东西。
 */

import { getMuscleName } from './display';
import { resolveSubject } from './recovery';
import { FITNESS_GROUPS, SVG_MUSCLE_CATALOG } from './svgMuscleCatalog';
import { WorkoutConfig } from './types';

/** 所属健身群（由该肌肉映射到的 SVG 区域反查；没映射则查不到）。 */
function groupOfMuscle(muscle: { svgRegionIds?: string[] }): { zh: string; en: string } | undefined {
  for (const regionId of muscle.svgRegionIds ?? []) {
    const entry = SVG_MUSCLE_CATALOG.find((e) => e.id === regionId);
    const group = entry && FITNESS_GROUPS.find((g) => g.key === entry.fitnessGroup);
    if (group) return { zh: group.zh, en: group.en };
  }
  return undefined;
}

export interface MuscleOption {
  /** 写进代码块的值（肌肉显示名 / 肌群名），解析端都认 */
  value: string;
  /** 下拉里显示的主文案 */
  label: string;
  /** 右侧小字：肌肉显示 id，肌群显示「N 块」 */
  hint?: string;
  /** 小写匹配串：名称 + id + 解剖别名 + 群名，供输入过滤 */
  haystack: string;
}

/** 收集候选：全部肌肉（带解剖别名）＋ 真正聚合的肌群。 */
export function collectMuscleOptions(config: WorkoutConfig): MuscleOption[] {
  const out: MuscleOption[] = [];

  for (const muscle of config.muscles ?? []) {
    const label = getMuscleName(muscle) || muscle.id;
    // 该肌肉映射到的 SVG 区域，其解剖中英文名都当别名（写「股四头肌」也能筛到）
    const aliases: string[] = [];
    for (const regionId of muscle.svgRegionIds ?? []) {
      const entry = SVG_MUSCLE_CATALOG.find((e) => e.id === regionId);
      if (entry) aliases.push(entry.zh, entry.en);
    }
    // 匹配串额外并入：所属群名（如 quads 属「股四头肌」群，写群名也能筛到它）
    // ＋ 通用词「肌肉 / 肌群」——只打「肌」或「肉」时应当给出全部候选，而不是空面板。
    const group = groupOfMuscle(muscle);
    out.push({
      value: label,
      label,
      hint: muscle.id,
      haystack: [label, muscle.id, muscle.name ?? '', group?.zh ?? '', group?.en ?? '', ...aliases, '肌肉 肌群']
        .join(' ')
        .toLowerCase(),
    });
  }

  for (const group of FITNESS_GROUPS) {
    const resolved = resolveSubject(config, group.zh);
    if (resolved.muscleIds.length < 2) continue; // 单块群的别名与那块肌肉重复，不单列
    out.push({
      value: group.zh,
      label: group.zh,
      hint: `${resolved.muscleIds.length} 块`,
      haystack: [group.zh, group.en, group.key].join(' ').toLowerCase(),
    });
  }

  return out;
}

/** 按输入过滤候选（空串＝全部）。 */
export function filterMuscleOptions(options: MuscleOption[], query: string): MuscleOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => o.haystack.includes(q));
}
