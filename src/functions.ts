import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  quoteIdent,
  type SqlExecutor,
  type SyncEventBroker,
} from 'local-lite/server';
import {
  newRowId,
  patchTableRow,
  recordChange,
  setRowDeleted,
  upsertTableRow,
} from './core/changes.js';
import type { SchemaDictionary, SchemaFieldType } from './schema.js';
import { fromDbRow, toDbValue } from './tableStorage.js';

export type FunctionKind = 'query' | 'mutation' | 'action';

export class FunctionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
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

function resolveFunctionsDir(dir: string | undefined, cwd: string): string {
  if (dir) return path.resolve(cwd, dir);
  const inSrc = path.resolve(cwd, 'src/functions');
  if (fs.existsSync(inSrc) && fs.statSync(inSrc).isDirectory()) return inSrc;
  return path.resolve(cwd, 'functions');
}

export async function loadFunctionsDir(
  dir?: string,
  cwd = process.cwd(),
  bustCache = false,
): Promise<FunctionRegistry> {
  const registry: FunctionRegistry = new Map();
  const abs = resolveFunctionsDir(dir, cwd);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return registry;

  const entries = fs.readdirSync(abs, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('_') || entry.name.endsWith('.d.ts')) continue;
    const ext = EXTENSIONS.find((e) => entry.name.endsWith(e));
    if (!ext) continue;
    const modName = entry.name.slice(0, -ext.length);
    const url = pathToFileURL(path.join(abs, entry.name)).href + (bustCache ? `?t=${Date.now()}` : '');
    const mod = await import(url);
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

/** Hot-reloads `functions/` in place on file edits without dropping SSE connections. */
export function watchFunctionsDir(
  dir: string | undefined,
  registry: FunctionRegistry,
  cwd = process.cwd(),
): () => void {
  const abs = resolveFunctionsDir(dir, cwd);
  if (!fs.existsSync(abs)) return () => { };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = fs.watch(abs, () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const next = await loadFunctionsDir(dir, cwd, true);
        registry.clear();
        for (const [k, v] of next) registry.set(k, v);
        console.log(`[local-lite-server] hot-reloaded ${registry.size} function(s)`);
      } catch (err) {
        console.error('[local-lite-server] function reload failed:', err);
      }
    }, 120);
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}

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
    const emitted: Array<{ scopeId: string; tableName: string; checkpoint: number }> = [];
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
    const emitted: Array<{ scopeId: string; tableName: string; checkpoint: number }> = [];
    const readTables = new Set<string>();

    const result = await db.withTransaction(async (tx) => {
      const reader = createReader(tx, schema, readTables);
      const track = async (table: string, id: string, scopeVal: unknown) => {
        const ts = await recordChange(tx, table, id);
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
          const id = newRowId(data.id);
          const ts = await track(table, id, data[scopeField]);
          await upsertTableRow(tx, table, fields, id, data, ts);
          return (await reader.get(table, id))!;
        },

        async patch(table, id, patch) {
          const fields = Object.hasOwn(schema, table) ? schema[table] : undefined;
          if (!fields) throw new FunctionError(`Unknown table "${table}".`, 400);
          const existing = await reader.get(table, id);
          if (!existing) return null;
          const ts = await track(table, id, patch[scopeField] ?? existing[scopeField]);
          await patchTableRow(tx, table, fields, id, patch, ts);
          return reader.get(table, id);
        },

        async remove(table, id) {
          if (!Object.hasOwn(schema, table)) {
            throw new FunctionError(`Unknown table "${table}".`, 400);
          }
          const existing = await reader.get(table, id);
          if (!existing) return false;
          const ts = await track(table, id, existing[scopeField]);
          await setRowDeleted(tx, table, id, true, ts);
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
