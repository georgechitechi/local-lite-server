import { pathToFileURL } from 'node:url';
import { resolveProjectFile } from '../core/resolve.js';

export interface RuleContext {
  isAdmin: boolean;
  userId?: string;
}

export type RowPredicate = (
  ctx: RuleContext,
  row: Record<string, any>,
) => boolean | Promise<boolean>;

export type RulePreset =
  'authenticated' | 'owner' | `owner:${string}` | 'admin' | 'none';

export type RuleExpression = RowPredicate | RulePreset;

export interface TableRuleInput {
  read?: RuleExpression;
  write?: RuleExpression;
  delete?: RuleExpression;
}

export interface TableRule {
  read?: RowPredicate;
  write?: RowPredicate;
  delete?: RowPredicate;
}

export type RulesInputDictionary = Record<string, TableRuleInput | RulePreset>;
export type RulesDictionary = Record<string, TableRule>;

function compileRule(
  expr: RuleExpression | undefined,
): RowPredicate | undefined {
  if (!expr) return undefined;
  if (typeof expr === 'function') return expr;
  if (expr === 'authenticated')
    return (ctx) => ctx.isAdmin || Boolean(ctx.userId);
  if (expr === 'admin') return (ctx) => ctx.isAdmin;
  if (expr === 'none') return () => false;
  if (expr === 'owner') {
    return (ctx, row) =>
      ctx.isAdmin ||
      (Boolean(ctx.userId) &&
        (row.owner_id != null
          ? row.owner_id === ctx.userId
          : row.user_id === ctx.userId));
  }
  if (expr.startsWith('owner:')) {
    const col = expr.slice(6).trim();
    return (ctx, row) =>
      ctx.isAdmin || (Boolean(ctx.userId) && row[col] === ctx.userId);
  }
  throw new Error(`Unknown rule preset "${String(expr)}".`);
}

export function normalizeRules(input: RulesInputDictionary): RulesDictionary {
  const out: RulesDictionary = {};
  for (const [table, entry] of Object.entries(input)) {
    if (!entry) continue;
    if (typeof entry === 'string') {
      const fn = compileRule(entry);
      out[table] = { read: fn, write: fn, delete: fn };
    } else {
      out[table] = {
        read: compileRule(entry.read),
        write: compileRule(entry.write),
        delete: compileRule(entry.delete),
      };
    }
  }
  return out;
}

export function defineRules(rules: RulesInputDictionary): RulesDictionary {
  return normalizeRules(rules);
}

export function resolveRulesFile(
  explicit?: string,
  cwd = process.cwd(),
): string | null {
  return resolveProjectFile(
    explicit,
    'RULES_PATH',
    ['src/rules.ts', 'rules.ts'],
    cwd,
  );
}

export async function loadRulesFile(file: string): Promise<RulesDictionary> {
  const loaded = await import(pathToFileURL(file).href);
  const mod = loaded.default;
  if (!mod || typeof mod !== 'object' || Array.isArray(mod)) {
    throw new Error(
      `${file} must export default an object of { table: { read?, write?, delete? } }.`,
    );
  }
  return normalizeRules(mod as RulesInputDictionary);
}
