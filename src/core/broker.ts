import {
  createSyncEventBroker,
  quoteIdent,
  type SqlExecutor,
  type SyncChangeEvent,
  type SyncEventBroker,
} from 'local-lite/server';
import type { ServerSettings } from '../config.js';
import { pgClientConfig } from '../db/client.js';

export interface ManagedBroker extends SyncEventBroker {
  close(): Promise<void>;
}

/** Isolates pub/sub events per project (or root server when projectId is null). */
export function scopeBroker(
  broker: SyncEventBroker,
  projectId: string | null,
): SyncEventBroker {
  const prefix = projectId ? `prj:${projectId}:` : null;
  return {
    publish(event) {
      broker.publish({
        ...event,
        scopeId: prefix ? `${prefix}${event.scopeId}` : event.scopeId,
      });
    },
    subscribe(listener) {
      return broker.subscribe((event) => {
        if (prefix) {
          if (!event.scopeId.startsWith(prefix)) return;
          listener({ ...event, scopeId: event.scopeId.slice(prefix.length) });
        } else {
          if (event.scopeId.startsWith('prj:')) return;
          listener(event);
        }
      });
    },
  };
}

/**
 * Single-node in-memory broker by default.
 * When `MULTI_INSTANCE=true`:
 *  - Postgres: uses native LISTEN/NOTIFY on `lls_sync_events` (zero extra deps).
 *  - MySQL: polls `_server_changes` every 1s for changes from sibling instances.
 */
export async function createClusterBroker(
  settings: ServerSettings,
  db: SqlExecutor,
): Promise<ManagedBroker> {
  const local = createSyncEventBroker();
  if (!settings.multiInstance) {
    return { ...local, close: async () => {} };
  }

  if (settings.dialect === 'postgres') {
    const pg = (await import('pg')).default;
    const sub = new pg.Client(pgClientConfig(settings));
    await sub.connect();
    sub.on('notification', (msg) => {
      if (msg.channel !== 'lls_sync_events' || !msg.payload) return;
      try {
        const raw = JSON.parse(msg.payload) as Record<string, any>;
        local.publish({
          scopeId: String(raw.s ?? raw.scopeId ?? 'default'),
          tableName: String(raw.t ?? raw.tableName ?? ''),
          checkpoint: Number(raw.ts ?? raw.checkpoint ?? 0),
          ...(raw.r || raw.rowId ? { rowId: String(raw.r ?? raw.rowId) } : {}),
          ...(raw.o || raw.op ? { op: raw.o ?? raw.op } : {}),
          ...(raw.c || raw.changedCols
            ? { changedCols: raw.c ?? raw.changedCols }
            : {}),
        });
      } catch {
        // ignore malformed payload
      }
    });
    await sub.query('LISTEN lls_sync_events');

    return {
      publish(event) {
        const compact: Record<string, unknown> = {
          s: event.scopeId,
          t: event.tableName,
          ts: event.checkpoint,
        };
        if (event.rowId) compact.r = event.rowId;
        if (event.op) compact.o = event.op;
        if (event.changedCols?.length) compact.c = event.changedCols;
        void db
          .query('SELECT pg_notify($1, $2)', [
            'lls_sync_events',
            JSON.stringify(compact),
          ])
          .catch(() => {
            local.publish(event);
          });
      },
      subscribe: (listener) => local.subscribe(listener),
      close: () => sub.end().catch(() => {}),
    };
  }

  // MySQL multi-instance: tail `_server_changes` for events written by other nodes.
  const qChanges = quoteIdent('_server_changes', 'mysql');
  const qTs = quoteIdent('timestamp', 'mysql');
  let lastId = 0;
  try {
    const rows = await db.query<{ max_id: number }>(
      `SELECT COALESCE(MAX(id), 0) AS max_id FROM ${qChanges}`,
    );
    lastId = Number(rows[0]?.max_id ?? 0);
  } catch {
    lastId = 0;
  }

  const timer = setInterval(async () => {
    try {
      const rows = await db.query<{
        id: number;
        table_name: string;
        row_id?: string;
        ts: number;
      }>(
        `SELECT id, table_name, row_id, ${qTs} AS ts FROM ${qChanges} WHERE id > ? ORDER BY id ASC LIMIT 200`,
        [lastId],
      );
      for (const r of rows) {
        lastId = Math.max(lastId, Number(r.id));
        local.publish({
          scopeId: 'default',
          tableName: String(r.table_name),
          checkpoint: Number(r.ts),
          ...(r.row_id ? { rowId: String(r.row_id) } : {}),
        });
      }
    } catch {
      // ignore transient poll errors
    }
  }, 1000);
  timer.unref?.();

  return {
    publish: (ev) => local.publish(ev),
    subscribe: (listener) => local.subscribe(listener),
    close: async () => clearInterval(timer),
  };
}
