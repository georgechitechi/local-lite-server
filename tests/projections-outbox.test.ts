import { describe, expect, it } from 'vitest';
import { createSyncEventBroker } from 'local-lite/server';
import {
  CommandRejection,
  defineCommand,
  type CommandRegistry,
} from '../src/commands/index.js';
import { loadSettings } from '../src/config.js';
import { defineProjection, defineProjections } from '../src/db/projections.js';
import { normalizeSchema } from '../src/db/schema.js';
import { createApp } from '../src/server.js';
import { createOutboxWorker } from '../src/services/outbox.js';

const env = {
  DB_DIALECT: 'mysql',
  DB_HOST: 'h',
  DB_USER: 'u',
  DB_NAME: 'n',
  SERVER_API_KEY: 'admin-key',
  APP_SECRET: 's'.repeat(32),
} as NodeJS.ProcessEnv;

const schema = normalizeSchema({
  payments: { building_id: 'string', amount: 'number', scope_id: 'string' },
  building_stats: { building_id: 'string', total_paid: 'number', scope_id: 'string' },
});

function createProjectionDb() {
  const payments = new Map<string, any>();
  const stats = new Map<string, any>();
  const outbox = new Map<string, any>();
  let checkpoint = 0;

  const ex: any = {
    dialect: 'mysql',
    payments,
    stats,
    outbox,
    query: async (sql: string, params: any[] = []) => {
      if (sql.includes('FOR UPDATE')) return [{ checkpoint }];
      if (sql.includes('FROM `payments` WHERE `id` = ?')) {
        const r = payments.get(params[0]);
        return r ? [r] : [];
      }
      if (sql.includes('FROM `building_stats` WHERE `id` = ?')) {
        const r = stats.get(params[0]);
        return r ? [r] : [];
      }
      if (sql.includes('FROM `_server_outbox`')) {
        const status = params[0];
        const now = Number(params[1]);
        return [...outbox.values()].filter(
          (r) => r.status === status && r.next_attempt_at <= now,
        );
      }
      return [];
    },
    execute: async (sql: string, params: any[] = []) => {
      if (sql.startsWith('UPDATE `_server_sync_clock`')) {
        checkpoint = Number(params[0]);
      } else if (sql.startsWith('INSERT INTO `payments`')) {
        payments.set(params[0], {
          id: params[0],
          building_id: params[1],
          amount: params[2],
          scope_id: params[3],
          updated_at: params[4],
          deleted: params[5],
        });
      } else if (sql.startsWith('INSERT INTO `building_stats`')) {
        stats.set(params[0], {
          id: params[0],
          building_id: params[1],
          total_paid: params[2],
          scope_id: params[3],
          updated_at: params[4],
          deleted: params[5],
        });
      } else if (sql.startsWith('UPDATE `building_stats`')) {
        const row = stats.get(params[2]);
        if (row) {
          row.total_paid = params[0];
          row.updated_at = params[1];
        }
      } else if (sql.startsWith('INSERT INTO `_server_outbox`')) {
        outbox.set(params[0], {
          id: params[0],
          topic: params[1],
          payload_json: params[2],
          status: params[3],
          attempts: params[4],
          next_attempt_at: params[5],
          created_at: params[6],
          last_error: null,
          delivered_at: null,
        });
      } else if (sql.startsWith('UPDATE `_server_outbox` SET status = ?, delivered_at = ?')) {
        const r = outbox.get(params[2]);
        if (r) {
          r.status = params[0];
          r.delivered_at = params[1];
        }
      } else if (sql.startsWith('UPDATE `_server_outbox` SET status = ?, attempts = ?')) {
        const r = outbox.get(params[4]);
        if (r) {
          r.status = params[0];
          r.attempts = params[1];
          r.next_attempt_at = params[2];
          r.last_error = params[3];
        }
      }
      return { affectedRows: 1 };
    },
    withTransaction: async (fn: any) => fn(ex),
  };
  return ex;
}

describe('Incremental SQL Projections & Transactional Outbox', () => {
  it('runs projections inside command transactions and persists outbox events', async () => {
    const db = createProjectionDb();
    const broker = createSyncEventBroker();
    const events: any[] = [];
    broker.subscribe((e) => events.push(e));

    const projections = defineProjections({
      buildingTotals: defineProjection({
        on: 'payments',
        handler: async ({ db: txDb }, change) => {
          if (change.op !== 'insert' || !change.after) return;
          const statId = `stat_${change.after.building_id}`;
          const existing = await txDb.get('building_stats', statId);
          if (!existing) {
            await txDb.insert('building_stats', {
              id: statId,
              building_id: change.after.building_id,
              total_paid: Number(change.after.amount),
              scope_id: change.after.scope_id,
            });
          } else {
            await txDb.patch('building_stats', statId, {
              total_paid: Number(existing.total_paid) + Number(change.after.amount),
            });
          }
        },
      }),
    });

    const commands: CommandRegistry = new Map([
      [
        'billing/pay',
        defineCommand<{ building_id: string; amount: number; reject?: boolean }>({
          handler: async ({ db: txDb, emit }, args) => {
            if (args.reject) {
              throw new CommandRejection('INVALID_AMOUNT', 'Rejected');
            }
            const row = await txDb.insert('payments', {
              building_id: args.building_id,
              amount: args.amount,
              scope_id: args.building_id,
            });
            emit('rent.paid', { paymentId: row.id, amount: args.amount });
            return row;
          },
        }),
      ],
    ]);

    const app = createApp(
      loadSettings(env),
      db,
      schema,
      commands,
      {},
      broker,
      undefined,
      new Map(),
      projections,
    );

    const res = await app.fetch(
      new Request('http://localhost/cmd/billing/pay', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer admin-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ args: { building_id: 'b1', amount: 1200 } }),
      }),
    );
    expect(res.status).toBe(200);
    expect(db.stats.get('stat_b1')?.total_paid).toBe(1200);
    expect(events.map((e) => e.tableName)).toEqual(['payments', 'building_stats']);
    expect(db.outbox.size).toBe(1);

    // Rejected command does not touch projections or outbox
    const rej = await app.fetch(
      new Request('http://localhost/cmd/billing/pay', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer admin-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          args: { building_id: 'b1', amount: 500, reject: true },
        }),
      }),
    );
    expect(rej.status).toBe(409);
    expect(db.stats.get('stat_b1')?.total_paid).toBe(1200);
    expect(db.outbox.size).toBe(1);
  });

  it('delivers outbox events and moves repeated failures to dead_letter', async () => {
    const db = createProjectionDb();
    await db.execute(
      'INSERT INTO `_server_outbox` (id, topic, payload_json, status, attempts, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['ev1', 'rent.paid', JSON.stringify({ amount: 500 }), 'pending', 0, 100, 100],
    );
    await db.execute(
      'INSERT INTO `_server_outbox` (id, topic, payload_json, status, attempts, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['ev2', 'webhook.fail', JSON.stringify({ ok: false }), 'pending', 0, 100, 100],
    );

    const deliveredPayloads: any[] = [];
    const worker = createOutboxWorker({
      db,
      maxAttempts: 2,
      handlers: {
        'rent.paid': async (ev) => {
          deliveredPayloads.push(ev.payload);
        },
        'webhook.fail': async () => {
          throw new Error('downstream 500');
        },
      },
    });

    const r1 = await worker.processBatch(200);
    expect(r1).toEqual({ processed: 2, delivered: 1, failed: 1 });
    expect(deliveredPayloads).toEqual([{ amount: 500 }]);
    expect(db.outbox.get('ev1').status).toBe('delivered');
    expect(db.outbox.get('ev2').status).toBe('pending');
    expect(db.outbox.get('ev2').attempts).toBe(1);

    // Second failure hits maxAttempts=2 -> dead_letter
    const r2 = await worker.processBatch(Date.now() + 60_000);
    expect(r2).toEqual({ processed: 1, delivered: 0, failed: 1 });
    expect(db.outbox.get('ev2').status).toBe('dead_letter');
    expect(db.outbox.get('ev2').last_error).toContain('downstream 500');
  });
});
