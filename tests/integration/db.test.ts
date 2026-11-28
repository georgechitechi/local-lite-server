import { describe, expect, it } from 'vitest';
import { loadSettings } from '../../src/config.js';
import { createDatabase } from '../../src/db/client.js';
import {
  defineCommand,
  type CommandRegistry,
} from '../../src/commands/index.js';
import { runMigrations } from '../../src/db/migrations.js';
import { defineRules } from '../../src/db/rules.js';
import { applySchema, normalizeSchema } from '../../src/db/schema.js';
import { createApp } from '../../src/server.js';

function parseDbUrl(dialect: 'mysql' | 'postgres', rawUrl: string) {
  const u = new URL(rawUrl);
  return loadSettings({
    DB_DIALECT: dialect,
    DB_HOST: u.hostname,
    DB_PORT: u.port || (dialect === 'postgres' ? '5432' : '3306'),
    DB_USER: decodeURIComponent(u.username),
    DB_PASSWORD: decodeURIComponent(u.password),
    DB_NAME: u.pathname.replace(/^\//, ''),
    SERVER_API_KEY: 'it-admin-key',
    APP_SECRET: 'it-secret-key-0123456789abcdef0123',
  });
}

async function runEngineSuite(dialect: 'mysql' | 'postgres', rawUrl: string) {
  const settings = parseDbUrl(dialect, rawUrl);
  const database = await createDatabase(settings);
  try {
    await runMigrations(database.executor);
    const schema = normalizeSchema({
      it_notes: { title: 'string', user_id: 'string', pinned: 'boolean' },
    });
    await applySchema(database.executor, schema);

    const rules = defineRules({
      it_notes: {
        read: ({ userId }, row) => row.user_id === userId,
        write: ({ userId }, row) => row.user_id === userId,
      },
    });
    const cmds: CommandRegistry = new Map([
      [
        'notes/create',
        defineCommand({
          handler: ({ db }, args: any) => db.insert('it_notes', args),
        }),
      ],
    ]);
    const app = createApp(settings, database.executor, schema, cmds, rules);

    const signup = await app.fetch(
      new Request('http://x/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'signup',
          email: `it-${Date.now()}@example.com`,
          password: 'password123',
        }),
      }),
    );
    expect(signup.status).toBe(200);
    const { token, user } = (await signup.json()) as {
      token: string;
      user: { id: string };
    };

    // RLS blocks writing another user's row
    const blocked = await app.fetch(
      new Request('http://x/sync', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operations: [
            {
              id: 'op1',
              tableName: 'it_notes',
              rowId: 'r-bad',
              operation: 'INSERT',
              timestamp: 1,
              payload: { title: 'No', user_id: 'other', pinned: false },
            },
          ],
        }),
      }),
    );
    expect(blocked.status).toBe(403);

    // Command execution against real SQL engine
    const created = await app.fetch(
      new Request('http://x/cmd/notes/create', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          args: { title: 'Live DB', user_id: user.id, pinned: true },
        }),
      }),
    );
    expect(created.status).toBe(200);

    const pull = await app.fetch(
      new Request('http://x/sync?tables=it_notes&since=0', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(pull.status).toBe(200);
    const pullData = (await pull.json()) as any;
    expect(
      pullData.changes.changes.some((c: any) => c.payload?.title === 'Live DB'),
    ).toBe(true);
  } finally {
    await database.close();
  }
}

describe.runIf(Boolean(process.env.TEST_MYSQL_URL))(
  'Live MySQL integration',
  () => {
    it('runs migrations, RLS, functions, and sync', async () => {
      await runEngineSuite('mysql', process.env.TEST_MYSQL_URL!);
    });
  },
);

describe.runIf(Boolean(process.env.TEST_POSTGRES_URL))(
  'Live PostgreSQL integration',
  () => {
    it('runs migrations, RLS, functions, and sync', async () => {
      await runEngineSuite('postgres', process.env.TEST_POSTGRES_URL!);
    });
  },
);
