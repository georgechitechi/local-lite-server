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
import { resolveProjectFile } from './core/resolve.js';

export type { SchemaDictionary, SchemaFieldType };

/** Identity helper for typed `schema.ts` files. */
export function defineSchema<T extends SchemaDictionary>(schema: T): T {
  return schema;
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const VALID_TYPES = new Set<string>([
  'string', 'string | null',
  'number', 'number | null',
  'boolean', 'boolean | null',
  'json', 'json | null',
  'string[]', 'string[] | null',
]);

/** Validates names, field types, and guarantees an `id` column on every table. */
export function normalizeSchema(input: SchemaDictionary): SchemaDictionary {
  const out: SchemaDictionary = {};
  for (const [table, fields] of Object.entries(input)) {
    if (!NAME_RE.test(table) || table.startsWith('_')) {
      throw new Error(`Invalid table name "${table}" in schema (letters, digits, _; must not start with _).`);
    }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      throw new Error(`Table "${table}" in schema must be an object of { column: type }.`);
    }
    const cols: Record<string, SchemaFieldType> = { id: 'string' };
    for (const [col, type] of Object.entries(fields)) {
      if (!NAME_RE.test(col)) throw new Error(`Invalid column name "${table}.${col}" in schema.`);
      if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
        throw new Error(`Invalid field type for "${table}.${col}": "${String(type)}".`);
      }
      cols[col] = type as SchemaFieldType;
    }
    cols.id = 'string';
    out[table] = cols;
  }
  return out;
}

export function resolveSchemaFile(explicit?: string, cwd = process.cwd()): string {
  const found = resolveProjectFile(explicit, 'SCHEMA_PATH', ['src/schema.ts', 'schema.ts'], cwd);
  if (found) return found;
  throw new Error(
    `No schema file found. Create src/schema.ts (or set SCHEMA_PATH):\n` +
      `  export default { notes: { id: 'string', title: 'string', body: 'string | null' } };`,
  );
}

export async function loadSchemaFile(file: string): Promise<SchemaDictionary> {
  const loaded = await import(pathToFileURL(file).href);
  const mod = loaded.default;
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
  const up =
    dialect === 'mysql'
      ? diff.up.map((stmt) => {
          if (!/^\s*CREATE TABLE/i.test(stmt) || /COLLATE=/i.test(stmt)) return stmt;
          if (/CHARSET=utf8mb4/i.test(stmt)) {
            return stmt.replace(/CHARSET=utf8mb4/gi, 'CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci');
          }
          return `${stmt} ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`;
        })
      : diff.up;
  return { up, warnings: diff.warnings, next, first: prev === null };
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
