import { describe, expect, it } from 'vitest';
import { defineCommand } from '../src/commands/index.js';
import { loadSettings } from '../src/config.js';
import { defineLens, defineLenses } from '../src/db/lenses.js';
import { defineProjection, defineProjections } from '../src/db/projections.js';
import { normalizeSchema } from '../src/db/schema.js';
import { createApp } from '../src/server.js';

const env = {
  DB_DIALECT: 'mysql',
  DB_HOST: 'h',
  DB_USER: 'u',
  DB_NAME: 'n',
  SERVER_API_KEY: 'admin-key',
} as NodeJS.ProcessEnv;

const schema = normalizeSchema({
  notes: { title: 'string' },
});

describe('Full v2 Dashboard & APIs', () => {
  it('serves /dashboard, /stats, /stats.json, and all dashboard management APIs', async () => {
    const notes = new Map<string, any>([
      ['n1', { id: 'n1', title: 'Hello', updated_at: 10, deleted: 0 }],
    ]);
    const outbox = new Map<string, any>([
      ['ob1', { id: 'ob1', topic: 'rent.paid', payload_json: '{}', status: 'dead_letter', attempts: 3, last_error: 'timeout', created_at: 5 }],
      ['ob2', { id: 'ob2', topic: 'ok', payload_json: '{}', status: 'delivered', attempts: 1, last_error: null, created_at: 6 }],
    ]);
    let checkpoint = 42;
    let compactedFloor = 10;

    const db: any = {
      dialect: 'mysql',
      query: async (sql: string, params: any[] = []) => {
        if (sql.includes('SELECT checkpoint, compacted_floor')) {
          return [{ checkpoint, compacted_floor: compactedFloor }];
        }
        if (sql.includes('FOR UPDATE')) return [{ checkpoint }];
        if (sql.includes('SELECT COUNT(*) AS n FROM `_server_changes`')) return [{ n: 7 }];
        if (sql.includes('FROM `_server_outbox` GROUP BY status')) {
          return [
            { status: 'dead_letter', n: 1 },
            { status: 'delivered', n: 1 },
          ];
        }
        if (sql.includes('FROM `_server_outbox`')) return [...outbox.values()];
        if (sql.includes('FROM `_server_changes`')) {
          return [{ id: 1, table_name: 'notes', row_id: 'n1', ts: 42 }];
        }
        if (sql.includes('SELECT COUNT(*) AS n FROM `notes`')) {
          return [{ n: [...notes.values()].filter((r) => !r.deleted).length }];
        }
        if (sql.includes('FROM `notes`')) return [...notes.values()].filter((r) => !r.deleted);
        if (sql.includes('FROM _lls_api_keys')) return [];
        if (sql.includes('FROM _local_auth_accounts')) return [];
        return [];
      },
      execute: async (sql: string, params: any[] = []) => {
        if (sql.startsWith('UPDATE `_server_sync_clock` SET checkpoint')) {
          checkpoint = Number(params[0]);
        } else if (sql.startsWith('UPDATE `_server_sync_clock` SET compacted_floor')) {
          compactedFloor = Number(params[0]);
        } else if (sql.startsWith('INSERT INTO `notes`')) {
          notes.set(params[0], { id: params[0], title: params[1], updated_at: params[2], deleted: params[3] });
        } else if (sql.startsWith('UPDATE `notes` SET `deleted`')) {
          const r = notes.get(params[2]);
          if (r) r.deleted = params[0];
        } else if (sql.startsWith('UPDATE `_server_outbox` SET status = ?, next_attempt_at = ?')) {
          const r = outbox.get(params[2]);
          if (r) r.status = params[0];
        } else if (sql.startsWith('DELETE FROM `_server_outbox`')) {
          for (const [k, v] of outbox) if (v.status === params[0]) outbox.delete(k);
        }
        return { affectedRows: 1 };
      },
      withTransaction: async (fn: any) => fn(db),
    };

    const app = createApp(
      loadSettings(env),
      db,
      schema,
      new Map([['notes/add', defineCommand({ handler: () => ({}) })]]),
      {},
      undefined,
      undefined,
      defineLenses({ allNotes: defineLens({ table: 'notes' }) }),
      defineProjections({ countNotes: defineProjection({ on: 'notes', handler: () => {} }) }),
    );

    const authHeader = { Authorization: 'Bearer admin-key' };

    // HTML routes
    const dashHtml = await app.fetch(new Request('http://localhost/dashboard'));
    expect(dashHtml.status).toBe(200);
    expect(await dashHtml.text()).toContain('local-lite-server — Dashboard');

    const statsHtml = await app.fetch(new Request('http://localhost/stats'));
    expect(statsHtml.status).toBe(200);

    // Unauthorized guard
    expect((await app.fetch(new Request('http://localhost/stats.json'))).status).toBe(401);
    expect((await app.fetch(new Request('http://localhost/dashboard/api/rows?table=notes'))).status).toBe(401);

    // /stats.json
    const statsJson = (await (await app.fetch(new Request('http://localhost/stats.json', { headers: authHeader }))).json()) as any;
    expect(statsJson.sync.checkpoint).toBe(42);
    expect(statsJson.lenses).toEqual(['allNotes']);

    // Data browser insert + list + remove
    const ins = await app.fetch(
      new Request('http://localhost/dashboard/api/rows', {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'insert', table: 'notes', data: { title: 'Inserted' } }),
      }),
    );
    expect(ins.status).toBe(200);
    const listed = (await (await app.fetch(new Request('http://localhost/dashboard/api/rows?table=notes', { headers: authHeader }))).json()) as any;
    expect(listed.rows).toHaveLength(2);

    // Outbox retry + purge
    await app.fetch(
      new Request('http://localhost/dashboard/api/outbox/retry', {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'ob1' }),
      }),
    );
    expect(outbox.get('ob1').status).toBe('pending');
    await app.fetch(new Request('http://localhost/dashboard/api/outbox/purge', { method: 'POST', headers: authHeader }));
    expect(outbox.has('ob2')).toBe(false);

    // Change log + compaction
    const ch = (await (await app.fetch(new Request('http://localhost/dashboard/api/changes', { headers: authHeader }))).json()) as any;
    expect(ch.rows).toHaveLength(1);
    const cmp = (await (await app.fetch(
      new Request('http://localhost/dashboard/api/changes/compact', {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays: 1 }),
      }),
    )).json()) as any;
    expect(cmp.success).toBe(true);

    // Auth & keys
    const authData = (await (await app.fetch(new Request('http://localhost/dashboard/api/auth', { headers: authHeader }))).json()) as any;
    expect(Array.isArray(authData.keys)).toBe(true);

    // Disabled via DASHBOARD_ENABLED=false
    const disabledApp = createApp(
      loadSettings({ ...env, DASHBOARD_ENABLED: 'false' }),
      db,
      schema,
    );
    expect((await disabledApp.fetch(new Request('http://localhost/dashboard'))).status).toBe(404);
    expect((await disabledApp.fetch(new Request('http://localhost/stats.json', { headers: authHeader }))).status).toBe(404);
  });
});
