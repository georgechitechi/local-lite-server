import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createSyncEventBroker } from 'local-lite/server';
import { defineCommand, type CommandRegistry } from '../src/commands/index.js';
import { loadSettings } from '../src/config.js';
import { defineLens, defineLenses } from '../src/db/lenses.js';
import { runMigrations } from '../src/db/migrations.js';
import { normalizeSchema } from '../src/db/schema.js';
import { decodeWsFrames, encodeWsFrame } from '../src/http/ws.js';
import { createApp, createHttpServer } from '../src/server.js';

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

const servers: Array<{ close(): void }> = [];
afterEach(() => {
  while (servers.length) servers.pop()!.close();
});

describe('Multiplexed WebSocket, Presence & Advisory Migrations', () => {
  it('encodes and decodes RFC 6455 WebSocket frames', () => {
    const msg = Buffer.from(JSON.stringify({ type: 'ping' }));
    const frame = encodeWsFrame(0x1, msg);
    const decoded = decodeWsFrames(frame);
    expect(decoded.frames).toHaveLength(1);
    expect(decoded.frames[0].opcode).toBe(0x1);
    expect(decoded.frames[0].payload.toString('utf8')).toBe(msg.toString('utf8'));
    expect(decoded.rest.length).toBe(0);
  });

  it('multiplexes lens subscriptions, command calls, and presence over /ws', async () => {
    const broker = createSyncEventBroker();
    const rows = new Map<string, any>();
    let checkpoint = 0;

    const db: any = {
      dialect: 'mysql',
      query: async (sql: string, params: any[] = []) => {
        if (sql.includes('FOR UPDATE')) return [{ checkpoint }];
        if (sql.includes('FROM `_server_changes`')) {
          return [...rows.values()].map((r) => ({
            table_name: 'notes',
            row_id: r.id,
            ts: r.updated_at,
          }));
        }
        if (sql.includes('FROM `notes` WHERE `id` IN')) {
          return [...rows.values()];
        }
        if (sql.includes('FROM `notes` WHERE `id` = ?')) {
          const r = rows.get(params[0]);
          return r ? [r] : [];
        }
        return [];
      },
      execute: async (sql: string, params: any[] = []) => {
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
        return { affectedRows: 1 };
      },
      withTransaction: async (fn: any) => fn(db),
    };

    const commands: CommandRegistry = new Map([
      [
        'notes/add',
        defineCommand<{ title: string }>({
          handler: async ({ db: txDb }, args) =>
            txDb.insert('notes', { title: args.title, scope_id: 'b1' }),
        }),
      ],
    ]);
    const lenses = defineLenses({
      allNotes: defineLens({ table: 'notes' }),
    });

    const app = createApp(
      loadSettings(env),
      db,
      schema,
      commands,
      {},
      broker,
      undefined,
      lenses,
    );
    const server = createHttpServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    const ws1 = new WebSocket(`http://127.0.0.1:${port}/ws?token=admin-key`.replace('http', 'ws'));
    const ws2 = new WebSocket(`http://127.0.0.1:${port}/ws?token=admin-key`.replace('http', 'ws'));

    const inbox1: any[] = [];
    const inbox2: any[] = [];
    ws1.addEventListener('message', (e) => inbox1.push(JSON.parse(String(e.data))));
    ws2.addEventListener('message', (e) => inbox2.push(JSON.parse(String(e.data))));

    await Promise.all([
      new Promise<void>((r) => ws1.addEventListener('open', () => r())),
      new Promise<void>((r) => ws2.addEventListener('open', () => r())),
    ]);

    // Subscribe to lens + join presence room
    ws1.send(JSON.stringify({ type: 'subscribeLens', id: 'sub1', lens: 'allNotes', since: 0 }));
    ws1.send(JSON.stringify({ type: 'presence.join', room: 'unit:101', state: { name: 'Alice' } }));
    ws2.send(JSON.stringify({ type: 'presence.join', room: 'unit:101', state: { name: 'Bob' } }));
    ws2.send(JSON.stringify({ type: 'presence.broadcast', room: 'unit:101', event: 'typing', data: true }));

    // Execute command over WS
    ws2.send(JSON.stringify({ type: 'call', reqId: 'r1', cmd: 'notes/add', args: { title: 'Via WS' } }));

    await new Promise((r) => setTimeout(r, 80));
    ws1.close();
    ws2.close();

    expect(inbox1.some((m) => m.type === 'ready')).toBe(true);
    expect(inbox1.some((m) => m.type === 'presence.state' && m.room === 'unit:101')).toBe(true);
    expect(inbox1.some((m) => m.type === 'presence.event' && m.event === 'typing')).toBe(true);
    expect(
      inbox1.some(
        (m) =>
          m.type === 'deltas' &&
          m.id === 'sub1' &&
          m.changes?.changes?.some((c: any) => c.payload?.title === 'Via WS'),
      ),
    ).toBe(true);
    expect(inbox2.some((m) => m.type === 'commandResult' && m.reqId === 'r1' && m.result?.title === 'Via WS')).toBe(true);
  });

  it('acquires and releases advisory migration locks', async () => {
    const queries: string[] = [];
    const db: any = {
      dialect: 'postgres',
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('FROM _lls_migrations')) return [{ id: '20261127081945_core_schema' }];
        if (sql.includes('information_schema.columns')) return [{ column_name: 'exists' }];
        return [];
      },
      execute: async () => ({ affectedRows: 0 }),
    };

    await runMigrations(db);
    expect(queries[0]).toContain('pg_advisory_lock');
    expect(queries[queries.length - 1]).toContain('pg_advisory_unlock');
  });
});
