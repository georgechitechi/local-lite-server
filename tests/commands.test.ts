import { describe, expect, it } from 'vitest';
import { createSyncEventBroker } from 'local-lite/server';
import {
  CommandRejection,
  defineCommand,
  type CommandRegistry,
} from '../src/commands/index.js';
import { loadSettings } from '../src/config.js';
import { normalizeSchema } from '../src/db/schema.js';
import { createApp } from '../src/server.js';

const env = {
  DB_DIALECT: 'mysql',
  DB_HOST: 'h',
  DB_USER: 'u',
  DB_NAME: 'n',
  SERVER_API_KEY: 'admin-key',
  APP_SECRET: 's'.repeat(32),
} as NodeJS.ProcessEnv;

const schema = normalizeSchema({
  notes: { title: 'string', scope_id: 'string' },
});

function mockDb(opts?: { failFirstAttempt?: boolean }) {
  const rows = new Map<string, any>();
  let checkpoint = 0;
  let attempts = 0;

  const ex: any = {
    dialect: 'mysql',
    query: async (sql: string, params: any[] = []) => {
      if (sql.includes('FOR UPDATE')) return [{ checkpoint }];
      if (sql.includes('FROM `notes` WHERE `id` = ?')) {
        const r = rows.get(params[0]);
        return r ? [r] : [];
      }
      return [...rows.values()];
    },
    execute: async (sql: string, params: any[] = []) => {
      if (sql.startsWith('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')) {
        attempts += 1;
        if (opts?.failFirstAttempt && attempts === 1) {
          const err: any = new Error('Deadlock found');
          err.errno = 1213;
          throw err;
        }
      }
      if (sql.startsWith('UPDATE `_server_sync_clock`')) {
        checkpoint = Number(params[0]);
      } else if (sql.startsWith('INSERT INTO `notes`')) {
        rows.set(params[0], {
          id: params[0],
          title: params[1],
          scope_id: params[2],
          updated_at: params[3],
          deleted: params[4],
        });
      }
      return { rowsAffected: 1 };
    },
    withTransaction: async (fn: any) => fn(ex),
  };
  return { ex, getAttempts: () => attempts };
}

describe('Domain Commands Runtime', () => {
  it('executes commands, emits granular SyncChangeEvents, and deduplicates Idempotency-Key', async () => {
    const broker = createSyncEventBroker();
    const events: any[] = [];
    broker.subscribe((e) => events.push(e));
    const { ex } = mockDb();

    const commands: CommandRegistry = new Map([
      [
        'notes/create',
        defineCommand<{ title: string; scope_id: string }>({
          handler: async ({ db, emit }, args) => {
            const row = await db.insert('notes', args);
            emit('note.created', { id: row.id });
            return row;
          },
        }),
      ],
    ]);

    const app = createApp(loadSettings(env), ex, schema, commands, {}, broker);

    const req = () =>
      new Request('http://localhost/cmd/notes/create', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer admin-key',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        body: JSON.stringify({
          args: { title: 'Offline First', scope_id: 'b1' },
        }),
      });

    const res1 = await app.fetch(req());
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as any;
    expect(body1.success).toBe(true);
    expect(body1.result.title).toBe('Offline First');
    expect(body1.events).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      scopeId: 'b1',
      tableName: 'notes',
      op: 'insert',
      changedCols: ['title', 'scope_id'],
    });

    const res2 = await app.fetch(req());
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as any;
    expect(body2.deduplicated).toBe(true);
    expect(events).toHaveLength(1);
  });

  it('returns 409 rejection on CommandRejection and retries serializable deadlocks', async () => {
    const { ex, getAttempts } = mockDb({ failFirstAttempt: true });
    const commands: CommandRegistry = new Map([
      [
        'notes/guarded',
        defineCommand<{ reject?: boolean }>({
          isolation: 'serializable',
          handler: async (_ctx, args) => {
            if (args.reject) {
              throw new CommandRejection('UNIT_OCCUPIED', 'Unit is already occupied.');
            }
            return { ok: true };
          },
        }),
      ],
    ]);

    const app = createApp(loadSettings(env), ex, schema, commands);

    const okRes = await app.fetch(
      new Request('http://localhost/cmd/notes/guarded', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer admin-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ args: {} }),
      }),
    );
    expect(okRes.status).toBe(200);
    expect(getAttempts()).toBe(2);

    const rejRes = await app.fetch(
      new Request('http://localhost/cmd/notes/guarded', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer admin-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ args: { reject: true } }),
      }),
    );
    expect(rejRes.status).toBe(409);
    const rejBody = (await rejRes.json()) as any;
    expect(rejBody).toMatchObject({
      success: false,
      rejected: true,
      code: 'UNIT_OCCUPIED',
    });
  });
});
