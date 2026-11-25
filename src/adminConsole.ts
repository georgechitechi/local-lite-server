import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildUpsertSql,
  quoteIdent,
  type SqlExecutor,
  type SyncEventBroker,
} from 'local-lite/server';
import { hashPassword, verifyPassword } from 'local-lite/auth/local';
import { createSignedToken, verifySignedToken } from 'local-lite/keys';
import type { ServerSettings } from './config.js';
import type { FunctionRuntime } from './functions.js';
import type { SchemaDictionary } from './schema.js';
import { fromDbRow, toDbValue } from './tableStorage.js';

const COOKIE_NAME = 'lls_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SYSTEM_COLS = new Set(['id', 'updated_at', 'deleted']);
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

const int = (v: string | null, d: number, min: number, max: number) =>
  Math.min(Math.max(Math.floor(Number(v ?? d)) || d, min), max);

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function makeCookie(req: Request, val: string, maxAgeSec: number): string {
  const secure =
    req.url.startsWith('https://') || req.headers.get('x-forwarded-proto') === 'https';
  return `${COOKIE_NAME}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export interface AdminSession {
  userId?: string;
  email?: string;
  consoleRole: 'super_admin' | 'admin';
}

export function createAdminConsole(opts: {
  settings: ServerSettings;
  db: SqlExecutor;
  schema: SchemaDictionary;
  broker?: SyncEventBroker;
  fnRuntime?: FunctionRuntime;
}) {
  const { settings, db, schema, broker, fnRuntime } = opts;
  const q = (n: string) => quoteIdent(n, db.dialect);
  const notDeleted = db.dialect === 'postgres' ? 'FALSE' : '0';
  const sessionSecret = crypto
    .createHmac('sha256', settings.appSecret || settings.apiKey)
    .update('lls-admin-session-v1')
    .digest('hex');

  const resolveAdminDist = (): string | null => {
    for (const dir of [
      path.resolve(process.cwd(), 'admin/dist'),
      path.resolve(process.cwd(), 'admin-ui'),
    ]) {
      if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
    }
    return null;
  };

  async function authenticate(req: Request): Promise<AdminSession | null> {
    const auth = req.headers.get('authorization') ?? '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (bearer && safeEq(bearer, settings.apiKey)) {
      return { consoleRole: 'super_admin' };
    }
    const token = readCookie(req, COOKIE_NAME);
    if (!token) return null;
    const verified = verifySignedToken<{
      sub?: string;
      email?: string;
      consoleRole?: 'super_admin' | 'admin';
      tv?: number;
    }>(token, sessionSecret);
    const payload = verified.valid ? verified.payload : null;
    if (!payload?.sub || !payload.consoleRole) return null;
    const rows = await db.query<any>(
      'SELECT id, email, console_role, console_active, token_version FROM _local_auth_accounts WHERE id = ? LIMIT 1',
      [payload.sub],
    );
    const u = rows[0];
    if (!u || !u.console_active || !u.console_role) return null;
    if (Number(u.token_version ?? 1) !== Number(payload.tv ?? 1)) return null;
    return {
      userId: String(u.id),
      email: String(u.email),
      consoleRole: u.console_role === 'super_admin' ? 'super_admin' : 'admin',
    };
  }

  async function recordChange(tx: SqlExecutor, table: string, id: string): Promise<number> {
    const clock = await tx.query<{ checkpoint: number }>(
      `SELECT checkpoint FROM ${q('_server_sync_clock')} WHERE id = 1 FOR UPDATE`,
    );
    const ts = Math.max(Date.now(), Number(clock[0]?.checkpoint ?? 0) + 1);
    await tx.execute(
      `INSERT INTO ${q('_server_changes')} (table_name, row_id, ${q('timestamp')}) VALUES (?, ?, ?)`,
      [table, id, ts],
    );
    await tx.execute(`UPDATE ${q('_server_sync_clock')} SET checkpoint = ? WHERE id = 1`, [ts]);
    return ts;
  }

  return {
    authenticate,

    serveStatic(pathname: string): Response {
      const dist = resolveAdminDist();
      if (!dist) {
        return new Response('Admin UI not built. Run `cd admin && npm run build`.', { status: 404 });
      }
      const rel = pathname.replace(/^\/admin\/?/, '') || 'index.html';
      const target = path.resolve(dist, rel);
      const file =
        target.startsWith(dist) && fs.existsSync(target) && fs.statSync(target).isFile()
          ? target
          : path.join(dist, 'index.html');
      const ext = path.extname(file);
      return new Response(fs.readFileSync(file), {
        headers: {
          'content-type': MIME[ext] || 'application/octet-stream',
          'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
        },
      });
    },

    async getLogin() {
      const rows = await db.query<any>(
        'SELECT COUNT(*) AS n FROM _local_auth_accounts WHERE console_role IS NOT NULL AND console_active != 0',
      );
      return Response.json({ hasConsoleAdmins: Number(rows[0]?.n ?? 0) > 0 });
    },

    async postLogin(request: Request) {
      const body = (await request.json().catch(() => null)) as {
        action?: string;
        secret?: string;
        email?: string;
        password?: string;
      } | null;
      const email = String(body?.email ?? '').trim().toLowerCase();
      const password = String(body?.password ?? '');
      if (!email || !password) {
        return Response.json({ error: 'Email and password are required.' }, { status: 400 });
      }

      if (body?.action === 'bootstrap') {
        const sec = String(body.secret ?? '').trim();
        const validSecret =
          (settings.appSecret && safeEq(sec, settings.appSecret)) || safeEq(sec, settings.apiKey);
        if (!validSecret) {
          return Response.json({ error: 'Invalid APP_SECRET / SERVER_API_KEY.' }, { status: 403 });
        }
        if (password.length < 8) {
          return Response.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
        }
        const existing = await db.query<any>(
          'SELECT id FROM _local_auth_accounts WHERE email = ? LIMIT 1',
          [email],
        );
        const now = Date.now();
        let userId: string;
        let tv = 1;
        if (existing[0]) {
          userId = String(existing[0].id);
          await db.execute(
            'UPDATE _local_auth_accounts SET console_role = ?, console_active = ?, updated_at = ? WHERE id = ?',
            ['super_admin', db.dialect === 'postgres' ? true : 1, now, userId],
          );
        } else {
          userId = crypto.randomUUID();
          const hashed = await hashPassword(password, { iterations: 100_000 });
          await db.execute(
            `INSERT INTO _local_auth_accounts (id, email, display_name, password_hash, salt, iterations, algorithm, failed_login_attempts, locked_until, token_version, console_role, console_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, 1, ?, ?, ?, ?)`,
            [
              userId, email, email.split('@')[0], hashed.hash, hashed.salt, hashed.iterations,
              hashed.algorithm, 'super_admin', db.dialect === 'postgres' ? true : 1, now, now,
            ],
          );
        }
        const token = createSignedToken({
          secret: sessionSecret,
          expiresInMs: SESSION_TTL_MS,
          payload: { sub: userId, email, consoleRole: 'super_admin', tv },
        });
        return Response.json(
          { ok: true, success: true, consoleRole: 'super_admin' },
          { headers: { 'Set-Cookie': makeCookie(request, token, SESSION_TTL_MS / 1000) } },
        );
      }

      const rows = await db.query<any>(
        'SELECT * FROM _local_auth_accounts WHERE email = ? LIMIT 1',
        [email],
      );
      const user = rows[0];
      if (!user || !user.console_active || !user.console_role) {
        return Response.json({ error: 'Invalid console credentials.' }, { status: 401 });
      }
      const ok = await verifyPassword(
        password,
        user.password_hash,
        user.salt,
        Number(user.iterations),
        user.algorithm,
      );
      if (!ok) return Response.json({ error: 'Invalid console credentials.' }, { status: 401 });
      const role = user.console_role === 'super_admin' ? 'super_admin' : 'admin';
      const token = createSignedToken({
        secret: sessionSecret,
        expiresInMs: SESSION_TTL_MS,
        payload: { sub: String(user.id), email, consoleRole: role, tv: Number(user.token_version ?? 1) },
      });
      return Response.json(
        { ok: true, success: true, consoleRole: role },
        { headers: { 'Set-Cookie': makeCookie(request, token, SESSION_TTL_MS / 1000) } },
      );
    },

    async postLogout(request: Request, session: AdminSession | null) {
      const all = new URL(request.url).searchParams.get('all') === '1';
      if (all && session?.userId) {
        await db.execute(
          'UPDATE _local_auth_accounts SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?',
          [session.userId],
        );
      }
      return Response.json(
        { success: true },
        { headers: { 'Set-Cookie': makeCookie(request, '', 0) } },
      );
    },

    async overview(session: AdminSession) {
      let dbConnected = true;
      let dbError: string | null = null;
      const tableCounts: Array<{ table: string; count: number }> = [];
      try {
        for (const t of Object.keys(schema)) {
          const r = await db.query<any>(`SELECT COUNT(*) AS n FROM ${q(t)}`);
          tableCounts.push({ table: t, count: Number(r[0]?.n ?? 0) });
        }
      } catch (err) {
        dbConnected = false;
        dbError = err instanceof Error ? err.message : 'Database error';
      }
      const accounts = await db.query<any>(
        'SELECT id, email, display_name, failed_login_attempts, locked_until, token_version, console_role, console_active, created_at FROM _local_auth_accounts ORDER BY created_at DESC LIMIT 200',
      );
      const backups = await db.query<any>(
        'SELECT id, user_id, file_name, status, size_bytes, record_count, created_at FROM _lls_backups ORDER BY created_at DESC LIMIT 50',
      );
      const fns = (fnRuntime?.list() ?? []).map((f) => ({
        method: f.kind.toUpperCase(),
        path: `/fn/${f.name}`,
      }));
      return Response.json({
        health: { ok: dbConnected, dialect: settings.dialect, database: settings.db.database },
        endpoints: {
          endpoints: [
            { method: 'GET', path: '/health' },
            { method: 'GET', path: '/sync' },
            { method: 'POST', path: '/sync' },
            { method: 'GET', path: '/sync/events' },
            ...fns,
          ],
        },
        dbConnected,
        dbError,
        tableCounts,
        localAccounts: accounts.map((a) => ({
          id: String(a.id),
          email: String(a.email),
          displayName: a.display_name ?? null,
          failedLoginAttempts: Number(a.failed_login_attempts ?? 0),
          lockedUntil: a.locked_until != null ? Number(a.locked_until) : null,
          tokenVersion: Number(a.token_version ?? 1),
          consoleRole: a.console_role ?? null,
          consoleActive: Boolean(a.console_active),
          createdAt: Number(a.created_at),
        })),
        backups: backups.map((b) => ({
          id: String(b.id),
          userId: String(b.user_id),
          fileName: String(b.file_name),
          status: String(b.status),
          sizeBytes: Number(b.size_bytes),
          recordCount: Number(b.record_count),
          createdAt: Number(b.created_at),
        })),
        consoleRole: session.consoleRole,
      });
    },

    async handleTable(request: Request, tableOverride?: string, idOverride?: string) {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      if (method === 'GET') {
        const table = tableOverride || url.searchParams.get('table') || '';
        if (!Object.hasOwn(schema, table)) return Response.json({ error: 'Invalid table name.' }, { status: 400 });
        const fields = schema[table];
        const limit = int(url.searchParams.get('limit'), 30, 1, 500);
        const offset = int(url.searchParams.get('offset'), 0, 0, 10_000_000);
        const includeDeleted = url.searchParams.get('includeDeleted') === '1';
        const where = includeDeleted ? '' : `WHERE ${q('deleted')} = ${notDeleted}`;
        const total = Number((await db.query<any>(`SELECT COUNT(*) AS n FROM ${q(table)} ${where}`))[0]?.n ?? 0);
        const raw = await db.query<Record<string, any>>(
          `SELECT * FROM ${q(table)} ${where} ORDER BY ${q('updated_at')} DESC LIMIT ${limit} OFFSET ${offset}`,
        );
        return Response.json({
          table,
          columns: [...Object.keys(fields), 'deleted', 'updated_at'],
          total,
          limit,
          offset,
          rows: raw.map((r) => ({ id: String(r.id), ...fromDbRow(fields, r) })),
        });
      }

      const body = (await request.json().catch(() => null)) as Record<string, any> | null;
      const table = tableOverride || url.searchParams.get('table') || String(body?.table ?? '');
      if (!Object.hasOwn(schema, table)) return Response.json({ error: 'Invalid table name.' }, { status: 400 });
      const fields = schema[table];
      const rowData = body?.row && typeof body.row === 'object' ? body.row : body || {};

      if (method === 'POST' || method === 'PATCH') {
        const id = idOverride || (typeof rowData.id === 'string' && rowData.id.trim() ? rowData.id.trim() : crypto.randomUUID());
        const cols = Object.keys(fields).filter(
          (c) => !SYSTEM_COLS.has(c) && c !== 'created_at' && Object.hasOwn(rowData, c),
        );
        const ts = await db.withTransaction(async (tx) => {
          const checkpoint = await recordChange(tx, table, id);
          if (method === 'PATCH') {
            const sets = [...cols.map((c) => `${q(c)} = ?`), `${q('updated_at')} = ?`];
            await tx.execute(
              `UPDATE ${q(table)} SET ${sets.join(', ')} WHERE ${q('id')} = ?`,
              [...cols.map((c) => toDbValue(fields[c], rowData[c], db.dialect)), checkpoint, id],
            );
          } else {
            const insertCols = ['id', ...cols, 'updated_at', 'deleted'];
            const params = [
              id,
              ...cols.map((c) => toDbValue(fields[c], rowData[c], db.dialect)),
              checkpoint,
              db.dialect === 'postgres' ? false : 0,
            ];
            if (fields.created_at) {
              insertCols.push('created_at');
              params.push(rowData.created_at ?? checkpoint);
            }
            await tx.execute(
              buildUpsertSql({
                table,
                conflictCols: ['id'],
                insertCols,
                updateCols: [...cols, 'updated_at', 'deleted'],
                dialect: db.dialect,
              }),
              params,
            );
          }
          return checkpoint;
        });
        broker?.publish({ scopeId: 'default', tableName: table, checkpoint: ts });
        return Response.json({ success: true, id, cursor: ts }, { status: method === 'POST' ? 201 : 200 });
      }

      if (method === 'DELETE') {
        const id = idOverride || url.searchParams.get('id') || String(body?.id ?? '');
        const restore = url.searchParams.get('restore') === '1';
        const delVal = db.dialect === 'postgres' ? !restore : restore ? 0 : 1;
        const ts = await db.withTransaction(async (tx) => {
          const checkpoint = await recordChange(tx, table, id);
          await tx.execute(
            `UPDATE ${q(table)} SET ${q('deleted')} = ?, ${q('updated_at')} = ? WHERE ${q('id')} = ?`,
            [delVal, checkpoint, id],
          );
          return checkpoint;
        });
        broker?.publish({ scopeId: 'default', tableName: table, checkpoint: ts });
        return Response.json({ success: true, id, deleted: !restore, cursor: ts });
      }
      return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    },

    async manageUsers(request: Request) {
      const body = (await request.json().catch(() => null)) as Record<string, any> | null;
      const userId = String(body?.userId ?? '');
      const action = String(body?.action ?? '');
      if (!userId) return Response.json({ error: 'userId is required.' }, { status: 400 });
      if (action === 'unlock') {
        await db.execute(
          'UPDATE _local_auth_accounts SET failed_login_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
          [Date.now(), userId],
        );
      } else if (action === 'revoke_sessions') {
        await db.execute(
          'UPDATE _local_auth_accounts SET token_version = COALESCE(token_version, 1) + 1, updated_at = ? WHERE id = ?',
          [Date.now(), userId],
        );
      } else if (action === 'set_console_role') {
        const role = body?.consoleRole === 'super_admin' || body?.consoleRole === 'admin' ? body.consoleRole : null;
        const active = role !== null;
        await db.execute(
          'UPDATE _local_auth_accounts SET console_role = ?, console_active = ?, updated_at = ? WHERE id = ?',
          [role, db.dialect === 'postgres' ? active : active ? 1 : 0, Date.now(), userId],
        );
      } else {
        return Response.json({ error: 'Unsupported action.' }, { status: 400 });
      }
      return Response.json({ success: true });
    },

    async handleLogs(url: URL) {
      const table = url.searchParams.get('table') || 'ALL';
      const limit = int(url.searchParams.get('limit'), 30, 1, 200);
      const offset = int(url.searchParams.get('offset'), 0, 0, 10_000_000);
      const hasTable = table !== 'ALL' && Object.hasOwn(schema, table);
      const where = hasTable ? 'WHERE table_name = ?' : '';
      const params = hasTable ? [table] : [];
      const total = Number(
        (await db.query<any>(`SELECT COUNT(*) AS n FROM ${q('_server_changes')} ${where}`, params))[0]?.n ?? 0,
      );
      const raw = await db.query<any>(
        `SELECT id, table_name, row_id, ${q('timestamp')} FROM ${q('_server_changes')} ${where} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return Response.json({
        total,
        limit,
        offset,
        rows: raw.map((r) => ({
          tableName: r.table_name,
          rowId: r.row_id,
          operation: 'UPSERT',
          businessId: '',
          updatedAt: Number(r.timestamp),
        })),
      });
    },

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
      const dir = path.resolve(process.cwd(), 'backups');
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      if (method === 'GET') {
        const file = url.searchParams.get('file');
        if (!file) return Response.json({ error: 'file query param required.' }, { status: 400 });
        const target = path.resolve(dir, path.basename(file));
        if (!fs.existsSync(target)) return Response.json({ error: 'Backup not found.' }, { status: 404 });
        return new Response(fs.readFileSync(target), {
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
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
        const totals = await db.query<any>(`SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS b FROM _lls_storage_files ${where}`, params);
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
        await db.execute('UPDATE _lls_crons SET last_run_at = ?, last_status = ?, last_summary = ? WHERE job_key = ?', [
          Date.now(), 'ok', 'Executed', jobKey,
        ]);
        return Response.json({ success: true });
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
        const t0 = Date.now();
        try {
          await db.query('SELECT 1');
          return Response.json({ ok: true, status: 200, latencyMs: Date.now() - t0 });
        } catch (err) {
          return Response.json({ ok: false, status: 503, latencyMs: Date.now() - t0, error: String(err) });
        }
      }
      return Response.json({
        mode: 'self-hosted',
        remoteServerUrl: null,
        dbHost: settings.db.host,
        dbPort: String(settings.db.port),
        dbName: settings.db.database,
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        integrations: {
          appSecret: Boolean(settings.appSecret),
          smtp: Boolean(settings.smtp),
          googleOAuth: Boolean(process.env.GOOGLE_CLIENT_SECRET),
          githubOAuth: Boolean(process.env.GITHUB_CLIENT_SECRET),
        },
      });
    },
  };
}
