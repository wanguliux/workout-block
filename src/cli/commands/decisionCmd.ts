import { getToolCapability } from '../../decision/capability';
import { executeQuery } from '../../decision/queryHandler';
import type { QueryRequest } from '../../decision/types';
import { ParsedArgs, UsageError, requireOption } from '../args';
import { CliEnv } from '../context';
import { printJson, renderTable } from '../output';

/*
 * decisionCmd.ts —— CLI 的决策中心协议子命令。
 *   capabilities：静态能力声明（无需 vault，见 cli/main.ts 提前处理）
 *   query：加载 vault 后执行 P0 查询（--dimension / --mode / --filters / --page / --pageSize）
 */

/** 输出 P0 ToolCapability（静态声明，JSON）。 */
export function cmdCapabilities(): void {
  printJson({ ok: true, data: getToolCapability() });
}

/** 执行 P0 查询：--dimension 必填，--mode 默认 summary，--filters 为 JSON 字符串。 */
export async function cmdQuery(env: CliEnv, args: ParsedArgs): Promise<void> {
  const dimension = requireOption(args, 'dimension', 'query --dimension <id> --mode <summary|records> --filters \'<json>\'');
  const mode = (args.options['mode'] ?? 'summary') as 'summary' | 'records';
  if (mode !== 'summary' && mode !== 'records') {
    throw new UsageError('--mode 只支持 summary / records');
  }

  let filters: Record<string, unknown> = {};
  if (args.options['filters']) {
    try {
      const parsed = JSON.parse(args.options['filters']) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('not-object');
      }
      filters = parsed as Record<string, unknown>;
    } catch {
      throw new UsageError('--filters 必须是合法 JSON 对象（如 \'{"preset":"30d"}\'）');
    }
  }

  const pagination =
    args.options['page'] || args.options['pageSize']
      ? { page: parseInt(args.options['page'] ?? '1', 10), pageSize: parseInt(args.options['pageSize'] ?? '50', 10) }
      : undefined;

  const request: QueryRequest = { pluginId: 'workout-block', dimension, mode, filters, pagination };
  const response = executeQuery(request, { records: env.logs, config: env.config });

  if (args.flags.has('json')) {
    printJson(response);
    return;
  }

  if (response.error) {
    process.stderr.write(`查询失败：${response.error}\n`);
    process.exitCode = 1;
    return;
  }

  if (mode === 'records') {
    const recs = (response.data as { records: Record<string, unknown>[] }).records;
    if (recs.length === 0) {
      console.log('（无匹配记录）');
      return;
    }
    const headers = Object.keys(recs[0]);
    console.log(renderTable(headers, recs.map((r) => headers.map((h) => (r[h] == null ? '' : String(r[h]))))));
    console.log(`共 ${response.total ?? recs.length} 条，第 ${pagination?.page ?? 1} 页`);
    return;
  }

  const entries = (response.data as { entries?: { key: string; value: number; unit?: string }[] }).entries ?? [];
  if (entries.length === 0) {
    console.log('（无数据）');
    return;
  }
  console.log(renderTable(['指标', '值'], entries.map((e) => [e.key, `${e.value}${e.unit ? ` ${e.unit}` : ''}`])));
}
