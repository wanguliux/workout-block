/*
 * errors.ts —— CLI 的错误类型（供 vault/core/commands 共用）。
 * CliError = 可预期的业务错误（数据校验、文件缺失等）：只打印 message，退出码 1。
 * UsageError（见 args.ts）= 用法错误：退出码 2。
 */

export class CliError extends Error {}
