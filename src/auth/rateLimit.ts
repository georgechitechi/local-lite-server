import type { SqlExecutor } from 'local-lite/server';

export type RateLimitResult = { ok: true } | { ok: false; retryAfter: number };

/** Fixed-window in-memory limiter, keyed per client IP. */
export function createRateLimiter(max: number, windowMs: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (key: string, now = Date.now()): RateLimitResult => {
    const b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      if (buckets.size > 5000) buckets.clear();
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true };
    }
    b.count += 1;
    if (b.count > max)
      return {
        ok: false,
        retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
      };
    return { ok: true };
  };
}

/** DB-backed limiter for multi-instance deployments, with in-memory fallback. */
export function createDistributedRateLimiter(
  db: SqlExecutor,
  max: number,
  windowMs: number,
  enabled = false,
) {
  const memory = createRateLimiter(max, windowMs);
  if (!enabled)
    return async (key: string, now = Date.now()) => memory(key, now);

  return async (key: string, now = Date.now()): Promise<RateLimitResult> => {
    try {
      return await db.withTransaction(async (tx) => {
        const rows = await tx.query<{ hits: number; reset_at: number }>(
          'SELECT hits, reset_at FROM _lls_rate_limits WHERE rate_key = ? LIMIT 1',
          [key],
        );
        const existing = rows[0];
        if (!existing || Number(existing.reset_at) <= now) {
          const resetAt = now + windowMs;
          await tx.execute(
            tx.dialect === 'postgres'
              ? 'INSERT INTO _lls_rate_limits (rate_key, hits, reset_at) VALUES (?, 1, ?) ON CONFLICT (rate_key) DO UPDATE SET hits = 1, reset_at = EXCLUDED.reset_at'
              : 'INSERT INTO _lls_rate_limits (rate_key, hits, reset_at) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE hits = 1, reset_at = VALUES(reset_at)',
            [key, resetAt],
          );
          return { ok: true as const };
        }
        const nextHits = Number(existing.hits) + 1;
        await tx.execute(
          'UPDATE _lls_rate_limits SET hits = ? WHERE rate_key = ?',
          [nextHits, key],
        );
        if (nextHits > max) {
          return {
            ok: false as const,
            retryAfter: Math.max(
              1,
              Math.ceil((Number(existing.reset_at) - now) / 1000),
            ),
          };
        }
        return { ok: true as const };
      });
    } catch {
      return memory(key, now);
    }
  };
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || request.headers.get('x-real-ip') || 'unknown';
}
