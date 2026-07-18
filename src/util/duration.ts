import { t } from '../i18n';

/*
 * duration.ts —— 时长工具
 * 训练时长在「存储」时统一用「秒」这个最小单位（一个整数），
 * 好处是不会出现 1.5 分、30.5 分这种带小数的分，计算/排序都简单。
 * 本文件负责两件事：
 *   1) formatDuration：把「秒」拆成 时/分/秒 文字（如 75 → "1分15秒"），用于界面显示。
 *   2) parseDuration / secondsToParts：把 时/分/秒 反向合回「秒」，或拆成对象。
 * 单位文字（时/分/秒）取自 i18n，所以会随语言变化（英文显示 h/m/s）。
 */

// 把秒数格式化成「时/分/秒」连写的文字，用于界面展示
export function formatDuration(seconds: number): string {
  // 非正数直接返回 "0秒"（或对应语言的秒）
  if (seconds <= 0) {
    return '0' + t('duration.second');
  }

  // 把总秒数拆成 时、分、秒 三个整数：1 小时=3600 秒，1 分=60 秒
  // 用取整除和取余得到各部分，例如 75 → 0时 1分 15秒
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  // parts 收集要显示的各段文字，最后拼到一起
  const parts: string[] = [];

  // 只有该部分大于 0 才显示，避免出现 "0时0分15秒"
  if (hours > 0) {
    parts.push(`${hours}${t('duration.hour')}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}${t('duration.minute')}`);
  }
  // 秒为 0 且前面已经有内容时（如正好 1 分钟整）就不显示 "0秒"；
  // 若前面什么都没有（parts 为空，说明不足 1 分），则至少显示秒，避免返回空串
  if (secs > 0 || parts.length === 0) {
    parts.push(`${secs}${t('duration.second')}`);
  }

  // 把各段拼成最终文字（中文直接连写，因为文案里已带单位字）
  return parts.join('');
}

// 反向操作：把 时/分/秒 三个数字合成「总秒数」，用于从表单输入转回存储格式
export function parseDuration(hours: number, minutes: number, seconds: number): number {
  return hours * 3600 + minutes * 60 + seconds;
}

// 把秒数拆成 {hours, minutes, seconds} 对象，方便表单回填（例如编辑时把存储的秒拆开填进输入框）
export function secondsToParts(seconds: number): { hours: number; minutes: number; seconds: number } {
  return {
    hours: Math.floor(seconds / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
}