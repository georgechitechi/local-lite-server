import { describe, expect, it } from 'vitest';
import { loadSettings } from '../src/config.js';
import { createApp } from '../src/server.js';
import { normalizeSchema, resolveSchemaFile } from '../src/schema.js';
import { ClientError, TableSyncStorage, fromDbRow, toDbValue } from '../src/tableStorage.js';

const env = {
  DB_DIALECT: 'mysql',
  DB_HOST: 'h',
  DB_USER: 'u',
  DB_NAME: 'n',
  SERVER_API_KEY: 'secret',
} as NodeJS.ProcessEnv;

const schema = normalizeSchema({
  notes: { title: 'string', body: 'string | null', pinned: 'boolean', meta: 'json | null', created_at: 'number' },
});

function fakeExecutor() {
  const log: Array<{ sql: string; params?: any[] }> = [];
  const ex: any = {
    dialect: 'mysql',
    log,
    query: async (sql: string, params?: any[]) => {
      log.push({ sql, params });
      if (sql.includes('FOR UPDATE')) return [{ checkpoint: 5 }];
      return [];
    },
    execute: async (sql: string, params?: any[]) => {
      log.push({ sql, params });
      return { affectedRows: 1 };
    },
    withTransaction: async (fn: any) => fn(ex),
  };
  return ex;
}

describe('local-lite-server app', () => {
  const app = createApp(loadSettings(env), fakeExecutor(), schema);

  it('rejects bad dialect and missing vars', () => {
    expect(() => loadSettings({ ...env, DB_DIALECT: 'sqlite' })).toThrow();
    expect(() => loadSettings({})).toThrow(/Missing/);
  });

  it('resolves root schema.ts inside the package repo and rejects invalid schema values', () => {
    expect(resolveSchemaFile().endsWith('schema.ts')).toBe(true);
    expect(resolveSchemaFile().replace(/\\/g, '/')).not.toContain('/src/schema.ts');
    expect(() => normalizeSchema({ bad: (() => {}) as any })).toThrow();
    expect(() => normalizeSchema({ bad: { col: 'invalid' as any } })).toThrow();
  });

  it('serves /health without auth', async () => {
    const res = await app.fetch(new Request('http://x/health'));
    expect(res.status).toBe(200);
  });

  it('requires bearer key on /sync', async () => {
    expect((await app.fetch(new Request('http://x/sync'))).status).toBe(401);
  });

  it('returns 400 for unknown tables', async () => {
    const res = await app.fetch(
      new Request('http://x/sync?tables=nope', { headers: { authorization: 'Bearer secret' } }),
    );
    expect(res.status).toBe(400);
  });

  it('validates operations payload', async () => {
    const res = await app.fetch(
      new Request('http://x/sync', {
        method: 'POST',
        headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('TableSyncStorage', () => {
  it('upserts into the real table and logs table/row/timestamp only', async () => {
    const ex = fakeExecutor();
    const s = new TableSyncStorage(ex, { schema });
    const r = await s.applyOperations([
      { id: 'op1', tableName: 'notes', rowId: 'n1', operation: 'INSERT', timestamp: 1,
        payload: { title: 'Hi', pinned: true, junk: 'ignored' } },
    ]);
    expect(r.successfulIds).toEqual(['op1']);
    expect(r.cursor).toBeGreaterThan(5);
    const upsert = ex.log.find((l: any) => l.sql.includes('INSERT INTO `notes`'))!;
    expect(upsert.sql).not.toContain('junk');
    expect(upsert.params.slice(0, 3)).toEqual(['n1', 'Hi', 1]);
    const change = ex.log.find((l: any) => l.sql.includes('_server_changes'))!;
    expect(change.params.slice(0, 2)).toEqual(['notes', 'n1']);
  });

  it('soft-deletes and rejects unknown tables', async () => {
    const ex = fakeExecutor();
    const s = new TableSyncStorage(ex, { schema });
    await s.applyOperations([{ id: 'd', tableName: 'notes', rowId: 'n1', operation: 'DELETE', timestamp: 1 }]);
    expect(ex.log.some((l: any) => l.sql.startsWith('UPDATE `notes` SET `deleted`'))).toBe(true);
    await expect(
      s.applyOperations([{ id: 'x', tableName: 'nope', rowId: '1', operation: 'INSERT', timestamp: 1 }]),
    ).rejects.toBeInstanceOf(ClientError);
  });

  it('converts values both ways', () => {
    expect(toDbValue('boolean', true, 'mysql')).toBe(1);
    expect(toDbValue('boolean', true, 'postgres')).toBe(true);
    expect(toDbValue('json | null', { a: 1 }, 'mysql')).toBe('{"a":1}');
    const p = fromDbRow(schema.notes, { id: 'n1', title: 'T', pinned: 1, meta: '{"a":1}', deleted: 0, updated_at: '9' });
    expect(p).toMatchObject({ pinned: true, meta: { a: 1 }, deleted: false, updated_at: 9 });
  });
});
