import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface RuleContext {
  isAdmin: boolean;
  userId?: string;
}

export type RowPredicate = (
  ctx: RuleContext,
  row: Record<string, any>,
) => boolean | Promise<boolean>;

export interface TableRule {
  read?: RowPredicate;
  write?: RowPredicate;
}

export type RulesDictionary = Record<string, TableRule>;

export function defineRules<T extends RulesDictionary>(rules: T): T {
  return rules;
}

const CANDIDATES = [
  'src/rules.ts',
  'src/rules.mjs',
  'src/rules.js',
  'rules.ts',
  'rules.mjs',
  'rules.js',
];

export function resolveRulesFile(explicit?: string, cwd = process.cwd()): string | null {
  if (explicit) {
    const abs = path.resolve(cwd, explicit);
    if (!fs.existsSync(abs)) throw new Error(`RULES_PATH not found: ${abs}`);
    return abs;
  }
  for (const name of CANDIDATES) {
    const abs = path.resolve(cwd, name);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

export async function loadRulesFile(file: string): Promise<RulesDictionary> {
  const loaded = await import(pathToFileURL(file).href);
  const mod = loaded.default ?? loaded.rules ?? loaded;
  if (!mod || typeof mod !== 'object' || Array.isArray(mod)) {
    throw new Error(`${file} must export default an object of { table: { read?, write? } }.`);
  }
  return mod as RulesDictionary;
}
