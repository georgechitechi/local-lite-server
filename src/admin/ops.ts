import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildUpsertSql, quoteIdent, type SqlExecutor } from 'local-lite/server';
import type { ServerSettings } from '../config.js';
import { sendSmtpMail } from '../core/mailer.js';
import { runCronAction } from '../crons.js';
import type { FunctionRuntime } from '../functions/index.js';
import { applySchema, planSchema, type SchemaDictionary } from '../schema.js';
import { fromDbRow } from '../tableStorage.js';

const int = (v: string | null, d: number, min: number, max: number) =>
  Math.min(Math.max(Math.floor(Number(v ?? d)) || d, min), max);

export function createAdminOps(
  settings: ServerSettings,
  db: SqlExecutor,
  schema: SchemaDictionary,
  fnRuntime?: FunctionRuntime,
) {
  const q = (n: string) => quoteIdent(n, db.dialect);

  return {
    async handleEnv(request: Request) {
      const method = request.method.toUpperCase();
      if (method === 'GET') {
        const rows = await db.query<any>('SELECT var_key, var_value, is_secret, updated_at FROM _lls_env_vars ORDER BY var_key ASC');
        return Response.json({
          vars: rows.map((r) => ({
            key: r.var_key,
            value: r.is_secret ? '••••••••' : r.var_value,
            masked: Boolean(r.is_secret),
            revealable: Boolean(r.is_secret),
            updatedAt: Number(r.updated_at),
            source: 'db',
          })),
        });
      }
      if (method === 'POST') {
        const body = (await request.json().catch(() => null)) as any;
        if (body?.action === 'reveal') {
          const rows = await db.query<any>('SELECT var_value FROM _lls_env_vars WHERE var_key = ?', [String(body.key ?? '')]);
          return Response.json({ value: rows[0]?.var_value ?? '' });
        }
        const key = String(body?.key ?? '').trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return Response.json({ error: 'Invalid key.' }, { status: 400 });
        const val = String(body?.value ?? '');
        const isSecret = Boolean(body?.isSecret ?? body?.secret);
        await db.execute(
          buildUpsertSql({
            table: '_lls_env_vars',
            conflictCols: ['var_key'],
            insertCols: ['var_key', 'var_value', 'is_secret', 'updated_at'],
            updateCols: ['var_value', 'is_secret', 'updated_at'],
            dialect: db.dialect,
          }),
          [key, val, db.dialect === 'postgres' ? isSecret : isSecret ? 1 : 0, Date.now()],
        );
        process.env[key] = val;
        return Response.json({ success: true });
      }
      if (method === 'DELETE') {
        const key = new URL(request.url).searchParams.get('key') || '';
        await db.execute('DELETE FROM _lls_env_vars WHERE var_key = ?', [key]);
        return Response.json({ success: true });
      }
      return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    },

    async handleBackups(request: Request) {
      const dir = path.resolve(settings.backupDir);
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      if (method === 'GET') {
        const file = url.searchParams.get('file');
        if (!file) {
          const rows = await db.query<any>(
            'SELECT id, user_id, file_name, status, size_bytes, record_count, created_at FROM _lls_backups ORDER BY created_at DESC LIMIT 50',
          );
          return Response.json({
            backups: rows.map((b) => ({
              id: String(b.id),
              userId: String(b.user_id),
              fileName: String(b.file_name),
              status: String(b.status),
              sizeBytes: Number(b.size_bytes),
              recordCount: Number(b.record_count),
              createdAt: Number(b.created_at),
            })),
          });
        }
        const target = path.resolve(dir, path.basename(file));
        if (!fs.existsSync(target)) return Response.json({ error: 'Backup not found.' }, { status: 404 });
        return new Response(fs.readFileSync(target), { headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      if (method === 'POST') {
        fs.mkdirSync(dir, { recursive: true });
        const data: Record<string, unknown[]> = {};
        let recordCount = 0;
        for (const [table, fields] of Object.entries(schema)) {
          const rows = await db.query<Record<string, any>>(`SELECT * FROM ${q(table)}`);
          data[table] = rows.map((r) => ({ id: String(r.id), ...fromDbRow(fields, r) }));
          recordCount += rows.length;
        }
        const now = Date.now();
        const fileName = `backup-${settings.db.database}-${now}.json`;
        const json = JSON.stringify({ version: 1, dialect: settings.dialect, exportedAt: now, tables: data }, null, 2);
        fs.writeFileSync(path.join(dir, fileName), json);
        const backup = {
          id: crypto.randomUUID(),
          userId: 'system',
          fileName,
          status: 'completed',
          sizeBytes: Buffer.byteLength(json),
          recordCount,
          createdAt: now,
        };
        await db.execute(
          'INSERT INTO _lls_backups (id, user_id, file_name, status, size_bytes, record_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [backup.id, backup.userId, backup.fileName, backup.status, backup.sizeBytes, backup.recordCount, backup.createdAt],
        );
        return Response.json({ success: true, backup });
      }
      if (method === 'DELETE') {
        const file = path.basename(url.searchParams.get('file') || '');
        const target = path.resolve(dir, file);
        if (fs.existsSync(target)) fs.unlinkSync(target);
        await db.execute('DELETE FROM _lls_backups WHERE file_name = ?', [file]);
        return Response.json({ success: true });
      }
      return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    },

    async handleStorage(request: Request) {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      if (method === 'GET') {
        const bucket = url.searchParams.get('bucket');
        const limit = int(url.searchParams.get('limit'), 30, 1, 200);
        const offset = int(url.searchParams.get('offset'), 0, 0, 10_000_000);
        const buckets = await db.query<any>('SELECT * FROM _lls_storage_buckets ORDER BY name ASC');
        const where = bucket ? 'WHERE bucket = ?' : '';
        const params = bucket ? [bucket] : [];
        const files = await db.query<any>(
          `SELECT * FROM _lls_storage_files ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
          params,
        );
        const totals = await db.query<any>(
          `SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS b FROM _lls_storage_files ${where}`,
          params,
        );
        return Response.json({
          buckets,
          files,
          totalFiles: Number(totals[0]?.n ?? 0),
          totalBytes: Number(totals[0]?.b ?? 0),
        });
      }
      if (method === 'POST') {
        const body = (await request.json().catch(() => null)) as any;
        const name = String(body?.name ?? '').trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) return Response.json({ error: 'Invalid bucket name.' }, { status: 400 });
        const vis = body?.visibility === 'public' ? 'public' : 'private';
        await db.execute(
          buildUpsertSql({
            table: '_lls_storage_buckets',
            conflictCols: ['name'],
            insertCols: ['name', 'visibility', 'created_at'],
            updateCols: ['visibility'],
            dialect: db.dialect,
          }),
          [name, vis, Date.now()],
        );
        return Response.json({ success: true, name, visibility: vis }, { status: 201 });
      }
      if (method === 'DELETE') {
        const bucket = url.searchParams.get('bucket');
        const key = url.searchParams.get('key');
        if (bucket) {
          await db.execute('DELETE FROM _lls_storage_buckets WHERE name = ?', [bucket]);
          return Response.json({ success: true });
        }
        if (key) {
          const target = path.resolve(settings.uploadDir, key);
          if (fs.existsSync(target)) fs.unlinkSync(target);
          await db.execute('DELETE FROM _lls_storage_files WHERE storage_key = ?', [key]);
          return Response.json({ success: true });
        }
        return Response.json({ error: 'bucket or key required.' }, { status: 400 });
      }
      return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    },

    async handleCrons(request: Request) {
      const method = request.method.toUpperCase();
      if (method === 'GET') {
        const jobs = await db.query<any>('SELECT * FROM _lls_crons ORDER BY job_key ASC');
        return Response.json({ jobs });
      }
      if (method === 'POST') {
        const jobParam = new URL(request.url).searchParams.get('job');
        if (jobParam === 'storage_orphan_prune') {
          const summary = await runCronAction('storage_orphan_prune', null, { settings, db, fnRuntime });
          return Response.json({ success: true, summary });
        }
        const body = (await request.json().catch(() => null)) as any;
        const jobKey = String(body?.job_key ?? '').trim();
        if (body?.action === 'save') {
          await db.execute(
            buildUpsertSql({
              table: '_lls_crons',
              conflictCols: ['job_key'],
              insertCols: ['job_key', 'label', 'action_type', 'cron_expr', 'timezone', 'enabled', 'config_json'],
              updateCols: ['label', 'action_type', 'cron_expr', 'timezone', 'enabled', 'config_json'],
              dialect: db.dialect,
            }),
            [
              jobKey,
              String(body.label || jobKey),
              String(body.action_type || 'http_webhook'),
              String(body.cron_expr || '0 * * * *'),
              String(body.timezone || 'UTC'),
              db.dialect === 'postgres' ? body.enabled !== false : body.enabled !== false ? 1 : 0,
              body.config_json ? JSON.stringify(body.config_json) : null,
            ],
          );
          return Response.json({ success: true });
        }
        const rows = await db.query<any>('SELECT * FROM _lls_crons WHERE job_key = ?', [jobKey]);
        const job = rows[0];
        if (!job) return Response.json({ error: 'Schedule not found.' }, { status: 404 });
        try {
          const summary = await runCronAction(job.action_type, job.config_json, { settings, db, fnRuntime });
          await db.execute('UPDATE _lls_crons SET last_run_at = ?, last_status = ?, last_summary = ? WHERE job_key = ?', [
            Date.now(), 'ok', summary, jobKey,
          ]);
          return Response.json({ success: true, summary });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Execution failed.';
          await db.execute('UPDATE _lls_crons SET last_run_at = ?, last_status = ?, last_summary = ? WHERE job_key = ?', [
            Date.now(), 'error', msg, jobKey,
          ]);
          return Response.json({ error: msg }, { status: 500 });
        }
      }
      if (method === 'DELETE') {
        const jobKey = new URL(request.url).searchParams.get('job_key') || '';
        await db.execute('DELETE FROM _lls_crons WHERE job_key = ?', [jobKey]);
        return Response.json({ success: true });
      }
      return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    },

    async handleSettings(request: Request) {
      if (request.method.toUpperCase() === 'POST') {
        const body = (await request.json().catch(() => ({}))) as { action?: string; to?: string };
        if (body.action === 'apply_schema') {
          const plan = await applySchema(db, schema);
          return Response.json({ ok: true, applied: plan.up.length, warnings: plan.warnings });
        }
        if (body.action === 'test_email') {
          if (!settings.smtp) return Response.json({ ok: false, error: 'SMTP is not configured.' }, { status: 400 });
          const to = String(body.to ?? '').trim();
          if (!to || !to.includes('@')) return Response.json({ ok: false, error: 'Valid recipient email is required.' }, { status: 400 });
          await sendSmtpMail(
            settings.smtp,
            to,
            `${settings.appName} SMTP Test`,
            `SMTP is working on ${settings.appName} (${new Date().toISOString()}).`,
          );
          return Response.json({ ok: true });
        }
        const t0 = Date.now();
        try {
          await db.query('SELECT 1');
          return Response.json({ ok: true, status: 200, latencyMs: Date.now() - t0 });
        } catch (err) {
          return Response.json({ ok: false, status: 503, latencyMs: Date.now() - t0, error: String(err) });
        }
      }
      const plan = await planSchema(db, schema).catch(() => null);
      return Response.json({
        mode: 'self-hosted',
        dialect: settings.dialect,
        dbHost: settings.db.host,
        dbPort: String(settings.db.port),
        dbName: settings.db.database,
        poolSize: settings.db.poolSize,
        corsOrigins: settings.corsOrigins,
        uploadDir: settings.uploadDir,
        backupDir: settings.backupDir,
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        pendingSql: plan?.up ?? [],
        schemaWarnings: plan?.warnings ?? [],
        integrations: {
          appSecret: Boolean(settings.appSecret),
          smtp: Boolean(settings.smtp),
          autoMigrate: settings.autoMigrate,
          internalCrons: settings.internalCrons,
          multiInstance: settings.multiInstance,
          googleOAuth: Boolean(process.env.GOOGLE_CLIENT_SECRET),
          githubOAuth: Boolean(process.env.GITHUB_CLIENT_SECRET),
        },
      });
    },
  };
}
