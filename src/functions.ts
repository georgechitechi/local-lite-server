import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildUpsertSql,
  quoteIdent,
  type SqlExecutor,
  type SyncEventBroker,
} from 'local-lite/server';
import type { SchemaDictionary, SchemaFieldType } from './schema.js';
import { fromDbRow, toDbValue } from './tableStorage.js';

export type FunctionKind = 'query' | 'mutation' | 'action';

export class FunctionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface FunctionAuth {
  isAdmin: boolean;
  userId?: string;
}

export interface ListOptions {
  where?: Record<string, unknown>;
  orderBy?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

export interface DbReader {
  get(table: string, id: string): Promise<Record<string, any> | null>;
  list(table: string, opts?: ListOptions): Promise<Record<string, any>[]>;
  sql<T = Record<string, any>>(
    query: string,
    params?: unknown[],
    touchesTables?: string[],
  ): Promise<T[]>;
}

export interface DbWriter extends DbReader {
  insert(table: string, data: Record<string, unknown>): Promise<Record<string, any>>;
  patch(table: string, id: string, patch: Record<string, unknown>): Promise<Record<string, any> | null>;
  remove(table: string, id: string): Promise<boolean>;
}

export interface QueryContext {
  db: DbReader;
  auth: FunctionAuth;
}

export interface MutationContext {
  db: DbWriter;
  auth: FunctionAuth;
}

export interface ActionContext {
  auth: FunctionAuth;
  runQuery<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  runMutation<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
}

export type ArgValidator<TArgs> = (raw: Record<string, unknown>) => TArgs;

export interface FunctionDef<TCtx, TArgs, TRes> {
  __kind: FunctionKind;
  args?: ArgValidator<TArgs>;
  handler: (ctx: TCtx, args: TArgs) => Promise<TRes> | TRes;
}

export function defineQuery<TArgs = Record<string, unknown>, TRes = unknown>(def: {
  args?: ArgValidator<TArgs>;
  handler: (ctx: QueryContext, args: TArgs) => Promise<TRes> | TRes;
}): FunctionDef<QueryContext, TArgs, TRes> {
  return { __kind: 'query', ...def };
}

export function defineMutation<TArgs = Record<string, unknown>, TRes = unknown>(def: {
  args?: ArgValidator<TArgs>;
  handler: (ctx: MutationContext, args: TArgs) => Promise<TRes> | TRes;
}): FunctionDef<MutationContext, TArgs, TRes> {
  return { __kind: 'mutation', ...def };
}

export function defineAction<TArgs = Record<string, unknown>, TRes = unknown>(def: {
  args?: ArgValidator<TArgs>;
  handler: (ctx: ActionContext, args: TArgs) => Promise<TRes> | TRes;
}): FunctionDef<ActionContext, TArgs, TRes> {
  return { __kind: 'action', ...def };
}

export type FunctionRegistry = Map<string, FunctionDef<any, any, any>>;

const EXTENSIONS = ['.ts', '.mts', '.mjs', '.js'];

export async function loadFunctionsDir(
  dir?: string,
  cwd = process.cwd(),
): Promise<FunctionRegistry> {
  const registry: FunctionRegistry = new Map();
  const abs = path.resolve(cwd, dir || 'functions');
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return registry;

  const entries = fs.readdirSync(abs, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('_') || entry.name.endsWith('.d.ts')) continue;
    const ext = EXTENSIONS.find((e) => entry.name.endsWith(e));
    if (!ext) continue;
    const modName = entry.name.slice(0, -ext.length);
    const mod = await import(pathToFileURL(path.join(abs, entry.name)).href);
    for (const [expName, val] of Object.entries(mod)) {
      if (
        val &&
        typeof val === 'object' &&
        '__kind' in val &&
        typeof (val as any).handler === 'function'
      ) {
        registry.set(`${modName}/${expName}`, val as FunctionDef<any, any, any>);
      }
    }
  }
  return registry;
}

const SYSTEM_COLS = new Set(['id', 'updated_at', 'deleted']);

function createReader(
  db: SqlExecutor,
  schema: SchemaDictionary,
  readTables: Set<string>,
): DbReader {
  const q = (n: string) => quoteIdent(n, db.dialect);
  const fieldsOf = (table: string): Record<string, SchemaFieldType> => {
    const f = Object.hasOwn(schema, table) ? schema[table] : undefined;
    if (!f) throw new FunctionError(`Unknown table "${table}".`, 400);
    return f;
  };
  const notDeleted = db.dialect === 'postgres' ? 'FALSE' : '0';

  return {
    async get(table, id) {
      const fields = fieldsOf(table);
      readTables.add(table);
      const rows = await db.query<Record<string, any>>(
        `SELECT * FROM ${q(table)} WHERE ${q('id')} = ? AND ${q('deleted')} = ${notDeleted} LIMIT 1`,
        [id],
      );
      if (!rows[0]) return null;
      return { id: String(rows[0].id), ...fromDbRow(fields, rows[0]) };
    },

    async list(table, opts = {}) {
      const fields = fieldsOf(table);
      readTables.add(table);
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (!opts.includeDeleted) clauses.push(`${q('deleted')} = ${notDeleted}`);
      if (opts.where) {
        for (const [col, val] of Object.entries(opts.where)) {
          if (!Object.hasOwn(fields, col)) {
            throw new FunctionError(`Unknown column "${table}.${col}".`, 400);
          }
          if (val === null) {
            clauses.push(`${q(col)} IS NULL`);
          } else {
            clauses.push(`${q(col)} = ?`);
            params.push(toDbValue(fields[col], val, db.dialect));
          }
        }
      }
      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const orderCol =
        opts.orderBy && Object.hasOwn(fields, opts.orderBy) ? opts.orderBy : 'updated_at';
      const dir = opts.order === 'asc' ? 'ASC' : 'DESC';
      const limit = Math.min(Math.max(Math.floor(opts.limit ?? 100), 1), 1000);
      const offset = Math.max(Math.floor(opts.offset ?? 0), 0);

      const rows = await db.query<Record<string, any>>(
        `SELECT * FROM ${q(table)} ${whereSql} ORDER BY ${q(orderCol)} ${dir} LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return rows.map((r) => ({ id: String(r.id), ...fromDbRow(fields, r) }));
    },

    async sql<T = Record<string, any>>(
      query: string,
      params: unknown[] = [],
      touchesTables?: string[],
    ): Promise<T[]> {
      if (touchesTables) {
        for (const t of touchesTables) readTables.add(t);
      } else {
        for (const t of Object.keys(schema)) {
          if (new RegExp(`\\b${t}\\b`).test(query)) readTables.add(t);
        }
      }
      return db.query<T>(query, params);
    },
  };
}

export interface FunctionRuntime {
  list(): Array<{ name: string; kind: FunctionKind }>;
  run(
    name: string,
    rawArgs: Record<string, unknown>,
    auth: FunctionAuth,
  ): Promise<{ result: unknown; readTables: Set<string> }>;
  subscribe(
    name: string,
    rawArgs: Record<string, unknown>,
    auth: FunctionAuth,
  ): Promise<Response>;
}

export function createFunctionRuntime(opts: {
  registry: FunctionRegistry;
  db: SqlExecutor;
  schema: SchemaDictionary;
  broker: SyncEventBroker;
  scopeField?: string;
}): FunctionRuntime {
  const { registry, db, schema, broker } = opts;
  const scopeField = opts.scopeField ?? 'scope_id';

  const getFn = (name: string) => {
    const fn = registry.get(name);
    if (!fn) throw new FunctionError(`Function "${name}" not found.`, 404);
    return fn;
  };

  const parseArgs = (fn: FunctionDef<any, any, any>, raw: Record<string, unknown>) => {
    if (!fn.args) return raw;
    try {
      return fn.args(raw);
    } catch (err) {
      throw new FunctionError(err instanceof Error ? err.message : 'Invalid arguments.', 400);
    }
  };

  const runQuery = async (
    name: string,
    rawArgs: Record<string, unknown>,
    auth: FunctionAuth,
  ) => {
    const fn = getFn(name);
    if (fn.__kind !== 'query') {
      throw new FunctionError(`"${name}" is a ${fn.__kind}, not a query.`, 400);
    }
    const readTables = new Set<string>();
    const reader = createReader(db, schema, readTables);
    const args = parseArgs(fn, rawArgs);
    const result = await fn.handler({ db: reader, auth }, args);
    return { result, readTables };
  };

  const runMutation = async (
    name: string,
    rawArgs: Record<string, unknown>,
    auth: FunctionAuth,
  ) => {
    const fn = getFn(name);
    if (fn.__kind !== 'mutation') {
      throw new FunctionError(`"${name}" is a ${fn.__kind}, not a mutation.`, 400);
    }
    const args = parseArgs(fn, rawArgs);
    const dialect = db.dialect;
    const q = (n: string) => quoteIdent(n, dialect);
    const emitted: Array<{ scopeId: string; tableName: string; checkpoint: number }> = [];
    const readTables = new Set<string>();

    const result = await db.withTransaction(async (tx) => {
      const reader = createReader(tx, schema, readTables);
      const clockRows = await tx.query<{ checkpoint: number }>(
        `SELECT checkpoint FROM ${q('_server_sync_clock')} WHERE id = 1 FOR UPDATE`,
      );
      let cursor = Number(clockRows[0]?.checkpoint ?? 0);
      const nextCursor = () => {
        cursor = Math.max(Date.now(), cursor + 1);
        return cursor;
      };
      const recordChange = async (table: string, id: string, scopeVal: unknown) => {
        const ts = nextCursor();
        await tx.execute(
          `INSERT INTO ${q('_server_changes')} (table_name, row_id, ${q('timestamp')}) VALUES (?, ?, ?)`,
          [table, id, ts],
        );
        await tx.execute(`UPDATE ${q('_server_sync_clock')} SET checkpoint = ? WHERE id = 1`, [ts]);
        emitted.push({
          scopeId: typeof scopeVal === 'string' && scopeVal ? scopeVal : 'default',
          tableName: table,
          checkpoint: ts,
        });
        return ts;
      };

      const writer: DbWriter = {
        ...reader,
        async insert(table, data) {
          const fields = Object.hasOwn(schema, table) ? schema[table] : undefined;
          if (!fields) throw new FunctionError(`Unknown table "${table}".`, 400);
          const id = typeof data.id === 'string' && data.id ? data.id : crypto.randomUUID();
          const ts = await recordChange(table, id, data[scopeField]);
          const cols = Object.keys(fields).filter(
            (c) => !SYSTEM_COLS.has(c) && c !== 'created_at' && Object.hasOwn(data, c),
          );
          const insertCols = ['id', ...cols, 'updated_at', 'deleted'];
          const params: unknown[] = [
            id,
            ...cols.map((c) => toDbValue(fields[c], data[c], dialect)),
            ts,
            dialect === 'postgres' ? false : 0,
          ];
          if (fields.created_at) {
            insertCols.push('created_at');
            params.push(
              data.created_at != null ? toDbValue(fields.created_at, data.created_at, dialect) : ts,
            );
          }
          await tx.execute(
            buildUpsertSql({
              table,
              conflictCols: ['id'],
              insertCols,
              updateCols: [...cols, 'updated_at', 'deleted'],
              dialect,
            }),
            params,
          );
          return (await reader.get(table, id))!;
        },

        async patch(table, id, patch) {
          const fields = Object.hasOwn(schema, table) ? schema[table] : undefined;
          if (!fields) throw new FunctionError(`Unknown table "${table}".`, 400);
          const existing = await reader.get(table, id);
          if (!existing) return null;
          const cols = Object.keys(fields).filter(
            (c) => !SYSTEM_COLS.has(c) && Object.hasOwn(patch, c),
          );
          const ts = await recordChange(table, id, patch[scopeField] ?? existing[scopeField]);
          const sets = [...cols.map((c) => `${q(c)} = ?`), `${q('updated_at')} = ?`];
          const params = [...cols.map((c) => toDbValue(fields[c], patch[c], dialect)), ts, id];
          await tx.execute(
            `UPDATE ${q(table)} SET ${sets.join(', ')} WHERE ${q('id')} = ?`,
            params,
          );
          return reader.get(table, id);
        },

        async remove(table, id) {
          if (!Object.hasOwn(schema, table)) {
            throw new FunctionError(`Unknown table "${table}".`, 400);
          }
          const existing = await reader.get(table, id);
          if (!existing) return false;
          const ts = await recordChange(table, id, existing[scopeField]);
          await tx.execute(
            `UPDATE ${q(table)} SET ${q('deleted')} = ?, ${q('updated_at')} = ? WHERE ${q('id')} = ?`,
            [dialect === 'postgres' ? true : 1, ts, id],
          );
          return true;
        },
      };

      return fn.handler({ db: writer, auth }, args);
    });

    for (const e of emitted) broker.publish(e);
    return { result, readTables };
  };

  const run = async (
    name: string,
    rawArgs: Record<string, unknown>,
    auth: FunctionAuth,
  ): Promise<{ result: unknown; readTables: Set<string> }> => {
    const fn = getFn(name);
    if (fn.__kind === 'query') return runQuery(name, rawArgs, auth);
    if (fn.__kind === 'mutation') return runMutation(name, rawArgs, auth);
    const args = parseArgs(fn, rawArgs);
    const ctx: ActionContext = {
      auth,
      runQuery: async (n, a = {}) => (await runQuery(n, a, auth)).result as any,
      runMutation: async (n, a = {}) => (await runMutation(n, a, auth)).result as any,
    };
    const result = await fn.handler(ctx, args);
    return { result, readTables: new Set() };
  };

  const subscribe = async (
    name: string,
    rawArgs: Record<string, unknown>,
    auth: FunctionAuth,
  ): Promise<Response> => {
    const initial = await runQuery(name, rawArgs, auth);
    let tracked = initial.readTables;
    let lastJson = JSON.stringify(initial.result);
    const encoder = new TextEncoder();
    let cleanup: (() => void) | null = null;
    let running = false;
    let queued = false;

    const stream = new ReadableStream({
      start(controller) {
        const send = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            cleanup?.();
          }
        };

        send(`event: data\ndata: ${lastJson}\n\n`);

        const refresh = async () => {
          if (running) {
            queued = true;
            return;
          }
          running = true;
          try {
            const next = await runQuery(name, rawArgs, auth);
            tracked = next.readTables;
            const nextJson = JSON.stringify(next.result);
            if (nextJson !== lastJson) {
              lastJson = nextJson;
              send(`event: data\ndata: ${nextJson}\n\n`);
            }
          } catch (err) {
            send(
              `event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Query failed.' })}\n\n`,
            );
          } finally {
            running = false;
            if (queued) {
              queued = false;
              void refresh();
            }
          }
        };

        const unsub = broker.subscribe((ev) => {
          if (tracked.size === 0 || tracked.has(ev.tableName)) {
            void refresh();
          }
        });
        const heartbeat = setInterval(() => send(': keep-alive\n\n'), 25_000);

        cleanup = () => {
          unsub();
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
      },
      cancel() {
        cleanup?.();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  };

  return {
    list: () => [...registry.entries()].map(([name, def]) => ({ name, kind: def.__kind })),
    run,
    subscribe,
  };
}
