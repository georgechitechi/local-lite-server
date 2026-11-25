import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildUpsertSql, quoteIdent, type SqlExecutor, type SyncEventBroker } from 'local-lite/server';
import type { ServerSettings } from './config.js';
import type { FunctionRuntime } from './functions.js';
import { applySchema, planSchema, type SchemaDictionary } from './schema.js';
import { fromDbRow, toDbValue } from './tableStorage.js';

const BUCKET_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function createAdminExtras(opts: {
  settings: ServerSettings;
  db: SqlExecutor;
  schema: SchemaDictionary;
  broker?: SyncEventBroker;
  fnRuntime?: FunctionRuntime;
}) {
  const { settings, db, schema, broker, fnRuntime } = opts;
  const q = (n: string) => quoteIdent(n, db.dialect);

  return {
    // --- Storage ---
    async listBuckets() {
      const buckets = await db.query('SELECT * FROM _lls_storage_buckets ORDER BY name ASC');
      return Response.json({ buckets });
    },

    async createBucket(request: Request) {
      const body = (await request.json().catch(() => null)) as { name?: string; visibility?: string } | null;
      const name = String(body?.name ?? '').trim().toLowerCase();
      if (!BUCKET_RE.test(name)) {
        return Response.json({ error: 'Bucket name must be lowercase letters, digits, - or _.' }, { status: 400 });
      }
      const visibility = body?.visibility === 'public' ? 'public' : 'private';
      await db.execute(
        buildUpsertSql({
          table: '_lls_storage_buckets',
          conflictCols: ['name'],
          insertCols: ['name', 'visibility', 'created_at'],
          updateCols: ['visibility'],
          dialect: db.dialect,
        }),
        [name, visibility, Date.now()],
      );
      return Response.json({ success: true, name, visibility }, { status: 201 });
    },

    async deleteBucket(name: string) {
      const files = await db.query<any>('SELECT COUNT(*) AS n FROM _lls_storage_files WHERE bucket = ?', [name]);
      if (Number(files[0]?.n ?? 0) > 0) {
        return Response.json({ error: 'Bucket is not empty.' }, { status: 400 });
      }
      await db.execute('DELETE FROM _lls_storage_buckets WHERE name = ?', [name]);
      return Response.json({ success: true });
    },

    async listFiles(url: URL) {
      const bucket = url.searchParams.get('bucket')?.trim() || '';
      const files = bucket
        ? await db.query('SELECT * FROM _lls_storage_files WHERE bucket = ? ORDER BY created_at DESC LIMIT 200', [bucket])
        : await db.query('SELECT * FROM _lls_storage_files ORDER BY created_at DESC LIMIT 200');
      return Response.json({ files });
    },

    async uploadFile(request: Request) {
      const body = (await request.json().catch(() => null)) as {
        bucket?: string;
        name?: string;
        mimeType?: string;
        contentBase64?: string;
      } | null;
      const bucket = String(body?.bucket ?? '').trim().toLowerCase();
      const fileName = path.basename(String(body?.name ?? 'file.bin').trim() || 'file.bin');
      if (!BUCKET_RE.test(bucket) || !body?.contentBase64) {
        return Response.json({ error: 'bucket and contentBase64 are required.' }, { status: 400 });
      }
      const existing = await db.query<any>('SELECT name FROM _lls_storage_buckets WHERE name = ?', [bucket]);
      if (!existing.length) return Response.json({ error: 'Bucket not found.' }, { status: 404 });

      const buf = Buffer.from(body.contentBase64, 'base64');
      if (buf.length > 5_000_000) return Response.json({ error: 'File exceeds 5 MB limit.' }, { status: 413 });
      const id = crypto.randomUUID();
      const key = `${bucket}/${id}-${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}`;
      const dir = path.resolve(settings.uploadDir, bucket);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${id}-${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}`), buf);

      await db.execute(
        'INSERT INTO _lls_storage_files (id, storage_key, bucket, name, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, key, bucket, fileName, body.mimeType || 'application/octet-stream', buf.length, Date.now()],
      );
      return Response.json({ success: true, id, storage_key: key, size_bytes: buf.length }, { status: 201 });
    },

    async deleteFile(id: string) {
      const rows = await db.query<any>('SELECT storage_key FROM _lls_storage_files WHERE id = ?', [id]);
      if (rows[0]?.storage_key) {
        const target = path.resolve(settings.uploadDir, String(rows[0].storage_key));
        if (fs.existsSync(target)) fs.unlinkSync(target);
      }
      await db.execute('DELETE FROM _lls_storage_files WHERE id = ?', [id]);
      return Response.json({ success: true });
    },

    // --- Backups ---
    async exportBackup() {
      const data: Record<string, unknown[]> = {};
      for (const [table, fields] of Object.entries(schema)) {
        const rows = await db.query<Record<string, any>>(`SELECT * FROM ${q(table)}`);
        data[table] = rows.map((r) => ({ id: String(r.id), ...fromDbRow(fields, r) }));
      }
      const payload = JSON.stringify({ version: 1, dialect: settings.dialect, exportedAt: Date.now(), tables: data }, null, 2);
      return new Response(payload, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="backup-${settings.db.database}-${Date.now()}.json"`,
        },
      });
    },

    async restoreBackup(request: Request) {
      const body = (await request.json().catch(() => null)) as { tables?: Record<string, Record<string, any>[]> } | null;
      if (!body?.tables || typeof body.tables !== 'object') {
        return Response.json({ error: 'Expected { tables: { ... } } JSON.' }, { status: 400 });
      }
      let restored = 0;
      await db.withTransaction(async (tx) => {
        const clock = await tx.query<{ checkpoint: number }>(
          `SELECT checkpoint FROM ${q('_server_sync_clock')} WHERE id = 1 FOR UPDATE`,
        );
        let ts = Number(clock[0]?.checkpoint ?? 0);
        for (const [table, rows] of Object.entries(body.tables!)) {
          const fields = Object.hasOwn(schema, table) ? schema[table] : undefined;
          if (!fields || !Array.isArray(rows)) continue;
          for (const row of rows) {
            if (!row?.id) continue;
            ts = Math.max(Date.now(), ts + 1);
            const cols = Object.keys(fields).filter((c) => c !== 'id' && c !== 'updated_at' && c !== 'deleted' && Object.hasOwn(row, c));
            const insertCols = ['id', ...cols, 'updated_at', 'deleted'];
            const params = [
              String(row.id),
              ...cols.map((c) => toDbValue(fields[c], row[c], db.dialect)),
              ts,
              db.dialect === 'postgres' ? Boolean(row.deleted) : row.deleted ? 1 : 0,
            ];
            await tx.execute(
              buildUpsertSql({ table, conflictCols: ['id'], insertCols, updateCols: [...cols, 'updated_at', 'deleted'], dialect: db.dialect }),
              params,
            );
            await tx.execute(`INSERT INTO ${q('_server_changes')} (table_name, row_id, ${q('timestamp')}) VALUES (?, ?, ?)`, [
              table, String(row.id), ts,
            ]);
            restored += 1;
          }
        }
        await tx.execute(`UPDATE ${q('_server_sync_clock')} SET checkpoint = ? WHERE id = 1`, [ts]);
      });
      for (const t of Object.keys(body.tables)) broker?.publish({ scopeId: 'default', tableName: t, checkpoint: Date.now() });
      return Response.json({ success: true, restored });
    },

    // --- Env Vars ---
    async listEnv() {
      const rows = await db.query<any>('SELECT var_key, var_value, is_secret, updated_at FROM _lls_env_vars ORDER BY var_key ASC');
      return Response.json({
        vars: rows.map((r) => ({
          key: r.var_key,
          value: r.is_secret ? '••••••••' : r.var_value,
          isSecret: Boolean(r.is_secret),
          updatedAt: Number(r.updated_at),
        })),
      });
    },

    async setEnv(request: Request) {
      const body = (await request.json().catch(() => null)) as { key?: string; value?: string; isSecret?: boolean } | null;
      const key = String(body?.key ?? '').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return Response.json({ error: 'Invalid key name.' }, { status: 400 });
      const val = String(body?.value ?? '');
      const secretVal = db.dialect === 'postgres' ? Boolean(body?.isSecret) : body?.isSecret ? 1 : 0;
      await db.execute(
        buildUpsertSql({
          table: '_lls_env_vars',
          conflictCols: ['var_key'],
          insertCols: ['var_key', 'var_value', 'is_secret', 'updated_at'],
          updateCols: ['var_value', 'is_secret', 'updated_at'],
          dialect: db.dialect,
        }),
        [key, val, secretVal, Date.now()],
      );
      process.env[key] = val;
      return Response.json({ success: true, key });
    },

    async deleteEnv(key: string) {
      await db.execute('DELETE FROM _lls_env_vars WHERE var_key = ?', [key]);
      return Response.json({ success: true });
    },

    // --- Schedules ---
    async listSchedules() {
      const schedules = await db.query('SELECT * FROM _lls_schedules ORDER BY name ASC');
      return Response.json({ schedules });
    },

    async saveSchedule(request: Request) {
      const body = (await request.json().catch(() => null)) as {
        name?: string; fnName?: string; cronExpr?: string; enabled?: boolean;
      } | null;
      const name = String(body?.name ?? '').trim();
      const fnName = String(body?.fnName ?? '').trim();
      const cronExpr = String(body?.cronExpr ?? '0 * * * *').trim();
      if (!name || !fnName) return Response.json({ error: 'name and fnName are required.' }, { status: 400 });
      const enabled = db.dialect === 'postgres' ? body?.enabled !== false : body?.enabled !== false ? 1 : 0;
      await db.execute(
        buildUpsertSql({
          table: '_lls_schedules',
          conflictCols: ['name'],
          insertCols: ['name', 'fn_name', 'cron_expr', 'enabled'],
          updateCols: ['fn_name', 'cron_expr', 'enabled'],
          dialect: db.dialect,
        }),
        [name, fnName, cronExpr, enabled],
      );
      return Response.json({ success: true, name });
    },

    async runSchedule(name: string) {
      const rows = await db.query<any>('SELECT * FROM _lls_schedules WHERE name = ?', [name]);
      if (!rows[0]) return Response.json({ error: 'Schedule not found.' }, { status: 404 });
      if (!fnRuntime) return Response.json({ error: 'Function runtime unavailable.' }, { status: 503 });
      try {
        const { result } = await fnRuntime.run(rows[0].fn_name, {}, { isAdmin: true });
        await db.execute('UPDATE _lls_schedules SET last_run_at = ?, last_status = ?, last_error = NULL WHERE name = ?', [
          Date.now(), 'ok', name,
        ]);
        return Response.json({ success: true, result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Run failed.';
        await db.execute('UPDATE _lls_schedules SET last_run_at = ?, last_status = ?, last_error = ? WHERE name = ?', [
          Date.now(), 'error', msg, name,
        ]);
        return Response.json({ error: msg }, { status: 500 });
      }
    },

    async deleteSchedule(name: string) {
      await db.execute('DELETE FROM _lls_schedules WHERE name = ?', [name]);
      return Response.json({ success: true });
    },

    // --- Settings / Schema ---
    async settingsInfo() {
      const plan = await planSchema(db, schema).catch(() => null);
      return Response.json({
        dialect: settings.dialect,
        host: settings.db.host,
        port: settings.db.port,
        database: settings.db.database,
        poolSize: settings.db.poolSize,
        autoMigrate: settings.autoMigrate,
        corsOrigins: settings.corsOrigins,
        smtp: settings.smtp ? { host: settings.smtp.host, port: settings.smtp.port, from: settings.smtp.from } : null,
        uploadDir: settings.uploadDir,
        pendingSql: plan?.up ?? [],
        warnings: plan?.warnings ?? [],
      });
    },

    async applyPendingSchema() {
      const plan = await applySchema(db, schema);
      return Response.json({ success: true, applied: plan.up.length, warnings: plan.warnings });
    },
  };
}
