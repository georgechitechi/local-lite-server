import { describe, expect, it } from 'vitest';
import { createSyncEventBroker } from 'local-lite/server';
import { loadSettings } from '../src/config.js';
import {
  compileLensWhereSql,
  compileRlsSqlFilter,
  defineLens,
  defineLenses,
} from '../src/db/lenses.js';
import { compactChangeLog } from '../src/core/changes.js';
import { defineRules } from '../src/db/rules.js';
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
  units: {
    building_id: 'string',
    user_id: 'string',
    code: 'string',
    rent: 'number',
    notes: 'string',
  },
});

describe('Sync Lenses & RLS SQL Pushdown', () => {
  it('compiles declarative rule presets into SQL WHERE clauses', () => {
    const rules = defineRules({
      units: { read: 'owner' },
    });
    const fields = schema.units;

    const ownerSql = compileRlsSqlFilter(
      rules.units.read,
      { isAdmin: false, userId: 'u1' },
      fields,
      'mysql',
    );
    expect(ownerSql.denied).toBe(false);
    expect(ownerSql.needsJsCheck).toBe(false);
    expect(ownerSql.clauses).toEqual(['`user_id` = ?']);
    expect(ownerSql.params).toEqual(['u1']);

    const unauthSql = compileRlsSqlFilter(
      rules.units.read,
      { isAdmin: false },
      fields,
      'postgres',
    );
    expect(unauthSql.denied).toBe(true);

    const customRules = defineRules({
      units: { read: (_ctx, row) => row.rent > 0 },
    });
    const customSql = compileRlsSqlFilter(
      customRules.units.read,
      { isAdmin: false, userId: 'u1' },
      fields,
      'mysql',
    );
    expect(customSql.needsJsCheck).toBe(true);
  });

  it('compiles lens where filters and rejects unknown columns', () => {
    const res = compileLensWhereSql(
      { building_id: 'b1', code: ['A1', 'A2'], notes: null },
      schema.units,
      'postgres',
    );
    expect(res.empty).toBe(false);
    expect(res.clauses).toEqual([
      '"building_id" = ?',
      '"code" IN (?, ?)',
      '"notes" IS NULL',
    ]);
    expect(res.params).toEqual(['b1', 'A1', 'A2']);

    const emptyIn = compileLensWhereSql(
      { code: [] },
      schema.units,
      'mysql',
    );
    expect(emptyIn.empty).toBe(true);

    expect(() =>
      compileLensWhereSql({ bogus: 'x' }, schema.units, 'mysql'),
    ).toThrow(/Unknown lens filter column/);
  });

  it('serves GET /sync/lens/:name with SQL-pushed filters and column projection', async () => {
    const executedQueries: Array<{ sql: string; params: unknown[] }> = [];
    const rows = [
      {
        id: 'u1',
        building_id: 'b1',
        user_id: 'user-1',
        code: '101',
        rent: 1200,
        notes: 'secret',
        updated_at: 10,
        deleted: 0,
      },
      {
        id: 'u2',
        building_id: 'b2',
        user_id: 'user-1',
        code: '201',
        rent: 1500,
        notes: 'other',
        updated_at: 11,
        deleted: 0,
      },
    ];

    const db: any = {
      dialect: 'mysql',
      query: async (sql: string, params: unknown[] = []) => {
        executedQueries.push({ sql, params });
        if (sql.includes('FROM `_server_changes`')) {
          return [
            { table_name: 'units', row_id: 'u1', ts: 10 },
            { table_name: 'units', row_id: 'u2', ts: 11 },
          ];
        }
        if (sql.includes('FROM `units`')) {
          // Simulate SQL-level filtering by building_id = params[2]
          return rows.filter((r) => r.building_id === params[2]);
        }
        return [];
      },
      execute: async () => ({ rowsAffected: 0 }),
      withTransaction: async (fn: any) => fn(db),
    };

    const lenses = defineLenses({
      buildingUnits: defineLens<{ buildingId: string }>({
        table: 'units',
        columns: ['building_id', 'code', 'rent'],
        where: (_ctx, args) => ({ building_id: args.buildingId }),
      }),
    });

    const app = createApp(
      loadSettings(env),
      db,
      schema,
      new Map(),
      defineRules({ units: { read: 'authenticated' } }),
      undefined,
      undefined,
      lenses,
    );

    const missing = await app.fetch(
      new Request('http://localhost/sync/lens/unknown', {
        headers: { Authorization: 'Bearer admin-key' },
      }),
    );
    expect(missing.status).toBe(404);

    const res = await app.fetch(
      new Request(
        'http://localhost/sync/lens/buildingUnits?since=0&args=' +
          encodeURIComponent(JSON.stringify({ buildingId: 'b1' })),
        { headers: { Authorization: 'Bearer admin-key' } },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.cursor).toBe(11);
    expect(body.changes.changes).toHaveLength(2);
    // u1 matches building_id = b1 and only projects requested columns
    expect(body.changes.changes[0]).toMatchObject({
      rowId: 'u1',
      operation: 'UPDATE',
      payload: {
        building_id: 'b1',
        code: '101',
        rent: 1200,
        updated_at: 10,
        deleted: false,
      },
    });
    expect(body.changes.changes[0].payload.notes).toBeUndefined();
    // u2 did not match building_id = b1, so it surfaces as DELETE tombstone for this lens
    expect(body.changes.changes[1]).toMatchObject({
      rowId: 'u2',
      operation: 'DELETE',
      payload: null,
    });
    // Verify SQL pushdown clause was generated
    const unitSelect = executedQueries.find((q) =>
      q.sql.includes('FROM `units`'),
    );
    expect(unitSelect?.sql).toContain('`building_id` = ?');
  });

  it('streams lens delta events over SSE and skips unrelated column patches', async () => {
    const broker = createSyncEventBroker();
    let ts = 0;
    const db: any = {
      dialect: 'mysql',
      query: async (sql: string) => {
        if (sql.includes('FROM `_server_changes`')) {
          return ts > 0
            ? [{ table_name: 'units', row_id: 'u1', ts }]
            : [];
        }
        if (sql.includes('FROM `units`')) {
          return [
            {
              id: 'u1',
              building_id: 'b1',
              user_id: 'user-1',
              code: '101',
              rent: 1350,
              notes: 'internal',
              updated_at: ts,
              deleted: 0,
            },
          ];
        }
        return [];
      },
      execute: async () => ({ rowsAffected: 0 }),
      withTransaction: async (fn: any) => fn(db),
    };

    const lenses = defineLenses({
      buildingUnits: defineLens<{ buildingId: string }>({
        table: 'units',
        columns: ['building_id', 'code', 'rent'],
        where: (_ctx, args) => ({ building_id: args.buildingId }),
      }),
    });

    const app = createApp(
      loadSettings(env),
      db,
      schema,
      new Map(),
      {},
      broker,
      undefined,
      lenses,
    );

    const res = await app.fetch(
      new Request(
        'http://localhost/sync/lens/buildingUnits/events?since=0&args=' +
          encodeURIComponent(JSON.stringify({ buildingId: 'b1' })),
        { headers: { Authorization: 'Bearer admin-key' } },
      ),
    );
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain('event: connected');

    // Patch to non-projected, non-filter column `notes` should be ignored
    ts = 5;
    broker.publish({
      scopeId: 'default',
      tableName: 'units',
      checkpoint: 5,
      rowId: 'u1',
      op: 'patch',
      changedCols: ['notes'],
    });

    // Patch to projected column `rent` should trigger deltas event
    ts = 6;
    broker.publish({
      scopeId: 'default',
      tableName: 'units',
      checkpoint: 6,
      rowId: 'u1',
      op: 'patch',
      changedCols: ['rent'],
    });

    const next = await reader.read();
    const text = decoder.decode(next.value);
    expect(text).toContain('event: deltas');
    expect(text).toContain('"rent":1350');
    await reader.cancel();
  });

  it('exports consistent NDJSON/JSON lens snapshots and signals resyncRequired after compaction', async () => {
    let compactedFloor = 0;
    let deletedCount = 0;
    const db: any = {
      dialect: 'mysql',
      query: async (sql: string) => {
        if (sql.includes('SELECT compacted_floor')) {
          return [{ compacted_floor: compactedFloor }];
        }
        if (sql.includes('SELECT checkpoint, compacted_floor')) {
          return [{ checkpoint: 250, compacted_floor: compactedFloor }];
        }
        if (sql.includes('SELECT checkpoint FROM')) {
          return [{ checkpoint: 250 }];
        }
        if (sql.includes('FROM `units`')) {
          return [
            {
              id: 'u1',
              building_id: 'b1',
              user_id: 'user-1',
              code: '101',
              rent: 1200,
              notes: 'ok',
              updated_at: 250,
              deleted: 0,
            },
          ];
        }
        return [];
      },
      execute: async (sql: string, params: unknown[] = []) => {
        if (sql.startsWith('DELETE FROM `_server_changes`')) {
          deletedCount = 3;
          return { affectedRows: 3 };
        }
        if (sql.startsWith('UPDATE `_server_sync_clock` SET compacted_floor')) {
          compactedFloor = Number(params[0]);
        }
        return { affectedRows: 1 };
      },
      withTransaction: async (fn: any) => fn(db),
    };

    const lenses = defineLenses({
      buildingUnits: defineLens<{ buildingId: string }>({
        table: 'units',
        columns: ['building_id', 'code', 'rent'],
        where: (_ctx, args) => ({ building_id: args.buildingId }),
      }),
    });

    const app = createApp(
      loadSettings(env),
      db,
      schema,
      new Map(),
      {},
      undefined,
      undefined,
      lenses,
    );

    const ndjsonRes = await app.fetch(
      new Request(
        'http://localhost/sync/snapshot/buildingUnits?args=' +
          encodeURIComponent(JSON.stringify({ buildingId: 'b1' })),
        { headers: { Authorization: 'Bearer admin-key' } },
      ),
    );
    expect(ndjsonRes.status).toBe(200);
    expect(ndjsonRes.headers.get('content-type')).toContain('application/x-ndjson');
    const lines = (await ndjsonRes.text()).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toEqual({ type: 'header', lens: 'buildingUnits', checkpoint: 250 });
    expect(lines[1].row).toMatchObject({ id: 'u1', code: '101', rent: 1200 });
    expect(lines[2]).toEqual({ type: 'footer', checkpoint: 250, count: 1 });

    // Compact change log up to checkpoint 200
    const compact = await compactChangeLog(db, { cutoffTimestamp: 200 });
    expect(compact).toEqual({ deleted: deletedCount, compactedFloor: 200 });

    // Stale client with since=50 receives resyncRequired: true
    const stalePull = await app.fetch(
      new Request(
        'http://localhost/sync/lens/buildingUnits?since=50&args=' +
          encodeURIComponent(JSON.stringify({ buildingId: 'b1' })),
        { headers: { Authorization: 'Bearer admin-key' } },
      ),
    );
    expect(stalePull.status).toBe(200);
    const staleBody = (await stalePull.json()) as any;
    expect(staleBody.resyncRequired).toBe(true);
    expect(staleBody.minCheckpoint).toBe(200);
  });
});
