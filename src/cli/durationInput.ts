/*
 * durationInput.ts —— 时长输入的多格式解析（输出统一为「秒」，与插件存储一致）。
 *
 * 支持的写法：
 *  - 纯数字：      "90"            → 90 秒
 *  - 中文单位：    "1小时30分20秒" / "30分" / "1分30秒"
 *  - 英文单位：    "1h30m20s" / "30m" / "90s"
 *  - 冒号：        "1:30:20"（时:分:秒）/ "30:20"（分:秒）
 *
 * 解析失败抛错并给出示例，错误信息由 CLI 原样呈现给用户/agent。
 */

import { CliError } from './errors';

const PURE_SECONDS_RE = /^\d+(\.\d+)?$/;
const UNIT_PART_RE = /(\d+(?:\.\d+)?)\s*(小时|h|时|分钟|分|m|秒|s)/gi;
const COLON_RE = /^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d))?$/;

export function parseDurationInput(raw: string): number {
  const s = raw.trim();
  if (s === '') throw new CliError('时长不能为空');

  // 纯数字 = 秒
  if (PURE_SECONDS_RE.test(s)) {
    return Math.round(parseFloat(s));
  }

  // 冒号格式：H:MM:SS 或 MM:SS
  const colon = COLON_RE.exec(s);
  if (colon) {
    if (colon[3] !== undefined) {
      return Math.round(Number(colon[1]) * 3600 + Number(colon[2]) * 60 + Number(colon[3]));
    }
    return Math.round(Number(colon[1]) * 60 + Number(colon[2]));
  }

  // 单位格式：把出现的所有「数字+单位」段累加（未识别的文字直接忽略）
  let total = 0;
  let matched = false;
  for (const m of s.matchAll(UNIT_PART_RE)) {
    matched = true;
    const value = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit === '小时' || unit === 'h' || unit === '时') total += value * 3600;
    else if (unit === '分钟' || unit === '分' || unit === 'm') total += value * 60;
    else total += value; // 秒 / s
  }
  if (matched) return Math.round(total);

  throw new CliError(`无法解析时长 "${raw}"。支持：90（秒）/ 1分30秒 / 1h30m / 1:30:20`);
}
