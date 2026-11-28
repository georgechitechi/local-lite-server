import { quoteIdent, type SqlExecutor } from 'local-lite/server';
import { importUserModule, resolveProjectFile } from '../core/resolve.js';

export interface OutboxRecord {
  id: string;
  topic: string;
  payload: unknown;
  attempts: number;
}

export type OutboxHandler = (event: OutboxRecord) => Promise<void> | void;

export interface OutboxWorkerOptions {
  db: SqlExecutor;
  handlers: Map<string, OutboxHandler> | Record<string, OutboxHandler>;
  maxAttempts?: number;
  pollIntervalMs?: number;
  batchSize?: number;
  onError?: (err: unknown, record: OutboxRecord) => void;
}

export interface OutboxWorker {
  processBatch(now?: number): Promise<{ processed: number; delivered: number; failed: number }>;
  start(): () => void;
  stop(): void;
}

/**
 * Reliable background worker for `_server_outbox` events written inside
 * command transactions. Delivers events with exponential backoff and moves
 * exhausted items to `dead_letter`.
 */
export function createOutboxWorker(opts: OutboxWorkerOptions): OutboxWorker {
  const { db } = opts;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 5);
  const pollIntervalMs = Math.max(100, opts.pollIntervalMs ?? 2000);
  const batchSize = Math.max(1, Math.min(200, opts.batchSize ?? 50));
  const handlerMap =
    opts.handlers instanceof Map
      ? opts.handlers
      : new Map(Object.entries(opts.handlers));

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const q = (n: string) => quoteIdent(n, db.dialect);

  const processBatch = async (now = Date.now()) => {
    if (running) return { processed: 0, delivered: 0, failed: 0 };
    running = true;
    let processed = 0;
    let delivered = 0;
    let failed = 0;

    try {
      const rows = await db.query<{
        id: string;
        topic: string;
        payload_json: string;
        attempts: number;
      }>(
        `SELECT id, topic, payload_json, attempts FROM ${q('_server_outbox')} ` +
          `WHERE status = ? AND next_attempt_at <= ? ORDER BY created_at ASC LIMIT ${batchSize}`,
        ['pending', now],
      );

      for (const r of rows) {
        processed += 1;
        let payload: unknown = null;
        try {
          payload = JSON.parse(r.payload_json);
        } catch {
          payload = r.payload_json;
        }
        const record: OutboxRecord = {
          id: String(r.id),
          topic: String(r.topic),
          payload,
          attempts: Number(r.attempts ?? 0),
        };
        const handler = handlerMap.get(record.topic) ?? handlerMap.get('*');
        try {
          if (handler) {
            await handler(record);
          }
          await db.execute(
            `UPDATE ${q('_server_outbox')} SET status = ?, delivered_at = ? WHERE id = ?`,
            ['delivered', Date.now(), record.id],
          );
          delivered += 1;
        } catch (err) {
          failed += 1;
          opts.onError?.(err, record);
          const nextAttempts = record.attempts + 1;
          const dead = nextAttempts >= maxAttempts;
          const backoffMs = Math.min(5_000 * 2 ** record.attempts, 3_600_000);
          const errMsg = err instanceof Error ? err.message : String(err);
          await db.execute(
            `UPDATE ${q('_server_outbox')} SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?`,
            [
              dead ? 'dead_letter' : 'pending',
              nextAttempts,
              Date.now() + backoffMs,
              errMsg.slice(0, 1000),
              record.id,
            ],
          );
        }
      }
    } finally {
      running = false;
    }
    return { processed, delivered, failed };
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const start = () => {
    stop();
    timer = setInterval(() => {
      void processBatch().catch(() => {});
    }, pollIntervalMs);
    return stop;
  };

  return { processBatch, start, stop };
}

export function resolveOutboxFile(
  explicit?: string,
  cwd = process.cwd(),
): string | null {
  return resolveProjectFile(
    explicit,
    'OUTBOX_PATH',
    ['outbox.mjs', 'src/outbox.ts', 'outbox.ts'],
    cwd,
  );
}

export async function loadOutboxHandlers(
  file: string,
): Promise<Record<string, OutboxHandler>> {
  const loaded = await importUserModule(file);
  const mod = loaded.default;
  if (!mod || typeof mod !== 'object' || Array.isArray(mod)) {
    throw new Error(
      `${file} must export default an object of { [topic]: handler }.`,
    );
  }
  return mod as Record<string, OutboxHandler>;
}
