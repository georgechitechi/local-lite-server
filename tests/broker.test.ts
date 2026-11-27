import { describe, expect, it } from 'vitest';
import { loadSettings } from '../src/config.js';
import { createClusterBroker } from '../src/core/broker.js';
import { createDistributedRateLimiter } from '../src/auth/rateLimit.js';

describe('Multi-instance broker & distributed rate limiter', () => {
  it('uses in-memory broker when MULTI_INSTANCE is false', async () => {
    const settings = loadSettings({
      DB_DIALECT: 'mysql',
      DB_HOST: 'h',
      DB_USER: 'u',
      DB_NAME: 'n',
      SERVER_API_KEY: 'k',
    });
    const broker = await createClusterBroker(settings, {} as any);
    const seen: string[] = [];
    const unsub = broker.subscribe((ev) => seen.push(ev.tableName));
    broker.publish({ scopeId: 'default', tableName: 'notes', checkpoint: 1 });
    expect(seen).toEqual(['notes']);
    unsub();
    await broker.close();
  });

  it('enforces distributed rate limit via SQL table', async () => {
    let row: { hits: number; reset_at: number } | null = null;
    const db: any = {
      dialect: 'mysql',
      query: async () => (row ? [row] : []),
      execute: async (sql: string, p: any[]) => {
        if (sql.includes('INSERT INTO _lls_rate_limits'))
          row = { hits: 1, reset_at: p[1] };
        else if (sql.includes('UPDATE _lls_rate_limits'))
          row = { hits: p[0], reset_at: row!.reset_at };
        return { affectedRows: 1 };
      },
      withTransaction: async (fn: any) => fn(db),
    };
    const limiter = createDistributedRateLimiter(db, 2, 1000, true);
    expect((await limiter('ip:1', 10)).ok).toBe(true);
    expect((await limiter('ip:1', 20)).ok).toBe(true);
    expect((await limiter('ip:1', 30)).ok).toBe(false);
    expect((await limiter('ip:1', 1020)).ok).toBe(true);
  });
});
