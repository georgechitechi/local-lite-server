import fs from 'node:fs';
import path from 'node:path';
import { quoteIdent, type SqlExecutor } from 'local-lite/server';
import type { ServerSettings } from './config.js';
import type { FunctionRuntime } from './functions/index.js';

export interface CronJobRecord {
  job_key: string;
  label: string;
  action_type: string;
  cron_expr: string;
  timezone: string;
  enabled: boolean | number;
  config_json?: string | null;
}

function matchField(expr: string, value: number): boolean {
  for (const part of expr.split(',')) {
    const s = part.trim();
    if (s === '*') return true;
    if (s.startsWith('*/')) {
      const step = Number(s.slice(2));
      if (step > 0 && value % step === 0) return true;
    } else if (s.includes('-')) {
      const [a, b] = s.split('-').map(Number);
      if (value >= a && value <= b) return true;
    } else if (Number(s) === value) {
      return true;
    }
  }
  return false;
}

export function matchesCron(expr: string, date: Date, timeZone = 'UTC'): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    minute: 'numeric',
    hour: 'numeric',
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const vals = [
    Number(get('minute')),
    Number(get('hour')) % 24,
    Number(get('day')),
    Number(get('month')),
    dowMap[get('weekday')] ?? date.getUTCDay(),
  ];
  return fields.every((f, i) => matchField(f, vals[i]));
}

export async function runCronAction(
  actionType: string,
  configJson: string | null | undefined,
  deps: { settings: ServerSettings; db: SqlExecutor; fnRuntime?: FunctionRuntime },
): Promise<string> {
  const cfg = configJson ? (JSON.parse(configJson) as Record<string, any>) : {};

  if (actionType === 'http_webhook') {
    const url = String(cfg.url ?? '').trim();
    if (!url) throw new Error('Webhook URL is not configured.');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cfg.headers || {}) },
      body: cfg.body ? JSON.stringify(cfg.body) : JSON.stringify({ timestamp: Date.now() }),
    });
    if (!res.ok) throw new Error(`Webhook returned HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  }

  if (actionType === 'function_call') {
    if (!deps.fnRuntime) throw new Error('Function runtime unavailable.');
    const fnName = String(cfg.fnName ?? cfg.function ?? '').trim();
    if (!fnName) throw new Error('Function name is not configured.');
    await deps.fnRuntime.run(fnName, cfg.args ?? {}, { isAdmin: true });
    return `Ran ${fnName}`;
  }

  if (actionType === 'trim_old_logs') {
    const days = Math.max(1, Number(cfg.keepDays ?? 30));
    const cutoff = Date.now() - days * 86_400_000;
    const res = await deps.db.execute(
      `DELETE FROM ${quoteIdent('_server_changes', deps.db.dialect)} WHERE ${quoteIdent('timestamp')} < ?`,
      [cutoff],
    );
    return `Trimmed ${res.affectedRows} log row(s)`;
  }

  if (actionType === 'storage_orphan_prune') {
    const rows = await deps.db.query<{ id: string; storage_key: string }>(
      'SELECT id, storage_key FROM _lls_storage_files',
    );
    let removedDbRows = 0;
    const knownKeys = new Set<string>();
    for (const r of rows) {
      knownKeys.add(r.storage_key);
      const abs = path.resolve(deps.settings.uploadDir, r.storage_key);
      if (!fs.existsSync(abs)) {
        await deps.db.execute('DELETE FROM _lls_storage_files WHERE id = ?', [r.id]);
        removedDbRows += 1;
      }
    }
    return `Pruned ${removedDbRows} missing file record(s)`;
  }

  return 'Executed';
}

export function startCronScheduler(deps: {
  settings: ServerSettings;
  db: SqlExecutor;
  fnRuntime?: FunctionRuntime;
}): () => void {
  if (!deps.settings.internalCrons) return () => {};
  const timer = setInterval(async () => {
    const now = new Date();
    try {
      const jobs = await deps.db.query<CronJobRecord>('SELECT * FROM _lls_crons');
      for (const job of jobs) {
        if (!job.enabled || !matchesCron(job.cron_expr, now, job.timezone || 'UTC')) continue;
        try {
          const summary = await runCronAction(job.action_type, job.config_json, deps);
          await deps.db.execute(
            'UPDATE _lls_crons SET last_run_at = ?, last_status = ?, last_summary = ? WHERE job_key = ?',
            [Date.now(), 'ok', summary, job.job_key],
          );
        } catch (err) {
          await deps.db.execute(
            'UPDATE _lls_crons SET last_run_at = ?, last_status = ?, last_summary = ? WHERE job_key = ?',
            [Date.now(), 'error', err instanceof Error ? err.message : 'Failed', job.job_key],
          );
        }
      }
    } catch (err) {
      console.error('[local-lite-server] cron tick error:', err);
    }
  }, 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
