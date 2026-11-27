import {
  quoteIdent,
  type ServerSyncStorage,
  type SqlExecutor,
  type SyncEventBroker,
} from 'local-lite/server';
import {
  appendChangeLog,
  commitClock,
  lockClock,
  setRowDeleted,
  upsertTableRow,
} from '../core/changes.js';
import { toPhysicalTable } from '../services/projects.js';
import type { RuleContext, RulesDictionary } from './rules.js';
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

/** Thrown when a row-level access rule rejects the operation; mapped to 403. */
export class ForbiddenError extends Error {}

const MAX_BATCH = 1000;

const baseType = (t: SchemaFieldType) => t.replace(' | null', '');

/** Client value -> DB parameter. */
export function toDbValue(
  type: SchemaFieldType,
  value: unknown,
  dialect: string,
): unknown {
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
  rules?: RulesDictionary;
  broker?: SyncEventBroker;
  changesTable?: string;
  clockTable?: string;
  /** Column used as the realtime event scope when a payload has it. */
  scopeField?: string;
  /** Optional project id for `_server_changes.project_id` scoping. */
  projectId?: string | null;
  /** Optional project slug for physically isolated `p_<slug>_<table>` tables. */
  projectSlug?: string | null;
}

/**
 * Stores every synced table as a real SQL table. `_server_changes` keeps only
 * (table_name, row_id, timestamp) as a monotonic cursor/event log.
 */
export class TableSyncStorage implements ServerSyncStorage {
  private db: SqlExecutor;
  private schema: SchemaDictionary;
  private rules: RulesDictionary;
  private broker?: SyncEventBroker;
  private changes: string;
  private clock: string;
  private scopeField: string;
  private projectId: string | null;
  private projectSlug: string | null;

  constructor(db: SqlExecutor, opts: TableSyncStorageOptions) {
    this.db = db;
    this.schema = opts.schema;
    this.rules = opts.rules ?? {};
    this.broker = opts.broker;
    this.changes = opts.changesTable ?? '_server_changes';
    this.clock = opts.clockTable ?? '_server_sync_clock';
    this.scopeField = opts.scopeField ?? 'scope_id';
    this.projectId = opts.projectId ?? null;
    this.projectSlug = opts.projectSlug ?? null;
  }

  get tables(): string[] {
    return Object.keys(this.schema);
  }

  private q = (name: string) => quoteIdent(name, this.db.dialect);

  private sqlTable(logicalTable: string): string {
    return toPhysicalTable(this.projectSlug ?? this.projectId, logicalTable);
  }

  private fields(table: string): Record<string, SchemaFieldType> {
    const f = Object.hasOwn(this.schema, table)
      ? this.schema[table]
      : undefined;
    if (!f) throw new ClientError(`Unknown table "${table}".`);
    return f;
  }

  async applyOperations(
    operations: Op[] | any[],
    _serverTime?: number,
    auth: RuleContext = { isAdmin: true },
  ) {
    if (operations.length > MAX_BATCH)
      throw new ClientError('Batch is too large.');
    const emitted: Array<{
      scopeId: string;
      tableName: string;
      checkpoint: number;
    }> = [];
    const successfulIds: string[] = [];
    let cursor = 0;

    await this.db.withTransaction(async (tx) => {
      cursor = await lockClock(tx, this.clock);

      // Prefetch existing rows in batches for any table with a write RLS rule.
      const existingByKey = new Map<string, Record<string, any>>();
      if (!auth.isAdmin) {
        const idsByTable = new Map<string, Set<string>>();
        for (const op of operations as Op[]) {
          if (
            !op ||
            typeof op.rowId !== 'string' ||
            !op.rowId ||
            op.rowId.length > 128
          ) {
            throw new ClientError(
              'Each operation needs a rowId string (max 128 chars).',
            );
          }
          this.fields(op.tableName);
          const tableRule = this.rules[op.tableName];
          const needsCheck =
            op.operation === 'DELETE'
              ? (tableRule?.delete ?? tableRule?.write)
              : tableRule?.write;
          if (needsCheck) {
            const set = idsByTable.get(op.tableName) ?? new Set<string>();
            set.add(op.rowId);
            idsByTable.set(op.tableName, set);
          }
        }
        for (const [table, idSet] of idsByTable) {
          const fields = this.fields(table);
          const ids = [...idSet];
          for (let i = 0; i < ids.length; i += 400) {
            const chunk = ids.slice(i, i + 400);
            const found = await tx.query<Record<string, any>>(
              `SELECT * FROM ${this.q(this.sqlTable(table))} WHERE ${this.q('id')} IN (${chunk.map(() => '?').join(', ')})`,
              chunk,
            );
            for (const r of found) {
              existingByKey.set(`${table}\u0000${r.id}`, {
                id: String(r.id),
                ...fromDbRow(fields, r),
              });
            }
          }
        }
      }

      for (const op of operations as Op[]) {
        if (
          !op ||
          typeof op.rowId !== 'string' ||
          !op.rowId ||
          op.rowId.length > 128
        ) {
          throw new ClientError(
            'Each operation needs a rowId string (max 128 chars).',
          );
        }
        const fields = this.fields(op.tableName);
        const payload =
          op.payload && typeof op.payload === 'object' ? op.payload : {};
        const tableRule = !auth.isAdmin ? this.rules[op.tableName] : undefined;
        const writeRule =
          op.operation === 'DELETE'
            ? (tableRule?.delete ?? tableRule?.write)
            : tableRule?.write;
        if (writeRule) {
          const existing = existingByKey.get(
            `${op.tableName}\u0000${op.rowId}`,
          );
          if (existing) {
            if (!(await writeRule(auth, existing))) {
              throw new ForbiddenError(
                `Write denied on ${op.tableName}/${op.rowId}.`,
              );
            }
          }
          if (!existing || op.operation !== 'DELETE') {
            if (!(await writeRule(auth, { id: op.rowId, ...payload }))) {
              throw new ForbiddenError(
                `Write denied on ${op.tableName}/${op.rowId}.`,
              );
            }
          }
        }

        cursor = Math.max(Date.now(), cursor + 1);
        const physicalTable = this.sqlTable(op.tableName);
        if (op.operation === 'DELETE') {
          await setRowDeleted(tx, physicalTable, op.rowId, true, cursor);
        } else {
          await upsertTableRow(
            tx,
            physicalTable,
            fields,
            op.rowId,
            payload,
            cursor,
          );
          existingByKey.set(`${op.tableName}\u0000${op.rowId}`, {
            id: op.rowId,
            ...payload,
          });
        }
        await appendChangeLog(
          tx,
          op.tableName,
          op.rowId,
          cursor,
          this.changes,
          this.projectId,
        );

        const scope = payload[this.scopeField];
        emitted.push({
          scopeId: typeof scope === 'string' && scope ? scope : 'default',
          tableName: op.tableName,
          checkpoint: cursor,
        });
        successfulIds.push(op.id);
      }

      if (operations.length > 0) {
        await commitClock(tx, cursor, this.clock);
      }
    });

    for (const e of emitted) this.broker?.publish(e);
    return {
      applied: successfulIds.length,
      successfulIds,
      serverTime: Date.now(),
      cursor,
    };
  }

  async getDeltas(
    tables: string[],
    since: number,
    limit = 500,
    auth: RuleContext = { isAdmin: true },
  ) {
    const names = tables.length ? tables : this.tables;
    for (const t of names) this.fields(t);
    const checkpoint =
      Number.isFinite(since) && since >= 0 ? Math.floor(since) : 0;
    const safeLimit = Math.max(
      1,
      Math.min(2000, Math.floor(Number(limit) || 500)),
    );
    const empty = {
      changes: { timestamp: checkpoint, changes: [] as any[] },
      cursor: checkpoint,
      hasMore: false,
      serverTime: Date.now(),
    };
    if (!names.length) return empty;

    const projectWhere = this.projectId
      ? 'project_id = ?'
      : 'project_id IS NULL';
    const projectParams = this.projectId ? [this.projectId] : [];
    const raw = await this.db.query<{
      table_name: string;
      row_id: string;
      ts: number;
    }>(
      `SELECT table_name, row_id, ${this.q('timestamp')} AS ts FROM ${this.q(this.changes)} ` +
        `WHERE ${this.q('timestamp')} > ? AND ${projectWhere} AND table_name IN (${names.map(() => '?').join(', ')}) ` +
        `ORDER BY ${this.q('timestamp')} ASC LIMIT ${safeLimit + 1}`,
      [checkpoint, ...projectParams, ...names],
    );
    const hasMore = raw.length > safeLimit;
    const page = hasMore ? raw.slice(0, safeLimit) : raw;
    if (!page.length) return empty;

    // Collapse repeated edits of one row to its latest change.
    const latest = new Map<string, { table: string; id: string; ts: number }>();
    for (const c of page) {
      const key = `${c.table_name}\u0000${c.row_id}`;
      latest.delete(key);
      latest.set(key, {
        table: c.table_name,
        id: String(c.row_id),
        ts: Number(c.ts),
      });
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
          `SELECT * FROM ${this.q(this.sqlTable(table))} WHERE ${this.q('id')} IN (${chunk.map(() => '?').join(', ')})`,
          chunk,
        );
        for (const r of found) rows.set(`${table}\u0000${r.id}`, r);
      }
    }

    const allChanges = [...latest.values()].map((e) => {
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

    const changes = [];
    for (const c of allChanges) {
      const readRule = !auth.isAdmin
        ? this.rules[c.tableName]?.read
        : undefined;
      if (!readRule) {
        changes.push(c);
        continue;
      }
      const subject = { id: c.rowId, ...(c.payload ?? { deleted: true }) };
      if (await readRule(auth, subject)) changes.push(c);
    }

    const cursor = Number(page[page.length - 1].ts);
    return {
      changes: { timestamp: cursor, changes },
      cursor,
      hasMore,
      serverTime: Date.now(),
    };
  }
}
