import { describe, expect, it } from 'vitest';
import { loadSettings } from '../src/config.js';
import { createApp } from '../src/server.js';
import { normalizeSchema } from '../src/schema.js';
import { createRateLimiter } from '../src/rateLimit.js';

const base = {
  DB_DIALECT: 'mysql',
  DB_HOST: 'h',
  DB_USER: 'u',
  DB_NAME: 'n',
  SERVER_API_KEY: 'secret',
} as NodeJS.ProcessEnv;
const schema = normalizeSchema({ notes: { title: 'string' } });

/** Minimal stateful executor covering the account queries. */
function accountsExecutor() {
  const accounts = new Map<string, any>();
  const ex: any = {
    dialect: 'mysql',
    query: async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM _local_auth_accounts WHERE email')) {
        const a = accounts.get(params[0]);
        return a ? [a] : [];
      }
      if (sql.includes('COUNT(*)')) return [{ n: accounts.size }];
      if (sql.includes('FOR UPDATE')) return [{ checkpoint: 0 }];
      return [];
    },
    execute: async (sql: string, p: any[] = []) => {
      if (sql.startsWith('INSERT INTO _local_auth_accounts')) {
        accounts.set(p[1], {
          id: p[0], email: p[1], display_name: p[2], password_hash: p[3], salt: p[4],
          iterations: p[5], algorithm: p[6], failed_login_attempts: p[7], locked_until: p[8],
          token_version: p[9], created_at: p[10], updated_at: p[11],
        });
      }
      return { affectedRows: 1 };
    },
    withTransaction: async (fn: any) => fn(ex),
  };
  return ex;
}

const post = (app: any, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.fetch(
    new Request(`http://x${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );

describe('accounts', () => {
  it('is disabled without APP_SECRET', async () => {
    const app = createApp(loadSettings(base), accountsExecutor(), schema);
    expect((await post(app, '/auth/signin', {})).status).toBe(503);
  });

  it('signs up and the token works on /sync', async () => {
    const app = createApp(
      loadSettings({ ...base, APP_SECRET: 'x'.repeat(32) }),
      accountsExecutor(),
      schema,
    );
    const res = await post(app, '/auth/signup', {
      mode: 'signup', email: 'a@b.co', password: 'longenough1',
    });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(token).toBeTruthy();

    const ok = await app.fetch(
      new Request('http://x/sync?tables=notes', { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(ok.status).toBe(200);
    const bad = await app.fetch(
      new Request('http://x/sync?tables=notes', { headers: { authorization: 'Bearer nope' } }),
    );
    expect(bad.status).toBe(401);
  });

  it('rate limits /auth', async () => {
    const app = createApp(loadSettings({ ...base, APP_SECRET: 'x'.repeat(32) }), accountsExecutor(), schema);
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await post(app, '/auth/signin', { email: 'z@z.zz', password: 'p' }, { 'x-forwarded-for': '9.9.9.9' })).status;
    expect(last).toBe(429);
  });
});

describe('admin', () => {
  const app = createApp(loadSettings(base), accountsExecutor(), schema);
  it('serves the page publicly but data only with the key', async () => {
    expect((await app.fetch(new Request('http://x/admin'))).status).toBe(200);
    expect((await app.fetch(new Request('http://x/admin/overview'))).status).toBe(401);
    const res = await app.fetch(
      new Request('http://x/admin/overview', { headers: { authorization: 'Bearer secret' } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dbConnected: true, tableCounts: [{ table: 'notes', count: 0 }] });
    expect(
      (await app.fetch(new Request('http://x/admin/table?table=nope', { headers: { authorization: 'Bearer secret' } }))).status,
    ).toBe(400);
  });
  it('can be disabled', async () => {
    const off = createApp(loadSettings({ ...base, ADMIN_UI: 'false' }), accountsExecutor(), schema);
    expect((await off.fetch(new Request('http://x/admin'))).status).toBe(404);
  });

  it('supports row CRUD, logs, backups, storage, env, crons, and settings', async () => {
    const headers = { authorization: 'Bearer secret', 'content-type': 'application/json' };
    const create = await app.fetch(
      new Request('http://x/admin/table', {
        method: 'POST',
        headers,
        body: JSON.stringify({ table: 'notes', row: { title: 'Admin note' } }),
      }),
    );
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };

    expect((await app.fetch(new Request('http://x/admin/table', { method: 'PATCH', headers, body: JSON.stringify({ table: 'notes', row: { id, title: 'Updated' } }) }))).status).toBe(200);
    expect((await app.fetch(new Request(`http://x/admin/table?table=notes&id=${id}`, { method: 'DELETE', headers }))).status).toBe(200);
    expect((await app.fetch(new Request('http://x/admin/logs', { headers }))).status).toBe(200);
    expect((await app.fetch(new Request('http://x/admin/storage', { headers }))).status).toBe(200);
    expect((await app.fetch(new Request('http://x/admin/env', { headers }))).status).toBe(200);
    expect((await app.fetch(new Request('http://x/admin/crons', { headers }))).status).toBe(200);
    expect((await app.fetch(new Request('http://x/admin/settings', { headers }))).status).toBe(200);
  });

  it('reports authenticated: true on GET /admin/login when session cookie is valid', async () => {
    const anon = await (await app.fetch(new Request('http://x/admin/login'))).json() as any;
    expect(anon.authenticated).toBe(false);

    const authed = await (
      await app.fetch(new Request('http://x/admin/login', { headers: { authorization: 'Bearer secret' } }))
    ).json() as any;
    expect(authed.authenticated).toBe(true);
  });

  it('rate limits POST /admin/login', async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) {
      last = (await post(app, '/admin/login', { email: 'z@z.zz', password: 'p' }, { 'x-forwarded-for': '8.8.8.8' })).status;
    }
    expect(last).toBe(429);
  });
});

describe('rate limiter', () => {
  it('resets after the window', () => {
    const l = createRateLimiter(2, 1000);
    expect(l('k', 0).ok).toBe(true);
    expect(l('k', 1).ok).toBe(true);
    expect(l('k', 2).ok).toBe(false);
    expect(l('k', 1001).ok).toBe(true);
  });
});
