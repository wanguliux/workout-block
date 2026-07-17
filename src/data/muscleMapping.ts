import { Muscle, WorkoutConfig } from './types';
import { SVG_MUSCLE_CATALOG } from './svgMuscleCatalog';

// 默认 13 块肌肉各自归属的健身群 key（用于「默认」档自动映射）
export const MUSCLE_FITNESS_GROUP: Record<string, string> = {
  chest: 'chest',
  front_delt: 'shoulders',
  biceps: 'biceps',
  quads: 'quads',
  front_calf: 'calves',
  abs: 'abs',
  lats: 'back',
  traps: 'traps',
  rear_delt: 'shoulders',
  triceps: 'triceps',
  hamstrings: 'hamstrings',
  glutes: 'glutes',
  back_calf: 'calves',
};

// 「精简」档：每块肌肉只保留 1~2 条代表性主路径
export const MINIMAL_MAP: Record<string, string[]> = {
  chest: ['pectoralis_major_l', 'pectoralis_major_r'],
  front_delt: ['anterior_deltoid_l', 'anterior_deltoid_r'],
  biceps: ['biceps_brachii_caput_longum_l', 'biceps_brachii_caput_longum_r'],
  quads: ['vastus_lateralis_l', 'vastus_lateralis_r', 'rectus_femoris_l', 'rectus_femoris_r'],
  front_calf: ['tibialis_anterior_l', 'tibialis_anterior_r'],
  abs: ['rectus_abdominis_1', 'rectus_abdominis_2_l', 'rectus_abdominis_2_r'],
  lats: ['latissimus_dorsi_l', 'latissimus_dorsi_r'],
  traps: ['trapezius_upper_l', 'trapezius_upper_r'],
  rear_delt: ['posterior_deltoid_l', 'posterior_deltoid_r'],
  triceps: ['triceps_brachii_caput_longum_l', 'triceps_brachii_caput_longum_r'],
  hamstrings: ['biceps_femoris_l', 'biceps_femoris_r'],
  glutes: ['gluteus_maximus_l', 'gluteus_maximus_r'],
  back_calf: ['gastrocnemius_l', 'gastrocnemius_r'],
};

export type MappingTier = 'default' | 'minimal' | 'manual';

// 根据档位生成每块默认肌肉的 svgRegionIds
export function buildMappings(tier: MappingTier): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const muscleId of Object.keys(MUSCLE_FITNESS_GROUP)) {
    if (tier === 'manual') {
      result[muscleId] = [];
      continue;
    }
    if (tier === 'minimal') {
      result[muscleId] = [...(MINIMAL_MAP[muscleId] ?? [])];
      continue;
    }
    // default：取该肌所属健身群的全部路径。
    // 同一 id 可能同时出现在 front 和 back 两个 SVG 文件里（目录里就有两条记录），
    // 这里去重，避免热力图聚合时对同一路径重复累加 value 造成双倍计数。
    const group = MUSCLE_FITNESS_GROUP[muscleId];
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const entry of SVG_MUSCLE_CATALOG) {
      if (entry.fitnessGroup !== group) continue;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      ids.push(entry.id);
    }
    result[muscleId] = ids;
  }
  return result;
}

// 把某档映射直接写进配置（首次引导 / 重新套用预设用）
export function applyMappingTier(config: WorkoutConfig, tier: MappingTier): void {
  const mappings = buildMappings(tier);
  for (const muscle of config.muscles) {
    if (mappings[muscle.id]) {
      muscle.svgRegionIds = mappings[muscle.id];
    }
  }
}

// 读取某肌肉的 SVG 路径 id 集合（渲染层统一入口）
export function getSvgRegionIds(muscle: Muscle): string[] {
  return muscle.svgRegionIds ?? [];
}

// 由已映射路径的 side 派生肌肉 side（front / back / both）。
// 同一 id 在目录里可能同时存在 front 和 back 两条记录，故需用 some() 收集两侧：
// 只要该 id 在某一侧出现过，就认为该肌肉在该侧有覆盖。
export function deriveMuscleSide(muscle: Muscle): 'front' | 'back' | 'both' {
  const ids = getSvgRegionIds(muscle);
  const sides = new Set<'front' | 'back'>();
  for (const id of ids) {
    if (SVG_MUSCLE_CATALOG.some((e) => e.id === id && e.side === 'front')) sides.add('front');
    if (SVG_MUSCLE_CATALOG.some((e) => e.id === id && e.side === 'back')) sides.add('back');
  }
  if (sides.size === 1) {
    return sides.has('front') ? 'front' : 'back';
  }
  return 'both';
}
