import { describe, expect, it } from 'vitest';
import { loadSettings } from '../src/config.js';
import {
  defineAction,
  defineMutation,
  defineQuery,
  FunctionError,
  loadFunctionsDir,
  type FunctionRegistry,
} from '../src/functions/index.js';
import { normalizeSchema } from '../src/db/schema.js';
import { createApp } from '../src/server.js';

const env = {
  DB_DIALECT: 'mysql',
  DB_HOST: 'h',
  DB_USER: 'u',
  DB_NAME: 'n',
  SERVER_API_KEY: 'secret',
} as NodeJS.ProcessEnv;

const schema = normalizeSchema({
  notes: {
    title: 'string',
    body: 'string | null',
    pinned: 'boolean',
    created_at: 'number',
  },
});

/** In-memory SQLite-like mock for notes + sync clock/changes. */
function inMemoryNotesDb() {
  const notes = new Map<string, any>();
  let checkpoint = 10;
  const changes: any[] = [];

  const ex: any = {
    dialect: 'mysql',
    notes,
    changes,
    query: async (sql: string, params: any[] = []) => {
      if (sql.includes('FOR UPDATE')) return [{ checkpoint }];
      if (sql.includes('FROM `notes` WHERE `id` = ?')) {
        const r = notes.get(params[0]);
        return r && !r.deleted ? [r] : [];
      }
      if (sql.includes('FROM `notes`')) {
        return [...notes.values()].filter((r) => !r.deleted);
      }
      return [];
    },
    execute: async (sql: string, params: any[] = []) => {
      if (sql.startsWith('INSERT INTO `notes`')) {
        const [id, title, body, pinned, updated_at, deleted, created_at] =
          params;
        notes.set(id, {
          id,
          title,
          body,
          pinned,
          updated_at,
          deleted,
          created_at,
        });
      } else if (sql.startsWith('UPDATE `notes` SET `pinned`')) {
        const [pinned, updated_at, id] = params;
        const row = notes.get(id);
        if (row) Object.assign(row, { pinned, updated_at });
      } else if (sql.startsWith('UPDATE `notes` SET `deleted`')) {
        const [deleted, updated_at, id] = params;
        const row = notes.get(id);
        if (row) Object.assign(row, { deleted, updated_at });
      } else if (sql.includes('INSERT INTO `_server_changes`')) {
        changes.push({ table: params[0], rowId: params[1], ts: params[2] });
      } else if (sql.includes('UPDATE `_server_sync_clock`')) {
        checkpoint = Number(params[0]);
      }
      return { affectedRows: 1 };
    },
    withTransaction: async (fn: any) => fn(ex),
  };
  return ex;
}

function buildRegistry(): FunctionRegistry {
  const reg: FunctionRegistry = new Map();
  reg.set(
    'notes/list',
    defineQuery({
      handler: ({ db }) => db.list('notes'),
    }),
  );
  reg.set(
    'notes/create',
    defineMutation({
      args: (raw) => {
        if (typeof raw.title !== 'string' || !raw.title.trim()) {
          throw new FunctionError('title is required.');
        }
        return {
          title: raw.title.trim(),
          body: null,
          pinned: Boolean(raw.pinned),
        };
      },
      handler: ({ db }, args) => db.insert('notes', args),
    }),
  );
  reg.set(
    'notes/togglePin',
    defineMutation({
      handler: async ({ db }, args: { id: string }) => {
        const n = await db.get('notes', args.id);
        if (!n) throw new FunctionError('Not found.', 404);
        return db.patch('notes', args.id, { pinned: !n.pinned });
      },
    }),
  );
  reg.set(
    'notes/createAndList',
    defineAction({
      handler: async (ctx, args: { title: string }) => {
        const created = await ctx.runMutation('notes/create', {
          title: args.title,
        });
        const all = await ctx.runQuery<any[]>('notes/list');
        return { created, count: all.length };
      },
    }),
  );
  return reg;
}

describe('Server functions & reactive queries', () => {
  it('loads functions/notes.ts from disk', async () => {
    const reg = await loadFunctionsDir('functions');
    expect([...reg.keys()]).toEqual(
      expect.arrayContaining(['notes/list', 'notes/create', 'notes/togglePin']),
    );
  });

  it('lists and runs queries, mutations, and actions via HTTP', async () => {
    const db = inMemoryNotesDb();
    const app = createApp(loadSettings(env), db, schema, buildRegistry());
    const auth = {
      authorization: 'Bearer secret',
      'content-type': 'application/json',
    };

    const listRes = await app.fetch(
      new Request('http://x/fn', { headers: auth }),
    );
    expect(listRes.status).toBe(200);
    expect(((await listRes.json()) as any).functions.length).toBe(4);

    const bad = await app.fetch(
      new Request('http://x/fn/notes/create', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ args: { title: '' } }),
      }),
    );
    expect(bad.status).toBe(400);

    const created = await app.fetch(
      new Request('http://x/fn/notes/create', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ args: { title: 'Hello' } }),
      }),
    );
    expect(created.status).toBe(200);
    const createdJson = (await created.json()) as any;
    expect(createdJson.result.title).toBe('Hello');
    expect(db.changes.length).toBe(1);

    const actionRes = await app.fetch(
      new Request('http://x/fn/notes/createAndList', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ args: { title: 'Second' } }),
      }),
    );
    expect(actionRes.status).toBe(200);
    expect(((await actionRes.json()) as any).result.count).toBe(2);
  });

  it('streams reactive query updates over SSE on /subscribe', async () => {
    const db = inMemoryNotesDb();
    const app = createApp(loadSettings(env), db, schema, buildRegistry());

    const subRes = await app.fetch(
      new Request('http://x/subscribe/notes/list?token=secret'),
    );
    expect(subRes.status).toBe(200);
    expect(subRes.headers.get('content-type')).toContain('text/event-stream');

    const reader = subRes.body!.getReader();
    const dec = new TextDecoder();

    const first = await reader.read();
    expect(dec.decode(first.value)).toContain('event: data\ndata: []');

    // Trigger a mutation on the tracked `notes` table
    await app.fetch(
      new Request('http://x/fn/notes/create', {
        method: 'POST',
        headers: {
          authorization: 'Bearer secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ args: { title: 'Live' } }),
      }),
    );

    const second = await reader.read();
    const chunk = dec.decode(second.value);
    expect(chunk).toContain('event: data');
    expect(chunk).toContain('"title":"Live"');
    await reader.cancel();
  });

  it('returns 404 for unknown functions', async () => {
    const db = inMemoryNotesDb();
    const app = createApp(loadSettings(env), db, schema, buildRegistry());
    const res = await app.fetch(
      new Request('http://x/fn/notes/missing', {
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
      }),
    );
    expect(res.status).toBe(404);
  });
});
