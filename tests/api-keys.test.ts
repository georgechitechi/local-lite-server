import { describe, expect, it, vi } from 'vitest';
import { createApiKeyService } from '../src/auth/apiKeys.js';
import { loadSettings } from '../src/config.js';
import { normalizeSchema } from '../src/db/schema.js';
import { createApp } from '../src/server.js';

const base = {
  DB_DIALECT: 'mysql',
  DB_HOST: 'h',
  DB_USER: 'u',
  DB_NAME: 'n',
  SERVER_API_KEY: 'master-secret',
} as NodeJS.ProcessEnv;

const schema = normalizeSchema({
  notes: { title: 'string', owner_id: 'string' },
});

function apiKeysExecutor() {
  const keys = new Map<string, any>();
  const ex: any = {
    dialect: 'mysql',
    query: async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM _lls_api_keys WHERE key_hash = ?')) {
        for (const row of keys.values()) {
          if (row.key_hash === params[0]) return [row];
        }
        return [];
      }
      if (sql.includes('FROM _lls_api_keys')) {
        return Array.from(keys.values()).sort(
          (a, b) => b.created_at - a.created_at,
        );
      }
      return [];
    },
    execute: async (sql: string, params: any[] = []) => {
      if (sql.startsWith('INSERT INTO _lls_api_keys')) {
        keys.set(params[0], {
          id: params[0],
          name: params[1],
          key_prefix: params[2],
          key_hash: params[3],
          role: params[4],
          user_id: params[5],
          project_id: params[6],
          created_by: params[7],
          last_used_at: null,
          expires_at: params[8],
          revoked_at: null,
          created_at: params[9],
        });
        return { affectedRows: 1 };
      }
      if (sql.startsWith('UPDATE _lls_api_keys SET revoked_at')) {
        const row = keys.get(params[1]);
        if (!row || row.revoked_at != null) return { affectedRows: 0 };
        row.revoked_at = params[0];
        return { affectedRows: 1 };
      }
      if (sql.startsWith('UPDATE _lls_api_keys SET last_used_at')) {
        const row = keys.get(params[1]);
        if (row) row.last_used_at = params[0];
        return { affectedRows: 1 };
      }
      if (sql.startsWith('DELETE FROM _lls_api_keys')) {
        const existed = keys.delete(params[0]);
        return { affectedRows: existed ? 1 : 0 };
      }
      return { affectedRows: 0 };
    },
    withTransaction: async (fn: any) => fn(ex),
  };
  return ex;
}

describe('apiKeys', () => {
  it('creates, verifies, authenticates requests, and revokes/deletes API keys', async () => {
    const db = apiKeysExecutor();
    const svc = createApiKeyService(db);
    const app = createApp(loadSettings(base), db, schema);

    const created = await svc.createKey({ name: 'Mobile App', role: 'admin' });
    expect(created.key).toMatch(/^lls_/);
    expect(created.record.keyPrefix).toContain('lls_');

    // Bearer header works
    const resBearer = await app.fetch(
      new Request('http://x/fn', {
        headers: { Authorization: `Bearer ${created.key}` },
      }),
    );
    expect(resBearer.status).toBe(200);

    // X-API-Key header works
    const resHeader = await app.fetch(
      new Request('http://x/fn', {
        headers: { 'X-API-Key': created.key },
      }),
    );
    expect(resHeader.status).toBe(200);

    // Revoking immediately blocks access
    expect(await svc.revokeKey(created.record.id)).toBe(true);
    const resRevoked = await app.fetch(
      new Request('http://x/fn', {
        headers: { Authorization: `Bearer ${created.key}` },
      }),
    );
    expect(resRevoked.status).toBe(401);

    // Deleting removes it from listKeys
    expect(await svc.deleteKey(created.record.id)).toBe(true);
    expect(await svc.listKeys()).toHaveLength(0);
  });

  it('supports user-scoped keys and rejects expired keys', async () => {
    const db = apiKeysExecutor();
    const svc = createApiKeyService(db);

    const userKey = await svc.createKey({
      name: 'User Scoped',
      role: 'user',
      userId: 'user_42',
    });
    const verified = await svc.verifyKey(userKey.key);
    expect(verified).toEqual({
      id: userKey.record.id,
      isAdmin: false,
      userId: 'user_42',
    });

    // Expired key cannot verify
    const now = Date.now();
    const expiredKey = await svc.createKey({
      name: 'Short Lived',
      role: 'admin',
      expiresAt: now + 10_000,
    });
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 20_000);
    try {
      expect(await svc.verifyKey(expiredKey.key)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
