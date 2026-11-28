import crypto from 'node:crypto';
import {
  buildUpsertSql,
  quoteIdent,
  type SqlExecutor,
} from 'local-lite/server';
import type { SchemaFieldType } from '../db/schema.js';
import { toDbValue } from '../db/tableStorage.js';

const SYSTEM_COLS = new Set(['id', 'updated_at', 'deleted']);

/** Locks and reads `_server_sync_clock` inside an active transaction. */
export async function lockClock(
  tx: SqlExecutor,
  clockTable = '_server_sync_clock',
): Promise<number> {
  const q = (n: string) => quoteIdent(n, tx.dialect);
  const clock = await tx.query<{ checkpoint: number }>(
    `SELECT checkpoint FROM ${q(clockTable)} WHERE id = 1 FOR UPDATE`,
  );
  return Number(clock[0]?.checkpoint ?? 0);
}

/** Appends a row entry to `_server_changes` with an already-computed timestamp. */
export async function appendChangeLog(
  tx: SqlExecutor,
  table: string,
  rowId: string,
  timestamp: number,
  changesTable = '_server_changes',
  projectId?: string | null,
): Promise<void> {
  const q = (n: string) => quoteIdent(n, tx.dialect);
  if (projectId) {
    await tx.execute(
      `INSERT INTO ${q(changesTable)} (table_name, row_id, ${q('timestamp')}, project_id) VALUES (?, ?, ?, ?)`,
      [table, rowId, timestamp, projectId],
    );
  } else {
    await tx.execute(
      `INSERT INTO ${q(changesTable)} (table_name, row_id, ${q('timestamp')}) VALUES (?, ?, ?)`,
      [table, rowId, timestamp],
    );
  }
}

/** Updates `_server_sync_clock` to `timestamp`. */
export async function commitClock(
  tx: SqlExecutor,
  timestamp: number,
  clockTable = '_server_sync_clock',
): Promise<void> {
  const q = (n: string) => quoteIdent(n, tx.dialect);
  await tx.execute(`UPDATE ${q(clockTable)} SET checkpoint = ? WHERE id = 1`, [
    timestamp,
  ]);
}

/** Advances `_server_sync_clock` inside an active transaction and logs to `_server_changes`. */
export async function recordChange(
  tx: SqlExecutor,
  table: string,
  rowId: string,
  changesTable = '_server_changes',
  clockTable = '_server_sync_clock',
  projectId?: string | null,
): Promise<number> {
  const prev = await lockClock(tx, clockTable);
  const ts = Math.max(Date.now(), prev + 1);
  await appendChangeLog(tx, table, rowId, ts, changesTable, projectId);
  await commitClock(tx, ts, clockTable);
  return ts;
}

/** Upserts a row into a schema-defined table using dialect-safe column conversion. */
export async function upsertTableRow(
  tx: SqlExecutor,
  table: string,
  fields: Record<string, SchemaFieldType>,
  rowId: string,
  data: Record<string, any>,
  timestamp: number,
): Promise<void> {
  const dialect = tx.dialect;
  const autoCreatedAt =
    Object.hasOwn(fields, 'created_at') && data.created_at == null;
  const cols = Object.keys(fields).filter(
    (c) =>
      !SYSTEM_COLS.has(c) &&
      Object.hasOwn(data, c) &&
      !(autoCreatedAt && c === 'created_at'),
  );
  const insertCols = [
    'id',
    ...cols,
    'updated_at',
    'deleted',
    ...(autoCreatedAt ? ['created_at'] : []),
  ];
  const params: unknown[] = [
    rowId,
    ...cols.map((c) => toDbValue(fields[c], data[c], dialect)),
    timestamp,
    dialect === 'postgres' ? Boolean(data.deleted) : data.deleted ? 1 : 0,
    ...(autoCreatedAt
      ? [
          fields.created_at.startsWith('number')
            ? timestamp
            : new Date(timestamp).toISOString(),
        ]
      : []),
  ];
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
}

/** Updates specified schema columns on an existing row. */
export async function patchTableRow(
  tx: SqlExecutor,
  table: string,
  fields: Record<string, SchemaFieldType>,
  rowId: string,
  patch: Record<string, any>,
  timestamp: number,
): Promise<void> {
  const q = (n: string) => quoteIdent(n, tx.dialect);
  const cols = Object.keys(fields).filter(
    (c) => !SYSTEM_COLS.has(c) && Object.hasOwn(patch, c),
  );
  const sets = [...cols.map((c) => `${q(c)} = ?`), `${q('updated_at')} = ?`];
  const params = [
    ...cols.map((c) => toDbValue(fields[c], patch[c], tx.dialect)),
    timestamp,
    rowId,
  ];
  await tx.execute(
    `UPDATE ${q(table)} SET ${sets.join(', ')} WHERE ${q('id')} = ?`,
    params,
  );
}

/** Soft-deletes or restores a row in a schema-defined table. */
export async function setRowDeleted(
  tx: SqlExecutor,
  table: string,
  rowId: string,
  deleted: boolean,
  timestamp: number,
): Promise<void> {
  const q = (n: string) => quoteIdent(n, tx.dialect);
  const delVal = tx.dialect === 'postgres' ? deleted : deleted ? 1 : 0;
  await tx.execute(
    `UPDATE ${q(table)} SET ${q('deleted')} = ?, ${q('updated_at')} = ? WHERE ${q('id')} = ?`,
    [delVal, timestamp, rowId],
  );
}

export function newRowId(raw?: unknown): string {
  return typeof raw === 'string' && raw.trim()
    ? raw.trim()
    : crypto.randomUUID();
}

/** Reads the compacted checkpoint floor from `_server_sync_clock` (0 if unset). */
export async function getCompactedFloor(
  db: SqlExecutor,
  clockTable = '_server_sync_clock',
): Promise<number> {
  const q = (n: string) => quoteIdent(n, db.dialect);
  try {
    const rows = await db.query<{ compacted_floor?: number }>(
      `SELECT compacted_floor FROM ${q(clockTable)} WHERE id = 1`,
    );
    return Number(rows[0]?.compacted_floor ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Prunes `_server_changes` entries older than `cutoffTimestamp` (or `retentionDays`)
 * and advances `compacted_floor` so stale clients receive `resyncRequired: true`.
 */
export async function compactChangeLog(
  db: SqlExecutor,
  opts: {
    retentionDays?: number;
    cutoffTimestamp?: number;
    changesTable?: string;
    clockTable?: string;
  } = {},
): Promise<{ deleted: number; compactedFloor: number }> {
  const changesTable = opts.changesTable ?? '_server_changes';
  const clockTable = opts.clockTable ?? '_server_sync_clock';
  const days = Math.max(1, opts.retentionDays ?? 30);
  const cutoff =
    opts.cutoffTimestamp ?? Date.now() - days * 86_400_000;
  const q = (n: string) => quoteIdent(n, db.dialect);

  return db.withTransaction(async (tx) => {
    const rows = await tx.query<{
      checkpoint: number;
      compacted_floor?: number;
    }>(
      `SELECT checkpoint, compacted_floor FROM ${q(clockTable)} WHERE id = 1 FOR UPDATE`,
    );
    const currentCheckpoint = Number(rows[0]?.checkpoint ?? 0);
    const prevFloor = Number(rows[0]?.compacted_floor ?? 0);
    const safeCutoff = Math.min(cutoff, currentCheckpoint);
    if (safeCutoff <= prevFloor) {
      return { deleted: 0, compactedFloor: prevFloor };
    }

    const res = await tx.execute(
      `DELETE FROM ${q(changesTable)} WHERE ${q('timestamp')} <= ?`,
      [safeCutoff],
    );
    await tx.execute(
      `UPDATE ${q(clockTable)} SET compacted_floor = ? WHERE id = 1`,
      [safeCutoff],
    );
    return {
      deleted: Number(res.affectedRows ?? 0),
      compactedFloor: safeCutoff,
    };
  });
}
