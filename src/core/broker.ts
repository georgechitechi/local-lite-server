import {
  createSyncEventBroker,
  quoteIdent,
  type SqlExecutor,
  type SyncChangeEvent,
  type SyncEventBroker,
} from 'local-lite/server';
import type { ServerSettings } from '../config.js';

export interface ManagedBroker extends SyncEventBroker {
  close(): Promise<void>;
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
    const sub = new pg.Client({
      host: settings.db.host,
      port: settings.db.port,
      user: settings.db.user,
      password: settings.db.password,
      database: settings.db.database,
      ssl: settings.db.ssl ? { rejectUnauthorized: false } : undefined,
    });
    await sub.connect();
    sub.on('notification', (msg) => {
      if (msg.channel !== 'lls_sync_events' || !msg.payload) return;
      try {
        local.publish(JSON.parse(msg.payload) as SyncChangeEvent);
      } catch {
        // ignore malformed payload
      }
    });
    await sub.query('LISTEN lls_sync_events');

    return {
      publish(event) {
        void db.query('SELECT pg_notify($1, $2)', ['lls_sync_events', JSON.stringify(event)]).catch(() => {
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
    const rows = await db.query<{ max_id: number }>(`SELECT COALESCE(MAX(id), 0) AS max_id FROM ${qChanges}`);
    lastId = Number(rows[0]?.max_id ?? 0);
  } catch {
    lastId = 0;
  }

  const timer = setInterval(async () => {
    try {
      const rows = await db.query<{ id: number; table_name: string; ts: number }>(
        `SELECT id, table_name, ${qTs} AS ts FROM ${qChanges} WHERE id > ? ORDER BY id ASC LIMIT 200`,
        [lastId],
      );
      for (const r of rows) {
        lastId = Math.max(lastId, Number(r.id));
        local.publish({
          scopeId: 'default',
          tableName: String(r.table_name),
          checkpoint: Number(r.ts),
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
