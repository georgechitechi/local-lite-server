import { describe, expect, it } from 'vitest';
import { loadSettings } from '../src/config.js';
import { normalizeSchema } from '../src/db/schema.js';
import { createApp } from '../src/server.js';
import { defineRules } from '../src/db/rules.js';

const env = {
  DB_DIALECT: 'mysql',
  DB_HOST: 'h',
  DB_USER: 'u',
  DB_NAME: 'n',
  SERVER_API_KEY: 'admin-key',
  APP_SECRET: 's'.repeat(32),
} as NodeJS.ProcessEnv;

const schema = normalizeSchema({
  notes: { title: 'string', user_id: 'string', is_public: 'boolean' },
});

const rules = defineRules({
  notes: {
    read: ({ userId }, row) => row.user_id === userId || Boolean(row.is_public),
    write: ({ userId }, row) => row.user_id === userId,
  },
});

function rlsDb() {
  const notes = new Map<string, any>();
  const accounts = new Map<string, any>();
  const changes: Array<{ table_name: string; row_id: string; ts: number }> = [];
  let checkpoint = 0;

  const ex: any = {
    dialect: 'mysql',
    query: async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM _local_auth_accounts WHERE email')) {
        const u = accounts.get(params[0]);
        return u ? [u] : [];
      }
      if (sql.includes('FOR UPDATE')) return [{ checkpoint }];
      if (sql.includes('FROM `_server_changes`')) {
        return changes.filter((c) => c.ts > Number(params[0]));
      }
      if (sql.includes('FROM `notes` WHERE `id` IN')) {
        return params.map((id) => notes.get(id)).filter(Boolean);
      }
      if (sql.includes('FROM `notes` WHERE `id` = ?')) {
        const r = notes.get(params[0]);
        return r ? [r] : [];
      }
      return [];
    },
    execute: async (sql: string, p: any[] = []) => {
      if (sql.startsWith('INSERT INTO _local_auth_accounts')) {
        accounts.set(p[1], {
          id: p[0], email: p[1], display_name: p[2], password_hash: p[3], salt: p[4],
          iterations: p[5], algorithm: p[6], failed_login_attempts: p[7], locked_until: p[8],
          token_version: p[9], created_at: p[10], updated_at: p[11],
        });
      } else if (sql.startsWith('INSERT INTO `notes`')) {
        const [id, title, user_id, is_public, updated_at, deleted] = p;
        notes.set(id, { id, title, user_id, is_public, updated_at, deleted });
      } else if (sql.startsWith('UPDATE `notes` SET `deleted`')) {
        const [deleted, updated_at, id] = p;
        const r = notes.get(id);
        if (r) Object.assign(r, { deleted, updated_at });
      } else if (sql.includes('INSERT INTO `_server_changes`')) {
        changes.push({ table_name: p[0], row_id: p[1], ts: p[2] });
      } else if (sql.includes('UPDATE `_server_sync_clock`')) {
        checkpoint = Number(p[0]);
      }
      return { affectedRows: 1 };
    },
    withTransaction: async (fn: any) => fn(ex),
  };
  return ex;
}

async function signup(app: any, email: string) {
  const res = await app.fetch(
    new Request('http://x/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'signup', email, password: 'password123' }),
    }),
  );
  return (await res.json()) as { token: string; user: { id: string } };
}

describe('Row-Level Access Control (RLS)', () => {
  it('enforces read and write rules per user while allowing admin bypass', async () => {
    const app = createApp(loadSettings(env), rlsDb(), schema, new Map(), rules);
    const u1 = await signup(app, 'u1@example.com');
    const u2 = await signup(app, 'u2@example.com');

    // u1 cannot write a row owned by u2
    const denied = await app.fetch(
      new Request('http://x/sync', {
        method: 'POST',
        headers: { authorization: `Bearer ${u1.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          operations: [{
            id: 'op1', tableName: 'notes', rowId: 'n1', operation: 'INSERT', timestamp: 1,
            payload: { title: 'Spoofed', user_id: u2.user.id, is_public: false },
          }],
        }),
      }),
    );
    expect(denied.status).toBe(403);

    // u1 can write own private + public rows
    const ok = await app.fetch(
      new Request('http://x/sync', {
        method: 'POST',
        headers: { authorization: `Bearer ${u1.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          operations: [
            { id: 'op2', tableName: 'notes', rowId: 'n-priv', operation: 'INSERT', timestamp: 1,
              payload: { title: 'Private', user_id: u1.user.id, is_public: false } },
            { id: 'op3', tableName: 'notes', rowId: 'n-pub', operation: 'INSERT', timestamp: 2,
              payload: { title: 'Public', user_id: u1.user.id, is_public: true } },
          ],
        }),
      }),
    );
    expect(ok.status).toBe(200);

    // u2 cannot delete u1's row
    const delDenied = await app.fetch(
      new Request('http://x/sync', {
        method: 'POST',
        headers: { authorization: `Bearer ${u2.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          operations: [{ id: 'op4', tableName: 'notes', rowId: 'n-priv', operation: 'DELETE', timestamp: 3 }],
        }),
      }),
    );
    expect(delDenied.status).toBe(403);

    // u2 pull only sees public row
    const u2Pull = (await (
      await app.fetch(new Request('http://x/sync?tables=notes&since=0', {
        headers: { authorization: `Bearer ${u2.token}` },
      }))
    ).json()) as any;
    expect(u2Pull.changes.changes.map((c: any) => c.rowId)).toEqual(['n-pub']);

    // admin key sees both rows
    const adminPull = (await (
      await app.fetch(new Request('http://x/sync?tables=notes&since=0', {
        headers: { authorization: 'Bearer admin-key' },
      }))
    ).json()) as any;
    expect(adminPull.changes.changes.map((c: any) => c.rowId)).toEqual(['n-priv', 'n-pub']);
  });

  it('supports a dedicated delete rule distinct from write', async () => {
    const db = rlsDb();
    const deleteRules = defineRules({
      notes: {
        write: ({ userId }, row) => row.user_id === userId,
        delete: ({ isAdmin }) => isAdmin,
      },
    });
    const app = createApp(loadSettings(env), db, schema, new Map(), deleteRules);
    const u1 = await signup(app, 'u1@example.com');

    // User can create their own note
    const createRes = await app.fetch(
      new Request('http://x/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${u1.token}` },
        body: JSON.stringify({
          operations: [{
            tableName: 'notes',
            rowId: 'n-1',
            operation: 'INSERT',
            payload: { title: 'mine', user_id: u1.user.id, is_public: false },
          }],
        }),
      }),
    );
    expect(createRes.status).toBe(200);

    // User cannot delete it because delete rule requires admin
    const delUser = await app.fetch(
      new Request('http://x/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${u1.token}` },
        body: JSON.stringify({
          operations: [{ tableName: 'notes', rowId: 'n-1', operation: 'DELETE', payload: {} }],
        }),
      }),
    );
    expect(delUser.status).toBe(403);

    // Admin can delete it
    const delAdmin = await app.fetch(
      new Request('http://x/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer admin-key' },
        body: JSON.stringify({
          operations: [{ tableName: 'notes', rowId: 'n-1', operation: 'DELETE', payload: {} }],
        }),
      }),
    );
    expect(delAdmin.status).toBe(200);
  });

  it('supports shorthand rule presets (authenticated, owner:<col>, admin)', async () => {
    const db = rlsDb();
    const presetRules = defineRules({
      notes: {
        read: 'authenticated',
        write: 'owner:user_id',
        delete: 'admin',
      },
    });
    const app = createApp(loadSettings(env), db, schema, new Map(), presetRules);
    const u1 = await signup(app, 'u1@example.com');
    const u2 = await signup(app, 'u2@example.com');

    // u1 can insert their own note
    const okInsert = await app.fetch(
      new Request('http://x/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${u1.token}` },
        body: JSON.stringify({
          operations: [{
            tableName: 'notes',
            rowId: 'n-preset',
            operation: 'INSERT',
            payload: { title: 'hello', user_id: u1.user.id, is_public: false },
          }],
        }),
      }),
    );
    expect(okInsert.status).toBe(200);

    // u2 cannot overwrite u1's note
    const deniedWrite = await app.fetch(
      new Request('http://x/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${u2.token}` },
        body: JSON.stringify({
          operations: [{
            tableName: 'notes',
            rowId: 'n-preset',
            operation: 'UPDATE',
            payload: { title: 'hijack', user_id: u2.user.id, is_public: false },
          }],
        }),
      }),
    );
    expect(deniedWrite.status).toBe(403);

    // u2 can read because read is 'authenticated'
    const u2Pull = (await (
      await app.fetch(new Request('http://x/sync?tables=notes&since=0', {
        headers: { authorization: `Bearer ${u2.token}` },
      }))
    ).json()) as any;
    expect(u2Pull.changes.changes.map((c: any) => c.rowId)).toEqual(['n-preset']);

    // u1 cannot delete because delete is 'admin'
    const deniedDel = await app.fetch(
      new Request('http://x/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${u1.token}` },
        body: JSON.stringify({
          operations: [{ tableName: 'notes', rowId: 'n-preset', operation: 'DELETE', payload: {} }],
        }),
      }),
    );
    expect(deniedDel.status).toBe(403);
  });
});
