import { quoteIdent, type SqlExecutor, type SyncEventBroker } from 'local-lite/server';
import {
  newRowId,
  patchTableRow,
  recordChange,
  setRowDeleted,
  upsertTableRow,
} from '../core/changes.js';
import { toPhysicalTable } from '../services/projects.js';
import type { SchemaDictionary, SchemaFieldType } from '../db/schema.js';
import { fromDbRow, toDbValue } from '../db/tableStorage.js';
import {
  FunctionError,
  type ActionContext,
  type DbReader,
  type DbWriter,
  type FunctionAuth,
  type FunctionDef,
  type FunctionKind,
  type FunctionRegistry,
} from './types.js';

function createReader(
  db: SqlExecutor,
  schema: SchemaDictionary,
  readTables: Set<string>,
  projectSlug: string | null = null,
): DbReader {
  const q = (n: string) => quoteIdent(n, db.dialect);
  const phys = (table: string) => toPhysicalTable(projectSlug, table);
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
        `SELECT * FROM ${q(phys(table))} WHERE ${q('id')} = ? AND ${q('deleted')} = ${notDeleted} LIMIT 1`,
        [id],
      );
      return rows[0] ? { id: String(rows[0].id), ...fromDbRow(fields, rows[0]) } : null;
    },

    async list(table, opts = {}) {
      const fields = fieldsOf(table);
      readTables.add(table);
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (!opts.includeDeleted) clauses.push(`${q('deleted')} = ${notDeleted}`);
      if (opts.where) {
        for (const [col, val] of Object.entries(opts.where)) {
          if (!Object.hasOwn(fields, col)) throw new FunctionError(`Unknown column "${table}.${col}".`, 400);
          if (val === null) clauses.push(`${q(col)} IS NULL`);
          else {
            clauses.push(`${q(col)} = ?`);
            params.push(toDbValue(fields[col], val, db.dialect));
          }
        }
      }
      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const orderCol = opts.orderBy && Object.hasOwn(fields, opts.orderBy) ? opts.orderBy : 'updated_at';
      const dir = opts.order === 'asc' ? 'ASC' : 'DESC';
      const limit = Math.min(Math.max(Math.floor(opts.limit ?? 100), 1), 1000);
      const offset = Math.max(Math.floor(opts.offset ?? 0), 0);
      const rows = await db.query<Record<string, any>>(
        `SELECT * FROM ${q(phys(table))} ${whereSql} ORDER BY ${q(orderCol)} ${dir} LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return rows.map((r) => ({ id: String(r.id), ...fromDbRow(fields, r) }));
    },

    async sql<T = Record<string, any>>(query: string, params: unknown[] = [], touchesTables?: string[]) {
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
  run(name: string, rawArgs: Record<string, unknown>, auth: FunctionAuth): Promise<{ result: unknown; readTables: Set<string> }>;
  subscribe(name: string, rawArgs: Record<string, unknown>, auth: FunctionAuth): Promise<Response>;
}

export function createFunctionRuntime(opts: {
  registry: FunctionRegistry;
  db: SqlExecutor;
  schema: SchemaDictionary;
  broker: SyncEventBroker;
  scopeField?: string;
  projectId?: string | null;
  projectSlug?: string | null;
}): FunctionRuntime {
  const { registry, db, schema, broker } = opts;
  const scopeField = opts.scopeField ?? 'scope_id';
  const projectId = opts.projectId ?? null;
  const projectSlug = opts.projectSlug ?? projectId;
  const phys = (table: string) => toPhysicalTable(projectSlug, table);

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

  const runQuery = async (name: string, rawArgs: Record<string, unknown>, auth: FunctionAuth) => {
    const fn = getFn(name);
    if (fn.__kind !== 'query') throw new FunctionError(`"${name}" is a ${fn.__kind}, not a query.`, 400);
    const readTables = new Set<string>();
    const result = await fn.handler({ db: createReader(db, schema, readTables, projectSlug), auth }, parseArgs(fn, rawArgs));
    return { result, readTables };
  };

  const runMutation = async (name: string, rawArgs: Record<string, unknown>, auth: FunctionAuth) => {
    const fn = getFn(name);
    if (fn.__kind !== 'mutation') throw new FunctionError(`"${name}" is a ${fn.__kind}, not a mutation.`, 400);
    const args = parseArgs(fn, rawArgs);
    const emitted: Array<{ scopeId: string; tableName: string; checkpoint: number }> = [];
    const readTables = new Set<string>();

    const result = await db.withTransaction(async (tx) => {
      const reader = createReader(tx, schema, readTables, projectSlug);
      const track = async (table: string, id: string, scopeVal: unknown) => {
        const ts = await recordChange(tx, table, id, '_server_changes', '_server_sync_clock', projectId);
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
          await upsertTableRow(tx, phys(table), fields, id, data, ts);
          return (await reader.get(table, id))!;
        },
        async patch(table, id, patch) {
          const fields = Object.hasOwn(schema, table) ? schema[table] : undefined;
          if (!fields) throw new FunctionError(`Unknown table "${table}".`, 400);
          const existing = await reader.get(table, id);
          if (!existing) return null;
          const ts = await track(table, id, patch[scopeField] ?? existing[scopeField]);
          await patchTableRow(tx, phys(table), fields, id, patch, ts);
          return reader.get(table, id);
        },
        async remove(table, id) {
          if (!Object.hasOwn(schema, table)) throw new FunctionError(`Unknown table "${table}".`, 400);
          const existing = await reader.get(table, id);
          if (!existing) return false;
          const ts = await track(table, id, existing[scopeField]);
          await setRowDeleted(tx, phys(table), id, true, ts);
          return true;
        },
      };
      return fn.handler({ db: writer, auth }, args);
    });

    for (const e of emitted) broker.publish(e);
    return { result, readTables };
  };

  const run = async (name: string, rawArgs: Record<string, unknown>, auth: FunctionAuth) => {
    const fn = getFn(name);
    if (fn.__kind === 'query') return runQuery(name, rawArgs, auth);
    if (fn.__kind === 'mutation') return runMutation(name, rawArgs, auth);
    const ctx: ActionContext = {
      auth,
      runQuery: async (n, a = {}) => (await runQuery(n, a, auth)).result as any,
      runMutation: async (n, a = {}) => (await runMutation(n, a, auth)).result as any,
    };
    return { result: await fn.handler(ctx, parseArgs(fn, rawArgs)), readTables: new Set<string>() };
  };

  const subscribe = async (name: string, rawArgs: Record<string, unknown>, auth: FunctionAuth) => {
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
            send(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Query failed.' })}\n\n`);
          } finally {
            running = false;
            if (queued) {
              queued = false;
              void refresh();
            }
          }
        };
        const unsub = broker.subscribe((ev) => {
          if (tracked.size === 0 || tracked.has(ev.tableName)) void refresh();
        });
        const heartbeat = setInterval(() => send(': keep-alive\n\n'), 25_000);
        cleanup = () => {
          unsub();
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch {}
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
