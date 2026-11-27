import crypto from 'node:crypto';
import { buildUpsertSql, quoteIdent, type SqlExecutor } from 'local-lite/server';
import type { SchemaFieldType } from '../schema.js';
import { toDbValue } from '../tableStorage.js';

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
  await tx.execute(`UPDATE ${q(clockTable)} SET checkpoint = ? WHERE id = 1`, [timestamp]);
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
      ? [fields.created_at.startsWith('number') ? timestamp : new Date(timestamp).toISOString()]
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
  const cols = Object.keys(fields).filter((c) => !SYSTEM_COLS.has(c) && Object.hasOwn(patch, c));
  const sets = [...cols.map((c) => `${q(c)} = ?`), `${q('updated_at')} = ?`];
  const params = [...cols.map((c) => toDbValue(fields[c], patch[c], tx.dialect)), timestamp, rowId];
  await tx.execute(`UPDATE ${q(table)} SET ${sets.join(', ')} WHERE ${q('id')} = ?`, params);
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
  return typeof raw === 'string' && raw.trim() ? raw.trim() : crypto.randomUUID();
}
