import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SqlExecutor } from 'local-lite/server';
import {
  buildSqlTargetSchema,
  generateSqlDiff,
  type SchemaDictionary,
  type SchemaFieldType,
  type SqlSchemaState,
} from 'local-lite/schema/migrations';

export type { SchemaDictionary, SchemaFieldType };

/** Identity helper for typed `schema.ts` files. */
export function defineSchema<T extends SchemaDictionary>(schema: T): T {
  return schema;
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Validates names and guarantees an `id` column on every table. */
export function normalizeSchema(input: SchemaDictionary): SchemaDictionary {
  const out: SchemaDictionary = {};
  for (const [table, fields] of Object.entries(input)) {
    if (!NAME_RE.test(table) || table.startsWith('_')) {
      throw new Error(`Invalid table name "${table}" in schema (letters, digits, _; must not start with _).`);
    }
    const cols: Record<string, SchemaFieldType> = { id: 'string' };
    for (const [col, type] of Object.entries(fields)) {
      if (!NAME_RE.test(col)) throw new Error(`Invalid column name "${table}.${col}" in schema.`);
      cols[col] = type;
    }
    cols.id = 'string';
    out[table] = cols;
  }
  return out;
}

const CANDIDATES = ['schema.ts', 'schema.mjs', 'schema.js', 'schema.json'];

export function resolveSchemaFile(explicit?: string, cwd = process.cwd()): string {
  if (explicit) {
    const abs = path.resolve(cwd, explicit);
    if (!fs.existsSync(abs)) throw new Error(`SCHEMA_PATH not found: ${abs}`);
    return abs;
  }
  for (const name of CANDIDATES) {
    const abs = path.resolve(cwd, name);
    if (fs.existsSync(abs)) return abs;
  }
  throw new Error(
    `No schema file found. Create schema.ts next to your .env (or set SCHEMA_PATH):\n` +
      `  export default { notes: { id: 'string', title: 'string', body: 'string | null' } };`,
  );
}

export async function loadSchemaFile(file: string): Promise<SchemaDictionary> {
  let mod: unknown;
  if (file.endsWith('.json')) {
    mod = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    const loaded = await import(pathToFileURL(file).href);
    mod = loaded.default ?? loaded.schema ?? loaded;
  }
  if (!mod || typeof mod !== 'object' || Array.isArray(mod)) {
    throw new Error(`${file} must export default an object of { table: { column: type } }.`);
  }
  return normalizeSchema(mod as SchemaDictionary);
}

export interface SchemaPlan {
  up: string[];
  warnings: string[];
  next: SqlSchemaState;
  first: boolean;
}

export async function planSchema(
  db: SqlExecutor,
  dictionary: SchemaDictionary,
): Promise<SchemaPlan> {
  const dialect = db.dialect;
  const rows = await db.query<{ state: string }>(
    'SELECT state FROM _lls_schema_state WHERE id = 1',
  );
  const prev: SqlSchemaState | null = rows[0]?.state ? JSON.parse(rows[0].state) : null;
  const next = buildSqlTargetSchema(dictionary, [], { dialect });
  const diff = generateSqlDiff(prev, next, dialect);
  return { up: diff.up, warnings: diff.warnings, next, first: prev === null };
}

/** Applies the schema diff and records the new state. Safe to call on every boot. */
export async function applySchema(
  db: SqlExecutor,
  dictionary: SchemaDictionary,
): Promise<SchemaPlan> {
  const plan = await planSchema(db, dictionary);
  for (const stmt of plan.up) await db.execute(stmt);
  if (plan.up.length > 0 || plan.first) {
    await db.execute('DELETE FROM _lls_schema_state WHERE id = 1');
    await db.execute('INSERT INTO _lls_schema_state (id, state) VALUES (1, ?)', [
      JSON.stringify(plan.next),
    ]);
  }
  return plan;
}
