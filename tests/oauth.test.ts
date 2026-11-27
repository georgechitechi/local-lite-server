import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings } from '../src/config.js';
import { clearOAuthCacheForTests } from '../src/auth/oauth.js';
import { normalizeSchema } from '../src/db/schema.js';
import { createApp } from '../src/server.js';

const base = {
  DB_DIALECT: 'mysql',
  DB_HOST: 'h',
  DB_USER: 'u',
  DB_NAME: 'n',
  SERVER_API_KEY: 'secret',
} as NodeJS.ProcessEnv;

const schema = normalizeSchema({ notes: { title: 'string' } });
const db: any = {
  dialect: 'mysql',
  query: async () => [],
  execute: async () => ({ affectedRows: 1 }),
  withTransaction: async (fn: any) => fn(db),
};

describe('OAuth token exchange and verification', () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GITHUB_CLIENT_SECRET;
    clearOAuthCacheForTests();
  });

  it('returns 503 when OAuth client secret is not configured', async () => {
    const app = createApp(loadSettings(base), db, schema);
    const gRes = await app.fetch(
      new Request('http://x/auth/google-token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code: 'abc' }),
      }),
    );
    expect(gRes.status).toBe(503);

    const ghRes = await app.fetch(
      new Request('http://x/auth/github-token', {
        method: 'POST',
        body: JSON.stringify({ client_id: 'cid', code: 'abc' }),
      }),
    );
    expect(ghRes.status).toBe(503);
  });

  it('exchanges GitHub code when GITHUB_CLIENT_SECRET is set', async () => {
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret';
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'gho_test_token_12345' }), {
          status: 200,
        }),
      );
    const app = createApp(loadSettings(base), db, schema);
    const res = await app.fetch(
      new Request('http://x/auth/github-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: 'cid', code: 'code123' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: 'gho_test_token_12345' });
  });

  it('authenticates /fn with a valid Google or GitHub OAuth token and caches it', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('googleapis.com/oauth2/v3/userinfo')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sub: 'g-123',
              email: 'u@example.com',
              email_verified: true,
            }),
            {
              status: 200,
            },
          ),
        );
      }
      if (url.includes('api.github.com/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 99, email: 'gh@example.com' }), {
            status: 200,
          }),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    globalThis.fetch = fetchMock;

    const app = createApp(loadSettings(base), db, schema);

    const g1 = await app.fetch(
      new Request('http://x/fn', {
        headers: { Authorization: 'Bearer ya29.google-token-abcdef' },
      }),
    );
    expect(g1.status).toBe(200);

    // Second call uses cache (no extra fetch)
    const g2 = await app.fetch(
      new Request('http://x/fn', {
        headers: { Authorization: 'Bearer ya29.google-token-abcdef' },
      }),
    );
    expect(g2.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const gh = await app.fetch(
      new Request('http://x/fn', {
        headers: { Authorization: 'Bearer gho_github_token_abcdef' },
      }),
    );
    expect(gh.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
