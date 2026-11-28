import crypto from 'node:crypto';
import {
  quoteIdent,
  type SqlExecutor,
  type SyncChangeEvent,
  type SyncEventBroker,
} from 'local-lite/server';
import {
  newRowId,
  patchTableRow,
  recordChange,
  setRowDeleted,
  upsertTableRow,
} from '../core/changes.js';
import type {
  ProjectionChange,
  ProjectionRegistry,
} from '../db/projections.js';
import type { SchemaDictionary, SchemaFieldType } from '../db/schema.js';
import { fromDbRow, toDbValue } from '../db/tableStorage.js';
import {
  CommandError,
  CommandRejection,
  type CommandAuth,
  type CommandDb,
  type CommandRegistry,
  type EmittedOutboxEvent,
} from './types.js';

export interface CommandRunResult {
  result?: unknown;
  checkpoint: number;
  events: EmittedOutboxEvent[];
  rejected?: boolean;
  code?: string;
  message?: string;
  details?: unknown;
  deduplicated?: boolean;
}

export interface CommandRuntime {
  list(): Array<{ name: string; isolation: 'serializable' | 'default' }>;
  run(
    name: string,
    rawArgs: Record<string, unknown>,
    auth: CommandAuth,
    opts?: { idempotencyKey?: string },
  ): Promise<CommandRunResult>;
}

function isRetryableSerializationError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; errno?: unknown; sqlState?: unknown };
  return (
    e.code === '40001' ||
    e.sqlState === '40001' ||
    e.errno === 1213 ||
    e.errno === 1205 ||
    e.code === 'ER_LOCK_DEADLOCK' ||
    e.code === 'ER_LOCK_WAIT_TIMEOUT'
  );
}

export function createCommandRuntime(opts: {
  registry: CommandRegistry;
  db: SqlExecutor;
  schema: SchemaDictionary;
  broker: SyncEventBroker;
  projections?: ProjectionRegistry;
  scopeField?: string;
}): CommandRuntime {
  const { registry, db, schema, broker } = opts;
  const projections = opts.projections ?? new Map();
  const scopeField = opts.scopeField ?? 'scope_id';
  const idempotencyCache = new Map<string, CommandRunResult>();

  const runOnce = async (
    name: string,
    args: Record<string, unknown>,
    auth: CommandAuth,
    isolation: 'serializable' | 'default',
  ): Promise<{ runRes: CommandRunResult; emitted: SyncChangeEvent[] }> => {
    const cmd = registry.get(name);
    if (!cmd) throw new CommandError(`Command "${name}" not found.`, 404);

    const emitted: SyncChangeEvent[] = [];
    const outboxEvents: EmittedOutboxEvent[] = [];
    let latestCheckpoint = 0;

    const result = await db.withTransaction(async (tx) => {
      if (isolation === 'serializable') {
        await tx.execute('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      }
      const q = (n: string) => quoteIdent(n, tx.dialect);
      const notDeleted = tx.dialect === 'postgres' ? 'FALSE' : '0';
      const fieldsOf = (table: string): Record<string, SchemaFieldType> => {
        const f = Object.hasOwn(schema, table) ? schema[table] : undefined;
        if (!f) throw new CommandError(`Unknown table "${table}".`, 400);
        return f;
      };

      const track = async (
        table: string,
        id: string,
        scopeVal: unknown,
        op: 'insert' | 'patch' | 'remove',
        changedCols?: string[],
      ) => {
        const ts = await recordChange(
          tx,
          table,
          id,
          '_server_changes',
          '_server_sync_clock',
        );
        latestCheckpoint = Math.max(latestCheckpoint, ts);
        emitted.push({
          scopeId:
            typeof scopeVal === 'string' && scopeVal ? scopeVal : 'default',
          tableName: table,
          checkpoint: ts,
          rowId: id,
          op,
          changedCols,
        });
        return ts;
      };

      let projectionDepth = 0;
      const runProjections = async (change: ProjectionChange) => {
        if (projections.size === 0 || projectionDepth >= 4) return;
        projectionDepth += 1;
        try {
          for (const proj of projections.values()) {
            if (proj.tables.includes(change.table)) {
              await proj.handler({ db: cmdDb, auth }, change);
            }
          }
        } finally {
          projectionDepth -= 1;
        }
      };

      const cmdDb: CommandDb = {
        async get(table, id) {
          const fields = fieldsOf(table);
          const rows = await tx.query<Record<string, any>>(
            `SELECT * FROM ${q(table)} WHERE ${q('id')} = ? AND ${q('deleted')} = ${notDeleted} LIMIT 1`,
            [id],
          );
          return rows[0]
            ? { id: String(rows[0].id), ...fromDbRow(fields, rows[0]) }
            : null;
        },

        async list(table, listOpts = {}) {
          const fields = fieldsOf(table);
          const clauses: string[] = [];
          const params: unknown[] = [];
          if (!listOpts.includeDeleted) {
            clauses.push(`${q('deleted')} = ${notDeleted}`);
          }
          if (listOpts.where) {
            for (const [col, val] of Object.entries(listOpts.where)) {
              if (!Object.hasOwn(fields, col)) {
                throw new CommandError(`Unknown column "${table}.${col}".`, 400);
              }
              if (val === null) clauses.push(`${q(col)} IS NULL`);
              else {
                clauses.push(`${q(col)} = ?`);
                params.push(toDbValue(fields[col], val, tx.dialect));
              }
            }
          }
          const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
          const orderCol =
            listOpts.orderBy && Object.hasOwn(fields, listOpts.orderBy)
              ? listOpts.orderBy
              : 'updated_at';
          const dir = listOpts.order === 'asc' ? 'ASC' : 'DESC';
          const limit = Math.min(
            Math.max(Math.floor(listOpts.limit ?? 100), 1),
            1000,
          );
          const offset = Math.max(Math.floor(listOpts.offset ?? 0), 0);
          const rows = await tx.query<Record<string, any>>(
            `SELECT * FROM ${q(table)} ${whereSql} ORDER BY ${q(orderCol)} ${dir} LIMIT ${limit} OFFSET ${offset}`,
            params,
          );
          return rows.map((r) => ({ id: String(r.id), ...fromDbRow(fields, r) }));
        },

        async sql<T = Record<string, any>>(query: string, params: unknown[] = []) {
          return tx.query<T>(query, params);
        },

        async insert(table, data) {
          const fields = fieldsOf(table);
          const id = newRowId(data.id);
          const ts = await track(
            table,
            id,
            data[scopeField],
            'insert',
            Object.keys(data),
          );
          await upsertTableRow(tx, table, fields, id, data, ts);
          const after = (await cmdDb.get(table, id))!;
          await runProjections({
            table,
            rowId: id,
            op: 'insert',
            before: null,
            after,
          });
          return after;
        },

        async patch(table, id, patch) {
          const fields = fieldsOf(table);
          const existing = await cmdDb.get(table, id);
          if (!existing) return null;
          const ts = await track(
            table,
            id,
            patch[scopeField] ?? existing[scopeField],
            'patch',
            Object.keys(patch),
          );
          await patchTableRow(tx, table, fields, id, patch, ts);
          const after = await cmdDb.get(table, id);
          await runProjections({
            table,
            rowId: id,
            op: 'patch',
            before: existing,
            after,
          });
          return after;
        },

        async remove(table, id) {
          fieldsOf(table);
          const existing = await cmdDb.get(table, id);
          if (!existing) return false;
          const ts = await track(table, id, existing[scopeField], 'remove');
          await setRowDeleted(tx, table, id, true, ts);
          await runProjections({
            table,
            rowId: id,
            op: 'remove',
            before: existing,
            after: null,
          });
          return true;
        },
      };

      const res = await cmd.handler(
        {
          db: cmdDb,
          auth,
          emit(topic, payload) {
            outboxEvents.push({ topic, payload });
          },
        },
        args,
      );

      if (outboxEvents.length > 0) {
        const now = Date.now();
        for (const ev of outboxEvents) {
          await tx.execute(
            `INSERT INTO ${q('_server_outbox')} (id, topic, payload_json, status, attempts, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              crypto.randomUUID(),
              ev.topic,
              JSON.stringify(ev.payload ?? null),
              'pending',
              0,
              now,
              now,
            ],
          );
        }
      }

      return res;
    });

    return {
      runRes: {
        result,
        checkpoint: latestCheckpoint,
        events: outboxEvents,
      },
      emitted,
    };
  };

  return {
    list: () =>
      [...registry.entries()].map(([name, def]) => ({
        name,
        isolation: def.isolation ?? 'default',
      })),

    async run(name, rawArgs, auth, runOpts = {}) {
      const cmd = registry.get(name);
      if (!cmd) throw new CommandError(`Command "${name}" not found.`, 404);

      const idemKey = runOpts.idempotencyKey?.trim();
      if (idemKey) {
        const scopedKey = `${name}\u0000${idemKey}`;
        const cached = idempotencyCache.get(scopedKey);
        if (cached) return { ...cached, deduplicated: true };
      }

      let parsedArgs = rawArgs;
      if (cmd.args) {
        try {
          parsedArgs = cmd.args(rawArgs);
        } catch (err) {
          throw new CommandError(
            err instanceof Error ? err.message : 'Invalid arguments.',
            400,
          );
        }
      }

      const isolation = cmd.isolation ?? 'default';
      const maxRetries = Math.max(0, cmd.maxRetries ?? 3);

      for (let attempt = 0; ; attempt++) {
        try {
          const { runRes, emitted } = await runOnce(
            name,
            parsedArgs,
            auth,
            isolation,
          );
          for (const ev of emitted) broker.publish(ev);
          if (idemKey) {
            const scopedKey = `${name}\u0000${idemKey}`;
            if (idempotencyCache.size > 5000) idempotencyCache.clear();
            idempotencyCache.set(scopedKey, runRes);
          }
          return runRes;
        } catch (err) {
          if (err instanceof CommandRejection) {
            return {
              rejected: true,
              code: err.code,
              message: err.message,
              details: err.details,
              checkpoint: 0,
              events: [],
            };
          }
          if (
            isolation === 'serializable' &&
            attempt < maxRetries &&
            isRetryableSerializationError(err)
          ) {
            continue;
          }
          throw err;
        }
      }
    },
  };
}
