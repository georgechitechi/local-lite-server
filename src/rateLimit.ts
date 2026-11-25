/** Fixed-window in-memory limiter, keyed per client IP. */
export function createRateLimiter(max: number, windowMs: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (key: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } => {
    const b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      if (buckets.size > 5000) buckets.clear();
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true };
    }
    b.count += 1;
    if (b.count > max) return { ok: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
    return { ok: true };
  };
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || request.headers.get('x-real-ip') || 'unknown';
}
