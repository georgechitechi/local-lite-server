import {
  buildUpsertSql,
  quoteIdent,
  type ServerSyncStorage,
  type SqlExecutor,
  type SyncEventBroker,
} from 'local-lite/server';
import type { SchemaDictionary, SchemaFieldType } from './schema.js';

type Op = {
  id: string;
  tableName: string;
  rowId: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  payload?: Record<string, any> | null;
  timestamp: number;
};

/** Thrown for bad client input; the HTTP layer maps it to 400. */
export class ClientError extends Error {}

const MAX_BATCH = 1000;
const SYSTEM_COLS = new Set(['id', 'updated_at', 'deleted']);

const baseType = (t: SchemaFieldType) => t.replace(' | null', '');

/** Client value -> DB parameter. */
export function toDbValue(type: SchemaFieldType, value: unknown, dialect: string): unknown {
  if (value === undefined || value === null) return null;
  switch (baseType(type)) {
    case 'boolean':
      return dialect === 'postgres' ? Boolean(value) : value ? 1 : 0;
    case 'number':
      return Number(value);
    case 'json':
    case 'string[]':
      return typeof value === 'string' ? value : JSON.stringify(value);
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

/** DB row -> client payload. */
export function fromDbRow(
  fields: Record<string, SchemaFieldType>,
  row: Record<string, any>,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [col, type] of Object.entries(fields)) {
    const v = row[col];
    if (v === undefined) continue;
    if (v === null) {
      out[col] = null;
      continue;
    }
    switch (baseType(type)) {
      case 'boolean':
        out[col] = Boolean(v);
        break;
      case 'number':
        out[col] = Number(v);
        break;
      case 'json':
      case 'string[]':
        if (typeof v === 'string') {
          try {
            out[col] = JSON.parse(v);
          } catch {
            out[col] = v;
          }
        } else out[col] = v;
        break;
      default:
        out[col] = v;
    }
  }
  out.deleted = Boolean(row.deleted);
  out.updated_at = Number(row.updated_at ?? 0);
  return out;
}

export interface TableSyncStorageOptions {
  schema: SchemaDictionary;
  broker?: SyncEventBroker;
  changesTable?: string;
  clockTable?: string;
  /** Column used as the realtime event scope when a payload has it. */
  scopeField?: string;
}

/**
 * Stores every synced table as a real SQL table. `_server_changes` keeps only
 * (table_name, row_id, timestamp) as a monotonic cursor/event log.
 */
export class TableSyncStorage implements ServerSyncStorage {
  private schema: SchemaDictionary;
  private broker?: SyncEventBroker;
  private changes: string;
  private clock: string;
  private scopeField: string;

  constructor(private db: SqlExecutor, opts: TableSyncStorageOptions) {
    this.schema = opts.schema;
    this.broker = opts.broker;
    this.changes = opts.changesTable ?? '_server_changes';
    this.clock = opts.clockTable ?? '_server_sync_clock';
    this.scopeField = opts.scopeField ?? 'scope_id';
  }

  get tables(): string[] {
    return Object.keys(this.schema);
  }

  private q = (name: string) => quoteIdent(name, this.db.dialect);

  private fields(table: string): Record<string, SchemaFieldType> {
    const f = Object.hasOwn(this.schema, table) ? this.schema[table] : undefined;
    if (!f) throw new ClientError(`Unknown table "${table}".`);
    return f;
  }

  async applyOperations(operations: Op[] | any[], _serverTime?: number) {
    if (operations.length > MAX_BATCH) throw new ClientError('Batch is too large.');
    const dialect = this.db.dialect;
    const emitted: Array<{ scopeId: string; tableName: string; checkpoint: number }> = [];
    const successfulIds: string[] = [];
    let cursor = 0;

    await this.db.withTransaction(async (tx) => {
      const clock = await tx.query<{ checkpoint: number }>(
        `SELECT checkpoint FROM ${this.q(this.clock)} WHERE id = 1 FOR UPDATE`,
      );
      cursor = Number(clock[0]?.checkpoint ?? 0);

      for (const op of operations as Op[]) {
        if (!op || typeof op.rowId !== 'string' || !op.rowId || op.rowId.length > 128) {
          throw new ClientError('Each operation needs a rowId string (max 128 chars).');
        }
        const fields = this.fields(op.tableName);
        cursor = Math.max(Date.now(), cursor + 1);
        const table = this.q(op.tableName);
        const payload = op.payload && typeof op.payload === 'object' ? op.payload : {};
        const del = dialect === 'postgres';
        const deletedVal = (flag: boolean) => (del ? flag : flag ? 1 : 0);

        if (op.operation === 'DELETE') {
          await tx.execute(
            `UPDATE ${table} SET ${this.q('deleted')} = ?, ${this.q('updated_at')} = ? WHERE ${this.q('id')} = ?`,
            [deletedVal(true), cursor, op.rowId],
          );
        } else {
          const cols = Object.keys(fields).filter(
            (c) => !SYSTEM_COLS.has(c) && c !== 'created_at' && Object.hasOwn(payload, c),
          );
          const insertCols = ['id', ...cols, 'updated_at', 'deleted'];
          const params: unknown[] = [
            op.rowId,
            ...cols.map((c) => toDbValue(fields[c], payload[c], dialect)),
            cursor,
            deletedVal(Boolean(payload.deleted)),
          ];
          const updateCols = [...cols, 'updated_at', 'deleted'];
          if (fields.created_at) {
            insertCols.push('created_at');
            params.push(payload.created_at != null ? toDbValue(fields.created_at, payload.created_at, dialect) : cursor);
          }
          await tx.execute(
            buildUpsertSql({
              table: op.tableName,
              conflictCols: ['id'],
              insertCols,
              updateCols,
              dialect,
            }),
            params,
          );
        }

        await tx.execute(
          `INSERT INTO ${this.q(this.changes)} (table_name, row_id, ${this.q('timestamp')}) VALUES (?, ?, ?)`,
          [op.tableName, op.rowId, cursor],
        );
        const scope = payload[this.scopeField];
        emitted.push({
          scopeId: typeof scope === 'string' && scope ? scope : 'default',
          tableName: op.tableName,
          checkpoint: cursor,
        });
        successfulIds.push(op.id);
      }

      if (operations.length) {
        await tx.execute(`UPDATE ${this.q(this.clock)} SET checkpoint = ? WHERE id = 1`, [cursor]);
      }
    });

    for (const e of emitted) this.broker?.publish(e);
    return { applied: successfulIds.length, successfulIds, serverTime: Date.now(), cursor };
  }

  async getDeltas(tables: string[], since: number, limit = 500) {
    const names = tables.length ? tables : this.tables;
    for (const t of names) this.fields(t);
    const checkpoint = Number.isFinite(since) && since >= 0 ? Math.floor(since) : 0;
    const safeLimit = Math.max(1, Math.min(2000, Math.floor(Number(limit) || 500)));
    const empty = {
      changes: { timestamp: checkpoint, changes: [] as any[] },
      cursor: checkpoint,
      hasMore: false,
      serverTime: Date.now(),
    };
    if (!names.length) return empty;

    const raw = await this.db.query<{ table_name: string; row_id: string; ts: number }>(
      `SELECT table_name, row_id, ${this.q('timestamp')} AS ts FROM ${this.q(this.changes)} ` +
        `WHERE ${this.q('timestamp')} > ? AND table_name IN (${names.map(() => '?').join(', ')}) ` +
        `ORDER BY ${this.q('timestamp')} ASC LIMIT ${safeLimit + 1}`,
      [checkpoint, ...names],
    );
    const hasMore = raw.length > safeLimit;
    const page = hasMore ? raw.slice(0, safeLimit) : raw;
    if (!page.length) return empty;

    // Collapse repeated edits of one row to its latest change.
    const latest = new Map<string, { table: string; id: string; ts: number }>();
    for (const c of page) {
      const key = `${c.table_name}\u0000${c.row_id}`;
      latest.delete(key);
      latest.set(key, { table: c.table_name, id: String(c.row_id), ts: Number(c.ts) });
    }

    const byTable = new Map<string, string[]>();
    for (const e of latest.values()) {
      const ids = byTable.get(e.table) ?? [];
      ids.push(e.id);
      byTable.set(e.table, ids);
    }
    const rows = new Map<string, Record<string, any>>();
    for (const [table, ids] of byTable) {
      for (let i = 0; i < ids.length; i += 400) {
        const chunk = ids.slice(i, i + 400);
        const found = await this.db.query<Record<string, any>>(
          `SELECT * FROM ${this.q(table)} WHERE ${this.q('id')} IN (${chunk.map(() => '?').join(', ')})`,
          chunk,
        );
        for (const r of found) rows.set(`${table}\u0000${r.id}`, r);
      }
    }

    const changes = [...latest.values()].map((e) => {
      const row = rows.get(`${e.table}\u0000${e.id}`);
      const gone = !row || Boolean(row.deleted);
      return {
        tableName: e.table,
        rowId: e.id,
        operation: gone ? ('DELETE' as const) : ('UPDATE' as const),
        payload: row ? fromDbRow(this.fields(e.table), row) : null,
        timestamp: e.ts,
      };
    });

    const cursor = Number(page[page.length - 1].ts);
    return {
      changes: { timestamp: cursor, changes },
      cursor,
      hasMore,
      serverTime: Date.now(),
    };
  }
}
