// 训练记录的主键生成器。
//
// 用 12 位 base36（0-9a-z）短随机 id 取代 crypto.randomUUID() 的 36 位 UUID。
// 理由：记录 id 仅是单机本地 CSV 的内部主键，不被其他记录引用、不对外暴露，
// 不需要 UUID「跨系统全局唯一」的强度；12 位 base36 有 36^12 ≈ 4.7e18 种组合，
// 对单用户本地数据碰撞概率可忽略。
//
// 字符集仅含 0-9a-z，天然规避 CSV 敏感字符（逗号 / 双引号 / 换行），可直接安全写入单元格。
// 仍使用 crypto.getRandomValues 保证密码学强度的随机性（与 randomUUID 同款 Crypto 全局对象）。

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

export function generateId(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < length; i++) {
    id += BASE36[bytes[i] % 36];
  }
  return id;
}
