import {
  quoteIdent,
  type SqlDialect,
  type SqlExecutor,
  type SyncChangeEvent,
  type SyncEventBroker,
} from 'local-lite/server';
import { getCompactedFloor } from '../core/changes.js';
import { importUserModule, resolveProjectFile } from '../core/resolve.js';
import type { RuleContext, RowPredicate, RulesDictionary } from './rules.js';
import type { SchemaDictionary, SchemaFieldType } from './schema.js';
import { ClientError, fromDbRow, toDbValue } from './tableStorage.js';

export type LensFilterValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number>;

export type LensFilter = Record<string, LensFilterValue>;

export interface LensContext {
  auth: RuleContext;
}

export interface LensDefinition<TArgs = Record<string, unknown>> {
  table: string;
  columns?: string[];
  where?: (ctx: LensContext, args: TArgs) => LensFilter | Promise<LensFilter>;
  authorize?: (ctx: LensContext, args: TArgs) => boolean | Promise<boolean>;
}

export type LensRegistry = Map<string, LensDefinition<any>>;

/** Defines a single declarative Sync Lens for scoped, RLS-enforced delta sync. */
export function defineLens<TArgs = Record<string, unknown>>(
  def: LensDefinition<TArgs>,
): LensDefinition<TArgs> {
  if (!def.table || typeof def.table !== 'string') {
    throw new Error('defineLens requires a valid "table" name.');
  }
  return def;
}

/** Builds a LensRegistry from a named dictionary of lens definitions. */
export function defineLenses(
  input: Record<string, LensDefinition<any>>,
): LensRegistry {
  const registry: LensRegistry = new Map();
  for (const [name, def] of Object.entries(input)) {
    if (def) registry.set(name, defineLens(def));
  }
  return registry;
}

export function resolveLensesFile(
  explicit?: string,
  cwd = process.cwd(),
): string | null {
  return resolveProjectFile(
    explicit,
    'LENSES_PATH',
    ['lenses.mjs', 'src/lenses.ts', 'lenses.ts'],
    cwd,
  );
}

export async function loadLensesFile(file: string): Promise<LensRegistry> {
  const loaded = await importUserModule(file);
  const mod = loaded.default;
  if (mod instanceof Map) return mod as LensRegistry;
  if (!mod || typeof mod !== 'object' || Array.isArray(mod)) {
    throw new Error(
      `${file} must export default defineLenses({ ... }).`,
    );
  }
  return defineLenses(mod as Record<string, LensDefinition<any>>);
}

export interface CompiledSqlFilter {
  clauses: string[];
  params: unknown[];
  denied: boolean;
  needsJsCheck: boolean;
}

/**
 * Compiles declarative rule presets (`authenticated`, `admin`, `none`, `owner`,
 * `owner:<col>`) into SQL WHERE clauses so DB indexes filter rows before Node.
 */
export function compileRlsSqlFilter(
  rule: RowPredicate | undefined,
  auth: RuleContext,
  fields: Record<string, SchemaFieldType>,
  dialect: SqlDialect,
): CompiledSqlFilter {
  if (!rule || auth.isAdmin) {
    return { clauses: [], params: [], denied: false, needsJsCheck: false };
  }
  const preset = rule.__rulePreset;
  if (!preset) {
    return { clauses: [], params: [], denied: false, needsJsCheck: true };
  }
  const q = (col: string) => quoteIdent(col, dialect);

  if (preset === 'none' || preset === 'admin') {
    return { clauses: [], params: [], denied: true, needsJsCheck: false };
  }
  if (preset === 'authenticated') {
    return auth.userId
      ? { clauses: [], params: [], denied: false, needsJsCheck: false }
      : { clauses: [], params: [], denied: true, needsJsCheck: false };
  }
  if (!auth.userId) {
    return { clauses: [], params: [], denied: true, needsJsCheck: false };
  }
  if (preset === 'owner') {
    if (Object.hasOwn(fields, 'owner_id')) {
      return {
        clauses: [`${q('owner_id')} = ?`],
        params: [auth.userId],
        denied: false,
        needsJsCheck: false,
      };
    }
    if (Object.hasOwn(fields, 'user_id')) {
      return {
        clauses: [`${q('user_id')} = ?`],
        params: [auth.userId],
        denied: false,
        needsJsCheck: false,
      };
    }
    return { clauses: [], params: [], denied: true, needsJsCheck: false };
  }
  if (preset.startsWith('owner:')) {
    const col = preset.slice(6).trim();
    if (!Object.hasOwn(fields, col)) {
      return { clauses: [], params: [], denied: true, needsJsCheck: false };
    }
    return {
      clauses: [`${q(col)} = ?`],
      params: [auth.userId],
      denied: false,
      needsJsCheck: false,
    };
  }
  return { clauses: [], params: [], denied: false, needsJsCheck: true };
}

/** Compiles a lens `where` filter dictionary into parameterized SQL WHERE clauses. */
export function compileLensWhereSql(
  where: LensFilter,
  fields: Record<string, SchemaFieldType>,
  dialect: SqlDialect,
): { clauses: string[]; params: unknown[]; empty: boolean } {
  const q = (col: string) => quoteIdent(col, dialect);
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const [col, val] of Object.entries(where)) {
    if (col !== 'id' && !Object.hasOwn(fields, col)) {
      throw new ClientError(`Unknown lens filter column "${col}".`);
    }
    const fieldType: SchemaFieldType =
      col === 'id' ? 'string' : fields[col];
    if (val === null) {
      clauses.push(`${q(col)} IS NULL`);
    } else if (Array.isArray(val)) {
      if (val.length === 0) {
        return { clauses: [], params: [], empty: true };
      }
      clauses.push(`${q(col)} IN (${val.map(() => '?').join(', ')})`);
      for (const item of val) {
        params.push(toDbValue(fieldType, item, dialect));
      }
    } else {
      clauses.push(`${q(col)} = ?`);
      params.push(toDbValue(fieldType, val, dialect));
    }
  }
  return { clauses, params, empty: false };
}

function projectColumns(
  row: Record<string, any>,
  columns?: string[],
): Record<string, any> {
  if (!columns || columns.length === 0) return row;
  const out: Record<string, any> = {
    updated_at: row.updated_at,
    deleted: row.deleted,
  };
  for (const col of columns) {
    if (Object.hasOwn(row, col)) out[col] = row[col];
  }
  return out;
}

export interface LensDeltasResult {
  changes: {
    timestamp: number;
    changes: Array<{
      tableName: string;
      rowId: string;
      operation: 'UPDATE' | 'DELETE';
      payload: Record<string, any> | null;
      timestamp: number;
    }>;
  };
  cursor: number;
  hasMore: boolean;
  resyncRequired?: boolean;
  minCheckpoint?: number;
  serverTime: number;
}

export async function getLensDeltas(opts: {
  db: SqlExecutor;
  schema: SchemaDictionary;
  rules: RulesDictionary;
  lens: LensDefinition<any>;
  args: Record<string, unknown>;
  since: number;
  limit?: number;
  auth: RuleContext;
  changesTable?: string;
}): Promise<LensDeltasResult> {
  const { db, schema, rules, lens, args, since, auth } = opts;
  const fields = Object.hasOwn(schema, lens.table)
    ? schema[lens.table]
    : undefined;
  if (!fields) {
    throw new ClientError(`Lens references unknown table "${lens.table}".`);
  }

  if (lens.authorize && !(await lens.authorize({ auth }, args))) {
    throw new ClientError('Lens access denied.');
  }

  const checkpoint =
    Number.isFinite(since) && since >= 0 ? Math.floor(since) : 0;
  const safeLimit = Math.max(
    1,
    Math.min(2000, Math.floor(Number(limitOrDefault(opts.limit)) || 500)),
  );
  const empty: LensDeltasResult = {
    changes: { timestamp: checkpoint, changes: [] },
    cursor: checkpoint,
    hasMore: false,
    serverTime: Date.now(),
  };

  const compactedFloor = await getCompactedFloor(db);
  if (compactedFloor > 0 && checkpoint > 0 && checkpoint < compactedFloor) {
    return {
      changes: { timestamp: compactedFloor, changes: [] },
      cursor: compactedFloor,
      hasMore: false,
      resyncRequired: true,
      minCheckpoint: compactedFloor,
      serverTime: Date.now(),
    };
  }

  const readRule = !auth.isAdmin
    ? (rules[lens.table] ?? rules['*'])?.read
    : undefined;
  const rlsSql = compileRlsSqlFilter(readRule, auth, fields, db.dialect);
  if (rlsSql.denied) return empty;

  const lensFilter = lens.where ? await lens.where({ auth }, args) : {};
  const lensSql = compileLensWhereSql(lensFilter, fields, db.dialect);
  if (lensSql.empty) return empty;

  const q = (name: string) => quoteIdent(name, db.dialect);
  const changesTable = opts.changesTable ?? '_server_changes';

  const raw = await db.query<{
    table_name: string;
    row_id: string;
    ts: number;
  }>(
    `SELECT table_name, row_id, ${q('timestamp')} AS ts FROM ${q(changesTable)} ` +
      `WHERE ${q('timestamp')} > ? AND project_id IS NULL AND table_name = ? ` +
      `ORDER BY ${q('timestamp')} ASC LIMIT ${safeLimit + 1}`,
    [checkpoint, lens.table],
  );
  const hasMore = raw.length > safeLimit;
  const page = hasMore ? raw.slice(0, safeLimit) : raw;
  if (!page.length) return empty;

  const latest = new Map<string, { id: string; ts: number }>();
  for (const c of page) {
    const id = String(c.row_id);
    latest.delete(id);
    latest.set(id, { id, ts: Number(c.ts) });
  }

  const physicalTable = lens.table;
  const ids = [...latest.keys()];
  const rows = new Map<string, Record<string, any>>();
  const extraClauses = [...lensSql.clauses, ...rlsSql.clauses];
  const extraParams = [...lensSql.params, ...rlsSql.params];
  const extraWhere = extraClauses.length
    ? ` AND ${extraClauses.join(' AND ')}`
    : '';

  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const found = await db.query<Record<string, any>>(
      `SELECT * FROM ${q(physicalTable)} WHERE ${q('id')} IN (${chunk.map(() => '?').join(', ')})${extraWhere}`,
      [...chunk, ...extraParams],
    );
    for (const r of found) rows.set(String(r.id), r);
  }

  const changes: LensDeltasResult['changes']['changes'] = [];
  for (const entry of latest.values()) {
    const row = rows.get(entry.id);
    const gone = !row || Boolean(row.deleted);
    const payload = row
      ? projectColumns(fromDbRow(fields, row), lens.columns)
      : null;

    if (rlsSql.needsJsCheck && readRule) {
      const subject = { id: entry.id, ...(payload ?? { deleted: true }) };
      if (!(await readRule(auth, subject))) continue;
    }

    changes.push({
      tableName: lens.table,
      rowId: entry.id,
      operation: gone ? 'DELETE' : 'UPDATE',
      payload,
      timestamp: entry.ts,
    });
  }

  const cursor = Number(page[page.length - 1].ts);
  return {
    changes: { timestamp: cursor, changes },
    cursor,
    hasMore,
    serverTime: Date.now(),
  };
}

export interface LensSnapshotResult {
  checkpoint: number;
  rows: Array<Record<string, any>>;
}

/**
 * Exports a consistent snapshot of all non-deleted rows matching a Sync Lens
 * at a single `REPEATABLE READ` checkpoint so new clients can bootstrap without
 * replaying historical `_server_changes`.
 */
export async function getLensSnapshot(opts: {
  db: SqlExecutor;
  schema: SchemaDictionary;
  rules: RulesDictionary;
  lens: LensDefinition<any>;
  args: Record<string, unknown>;
  auth: RuleContext;
  clockTable?: string;
}): Promise<LensSnapshotResult> {
  const { db, schema, rules, lens, args, auth } = opts;
  const fields = Object.hasOwn(schema, lens.table)
    ? schema[lens.table]
    : undefined;
  if (!fields) {
    throw new ClientError(`Lens references unknown table "${lens.table}".`);
  }
  if (lens.authorize && !(await lens.authorize({ auth }, args))) {
    throw new ClientError('Lens access denied.');
  }

  const readRule = !auth.isAdmin
    ? (rules[lens.table] ?? rules['*'])?.read
    : undefined;
  const rlsSql = compileRlsSqlFilter(readRule, auth, fields, db.dialect);
  if (rlsSql.denied) return { checkpoint: 0, rows: [] };

  const lensFilter = lens.where ? await lens.where({ auth }, args) : {};
  const lensSql = compileLensWhereSql(lensFilter, fields, db.dialect);
  if (lensSql.empty) return { checkpoint: 0, rows: [] };

  const q = (name: string) => quoteIdent(name, db.dialect);
  const clockTable = opts.clockTable ?? '_server_sync_clock';
  const notDeleted = db.dialect === 'postgres' ? 'FALSE' : '0';
  const clauses = [
    `${q('deleted')} = ${notDeleted}`,
    ...lensSql.clauses,
    ...rlsSql.clauses,
  ];
  const params = [...lensSql.params, ...rlsSql.params];

  return db.withTransaction(async (tx) => {
    await tx.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const clockRows = await tx.query<{ checkpoint?: number }>(
      `SELECT checkpoint FROM ${q(clockTable)} WHERE id = 1`,
    );
    const checkpoint = Number(clockRows[0]?.checkpoint ?? 0);
    const rawRows = await tx.query<Record<string, any>>(
      `SELECT * FROM ${q(lens.table)} WHERE ${clauses.join(' AND ')} ORDER BY ${q('updated_at')} ASC`,
      params,
    );

    const rows: Array<Record<string, any>> = [];
    for (const r of rawRows) {
      const normalized = {
        id: String(r.id),
        ...projectColumns(fromDbRow(fields, r), lens.columns),
      };
      if (rlsSql.needsJsCheck && readRule && !(await readRule(auth, normalized))) {
        continue;
      }
      rows.push(normalized);
    }
    return { checkpoint, rows };
  });
}

/** Streams a lens snapshot as `application/x-ndjson` (header, rows, footer). */
export async function streamLensSnapshot(opts: {
  db: SqlExecutor;
  schema: SchemaDictionary;
  rules: RulesDictionary;
  lens: LensDefinition<any>;
  lensName: string;
  args: Record<string, unknown>;
  auth: RuleContext;
  clockTable?: string;
}): Promise<Response> {
  const { checkpoint, rows } = await getLensSnapshot(opts);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `${JSON.stringify({ type: 'header', lens: opts.lensName, checkpoint })}\n`,
        ),
      );
      for (const row of rows) {
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ type: 'row', row })}\n`),
        );
      }
      controller.enqueue(
        encoder.encode(
          `${JSON.stringify({ type: 'footer', checkpoint, count: rows.length })}\n`,
        ),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}

function limitOrDefault(limit?: number): number {
  return limit ?? 500;
}

/** Returns true if a `SyncChangeEvent` can affect a lens with `filterCols`. */
export function matchesLensEvent(
  lens: Pick<LensDefinition<any>, 'table' | 'columns'>,
  filterCols: string[],
  ev: SyncChangeEvent,
): boolean {
  if (ev.tableName !== lens.table) return false;
  if (
    ev.op === 'patch' &&
    ev.changedCols &&
    filterCols.length > 0 &&
    lens.columns &&
    lens.columns.length > 0
  ) {
    return ev.changedCols.some(
      (c) => filterCols.includes(c) || lens.columns!.includes(c),
    );
  }
  return true;
}

/**
 * Streams live delta batches over SSE for a Sync Lens, coalescing bursts
 * and skipping events that cannot affect the lens's static filter.
 */
export async function subscribeLens(opts: {
  db: SqlExecutor;
  schema: SchemaDictionary;
  rules: RulesDictionary;
  broker: SyncEventBroker;
  lens: LensDefinition<any>;
  args: Record<string, unknown>;
  since: number;
  auth: RuleContext;
}): Promise<Response> {
  const { lens, auth, args, broker } = opts;
  const initial = await getLensDeltas({ ...opts });
  let cursor = initial.cursor;
  const filterCols = lens.where ? Object.keys(await lens.where({ auth }, args)) : [];

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushing = false;
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

      send(`event: connected\ndata: ${JSON.stringify({ cursor })}\n\n`);
      if (initial.changes.changes.length > 0) {
        send(`event: deltas\ndata: ${JSON.stringify(initial)}\n\n`);
      }

      const flush = async () => {
        flushTimer = null;
        if (flushing) {
          queued = true;
          return;
        }
        flushing = true;
        try {
          const next = await getLensDeltas({ ...opts, since: cursor });
          if (next.cursor > cursor) cursor = next.cursor;
          if (next.changes.changes.length > 0) {
            send(`event: deltas\ndata: ${JSON.stringify(next)}\n\n`);
          }
        } catch (err) {
          send(
            `event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Lens sync failed.' })}\n\n`,
          );
        } finally {
          flushing = false;
          if (queued) {
            queued = false;
            scheduleFlush();
          }
        }
      };

      const scheduleFlush = () => {
        if (flushTimer) return;
        flushTimer = setTimeout(() => void flush(), 15);
      };

      const unsub = broker.subscribe((ev) => {
        if (matchesLensEvent(lens, filterCols, ev)) scheduleFlush();
      });
      const heartbeat = setInterval(() => send(': keep-alive\n\n'), 25_000);

      cleanup = () => {
        if (flushTimer) clearTimeout(flushTimer);
        clearInterval(heartbeat);
        unsub();
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
}
