import { LogRow, WorkoutConfig, StatDef, StatAggregation } from './types';

/*
 * statExpr.ts —— 数据统计功能的「受限表达式引擎」。
 *
 * 安全底线：彻底禁用 eval / new Function，手写「词法 + 递归下降语法分析」，
 * 把表达式解析成 AST 后解释执行。函数白名单仅 sum/avg/max/min/count；
 * 操作数只能是已授权字段(key)，支持 + - * / 四则运算与括号嵌套。
 *
 * 语义约定：一条统计(stat)在最外层必须是一个「聚合函数调用」，
 * 其参数为「针对单条记录」的表达式（字段引用的四则组合）。
 * 计算时：对每条记录求参数值，再由聚合函数跨记录汇总。
 *   例：sum(reps * weight) = 对每条记录算 次数×重量 后求和 = 训练量。
 *
 * 时长字段（duration）：底层存的是秒数(number)，表达式按字段 key 引用，
 * 引擎直接对原始数值（秒）运算；可读性(如「1分30秒」)由展示层负责，不参与计算。
 */

// ===== AST 节点 =====
type Node =
  | { type: 'num'; value: number }
  | { type: 'field'; name: string }
  | { type: 'binop'; op: '+' | '-' | '*' | '/'; left: Node; right: Node }
  | { type: 'func'; name: string; args: Node[] };

const FUNCS = new Set(['sum', 'avg', 'max', 'min', 'count']);

// ===== 词法分析（Tokenizer）=====
type Tok =
  | { t: 'num'; v: number }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' }
  | { t: 'lparen' }
  | { t: 'rparen' }
  | { t: 'comma' }
  | { t: 'eof' };

function tokenize(input: string): Tok[] {
  const toks: Tok[] = [];
  const s = input;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    // 跳过空白
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    // 数字（十进制，允许一个小数点）
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const num = Number(s.slice(i, j));
      if (Number.isNaN(num)) throw new Error('非法数字');
      toks.push({ t: 'num', v: num });
      i = j;
      continue;
    }
    // 标识符（字段 key / 函数名）：字母或下划线开头，后续可含字母数字下划线
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
      toks.push({ t: 'ident', v: s.slice(i, j) });
      i = j;
      continue;
    }
    // 运算符 / 括号 / 逗号
    if (c === '+' || c === '-' || c === '*' || c === '/') { toks.push({ t: 'op', v: c }); i++; continue; }
    if (c === '(') { toks.push({ t: 'lparen' }); i++; continue; }
    if (c === ')') { toks.push({ t: 'rparen' }); i++; continue; }
    if (c === ',') { toks.push({ t: 'comma' }); i++; continue; }
    throw new Error(`非法字符：${c}`);
  }
  toks.push({ t: 'eof' });
  return toks;
}

// ===== 递归下降语法分析（Parser）=====
class Parser {
  private toks: Tok[];
  private pos = 0;
  constructor(toks: Tok[]) { this.toks = toks; }
  private peek(): Tok { return this.toks[this.pos]; }
  private next(): Tok { return this.toks[this.pos++]; }
  private expectRparen(): void {
    if (this.next().t !== 'rparen') throw new Error('缺少右括号 ")"');
  }

  parse(): Node {
    const node = this.parseExpr();
    if (this.peek().t !== 'eof') throw new Error('表达式存在多余内容');
    return node;
  }

  private parseExpr(): Node {
    let left = this.parseTerm();
    let tk = this.peek();
    while (tk.t === 'op' && (tk.v === '+' || tk.v === '-')) {
      const op = (this.next() as Extract<Tok, { t: 'op' }>).v;
      left = { type: 'binop', op, left, right: this.parseTerm() };
      tk = this.peek();
    }
    return left;
  }

  private parseTerm(): Node {
    let left = this.parseFactor();
    let tk = this.peek();
    while (tk.t === 'op' && (tk.v === '*' || tk.v === '/')) {
      const op = (this.next() as Extract<Tok, { t: 'op' }>).v;
      left = { type: 'binop', op, left, right: this.parseFactor() };
      tk = this.peek();
    }
    return left;
  }

  private parseFactor(): Node {
    const t = this.peek();
    if (t.t === 'num') { this.next(); return { type: 'num', value: t.v }; }
    if (t.t === 'lparen') {
      this.next();
      const e = this.parseExpr();
      this.expectRparen();
      return e;
    }
    if (t.t === 'ident') {
      // 标识符后紧跟 '(' 视为函数调用，否则视为字段引用
      const ahead = this.toks[this.pos + 1];
      if (ahead && ahead.t === 'lparen') return this.parseFunc();
      this.next();
      return { type: 'field', name: t.v };
    }
    throw new Error('表达式不完整或存在非法符号');
  }

  private parseFunc(): Node {
    const nameTok = this.next();
    if (nameTok.t !== 'ident') throw new Error('函数名非法');
    const name = nameTok.v;
    if (!FUNCS.has(name)) throw new Error(`未知函数：${name}（仅支持 sum/avg/max/min/count）`);
    if (this.next().t !== 'lparen') throw new Error(`函数 ${name} 缺少左括号`);
    const args: Node[] = [];
    if (this.peek().t !== 'rparen') {
      args.push(this.parseExpr());
      while (this.peek().t === 'comma') {
        this.next();
        args.push(this.parseExpr());
      }
    }
    this.expectRparen();
    return { type: 'func', name, args };
  }
}

// ===== 结构校验（最外层必须是单聚合函数，且不能嵌套）=====
function validateStructure(ast: Node): void {
  if (ast.type !== 'func') {
    throw new Error('表达式必须是一个聚合函数调用（如 sum(...)）');
  }
  const f = ast as Extract<Node, { type: 'func' }>;
  if (f.name === 'count') {
    if (f.args.length !== 0) throw new Error('count() 不接受参数');
  } else {
    if (f.args.length !== 1) throw new Error(`${f.name}() 需要 1 个参数`);
    if (f.args[0].type === 'func') throw new Error('聚合函数不能嵌套');
  }
}

// 收集表达式中引用的字段名（递归遍历，顺带拒绝嵌套函数）
function collectFields(node: Node, out: Set<string>): void {
  switch (node.type) {
    case 'field':
      out.add(node.name);
      break;
    case 'num':
      break;
    case 'binop':
      collectFields(node.left, out);
      collectFields(node.right, out);
      break;
    case 'func':
      for (const a of node.args) {
        if (a.type === 'func') throw new Error('聚合函数不能嵌套');
        collectFields(a, out);
      }
      break;
  }
}

// ===== 对外：校验表达式 =====
export function validateExpression(expr: string, allowedFields: string[]): void {
  const ast = new Parser(tokenize(expr)).parse();
  validateStructure(ast);
  const fields = new Set<string>();
  collectFields(ast, fields);
  const allowed = new Set(allowedFields);
  for (const f of fields) {
    if (!allowed.has(f)) {
      throw new Error(`字段 "${f}" 不在可用字段范围内（请检查关联的训练类型）`);
    }
  }
}

// ===== 对外：计算某分组的统计值 =====
// 对每条记录求「聚合函数参数」的值，再由聚合函数跨记录汇总。
function evalNode(node: Node, record: LogRow): number {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'field': {
      const raw = record.fields[node.name];
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isNaN(n) ? 0 : n; // 缺失/非法字段视为 0
    }
    case 'binop': {
      const l = evalNode(node.left, record);
      const r = evalNode(node.right, record);
      switch (node.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return r === 0 ? 0 : l / r; // 除零保护
      }
    }
    case 'func':
      throw new Error('聚合函数不能嵌套'); // 理论上不会到达
  }
  throw new Error('表达式无效');
}

export function computeStat(stat: StatDef, records: LogRow[]): number {
  // 解析表达式：builder 模式先转成表达式字符串
  const expr = stat.formula.mode === 'builder'
    ? builderToExpr(stat.formula.builder)
    : (stat.formula.expression ?? '');

  let ast: Node;
  try {
    ast = new Parser(tokenize(expr)).parse();
  } catch {
    return NaN; // 表达式非法：渲染时兜底，不崩
  }
  if (ast.type !== 'func') return NaN;
  const f = ast as Extract<Node, { type: 'func' }>;

  // count：记录条数
  if (f.name === 'count') {
    return records.length;
  }

  // 其余：先对每条记录求值，再聚合
  const values: number[] = [];
  for (const rec of records) {
    try {
      values.push(evalNode(f.args[0], rec));
    } catch {
      values.push(0);
    }
  }

  let result: number;
  switch (f.name) {
    case 'sum':
      result = values.reduce((a, b) => a + b, 0);
      break;
    case 'avg':
      result = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      break;
    case 'max':
      result = values.length ? Math.max(...values) : 0;
      break;
    case 'min':
      result = values.length ? Math.min(...values) : 0;
      break;
    default:
      result = NaN;
  }
  if (!Number.isFinite(result)) return 0;
  // 防浮点噪声
  return Math.round(result * 100) / 100;
}

// 把统计值规整成展示字符串（纯数字，不附加任何单位）；非法值显示 "-"。
export function formatStatValue(n: number): string {
  if (Number.isNaN(n)) return '-';
  return String(Math.round(n * 100) / 100);
}

// ===== 引导式 ↔ 表达式 双向转换 =====
export function builderToExpr(b?: StatAggregation): string {
  if (!b) return '';
  switch (b.kind) {
    case 'sum': return `sum(${b.field})`;
    case 'productSum': return `sum(${b.fieldA} * ${b.fieldB})`;
    case 'oneRepMax': return `max(${b.weightField} * (1 + ${b.repsField} / 30))`;
    case 'count': return 'count()';
    case 'avg': return `avg(${b.field})`;
    case 'max': return `max(${b.field})`;
    case 'min': return `min(${b.field})`;
  }
}

// 表达式 → 引导式（尽力而为）：匹配四种形状则回填 builder；否则返回 null（保留 expression 模式）。
export function exprToBuilder(expr: string): StatAggregation | null {
  let ast: Node;
  try {
    ast = new Parser(tokenize(expr)).parse();
  } catch {
    return null;
  }
  if (ast.type !== 'func') return null;
  const f = ast as Extract<Node, { type: 'func' }>;

  if (f.name === 'count' && f.args.length === 0) return { kind: 'count' };
  if (f.args.length !== 1) return null;
  const arg = f.args[0];

  // sum(field) / avg|max|min(field)
  if (arg.type === 'field') {
    if (f.name === 'sum') return { kind: 'sum', field: arg.name };
    if (f.name === 'avg' || f.name === 'max' || f.name === 'min') {
      return { kind: f.name, field: arg.name };
    }
    return null;
  }

  // sum(fieldA * fieldB) → productSum
  if (f.name === 'sum' && arg.type === 'binop' && arg.op === '*' &&
      arg.left.type === 'field' && arg.right.type === 'field') {
    return { kind: 'productSum', fieldA: arg.left.name, fieldB: arg.right.name };
  }
  return null;
}

// ===== 关联类型的字段「交集」=====
// 编辑公式时，可选字段 = 所有 associatedTypes 对应训练类型的 fields 之交集。
// 保证公式引用的字段在每个关联类型里都有效（多类型共享字段，如「时长」）。
export function allowedStatFields(stat: StatDef, config: WorkoutConfig): string[] {
  const typeFields = stat.associatedTypes
    .map((id) => config.trainingTypes.find((t) => t.id === id)?.fields ?? [])
    .filter((f) => f.length > 0);
  if (typeFields.length === 0) return [];
  // 以第一个类型的字段为基准，保留「在每个其他类型里都存在」的 key
  return typeFields[0]
    .filter((f) => typeFields.slice(1).every((fields) => fields.some((x) => x.key === f.key)))
    .map((f) => f.key);
}
