import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SqlExecutor } from 'local-lite/server';
import { hashPassword, verifyPassword } from 'local-lite/auth/local';
import { createSignedToken, verifySignedToken } from 'local-lite/keys';
import type { ServerSettings } from '../config.js';
import { safeEqual } from '../core/http.js';

const COOKIE_NAME = 'lls_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

export interface AdminSession {
  userId?: string;
  email?: string;
  consoleRole: 'super_admin' | 'admin';
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx !== -1 && part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function makeCookie(req: Request, val: string, maxAgeSec: number): string {
  const secure =
    req.url.startsWith('https://') ||
    req.headers.get('x-forwarded-proto') === 'https';
  return `${COOKIE_NAME}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

export function createAdminSession(settings: ServerSettings, db: SqlExecutor) {
  const sessionSecret = crypto
    .createHmac('sha256', settings.appSecret || settings.apiKey)
    .update('lls-admin-session-v1')
    .digest('hex');

  const resolveAdminDist = (): string | null => {
    for (const dir of [
      path.resolve(process.cwd(), 'admin/dist'),
      path.resolve(process.cwd(), 'admin'),
      ...(import.meta.dirname
        ? [path.resolve(import.meta.dirname, '../../admin/dist')]
        : []),
    ]) {
      if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
    }
    return null;
  };

  async function authenticate(req: Request): Promise<AdminSession | null> {
    const auth = req.headers.get('authorization') ?? '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (bearer && safeEqual(bearer, settings.apiKey))
      return { consoleRole: 'super_admin' };
    const token = readCookie(req, COOKIE_NAME);
    if (!token) return null;
    const verified = verifySignedToken<{
      sub?: string;
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

  return {
    authenticate,

    serveStatic(pathname: string): Response {
      const dist = resolveAdminDist();
      if (!dist) {
        return new Response(
          'Admin UI not built. Run `cd admin && npm run build`.',
          { status: 404 },
        );
      }
      const rel = pathname.replace(/^\/admin\/?/, '') || 'index.html';
      const target = path.resolve(dist, rel);
      const file =
        target.startsWith(dist) &&
        fs.existsSync(target) &&
        fs.statSync(target).isFile()
          ? target
          : path.join(dist, 'index.html');
      const ext = path.extname(file);
      return new Response(fs.readFileSync(file), {
        headers: {
          'content-type': MIME[ext] || 'application/octet-stream',
          'cache-control':
            ext === '.html'
              ? 'no-store'
              : 'public, max-age=31536000, immutable',
        },
      });
    },

    async getLogin(request: Request) {
      const activeCond =
        db.dialect === 'postgres'
          ? 'console_active IS TRUE'
          : 'console_active != 0';
      const rows = await db.query<any>(
        `SELECT COUNT(*) AS n FROM _local_auth_accounts WHERE console_role IS NOT NULL AND ${activeCond}`,
      );
      const session = await authenticate(request).catch(() => null);
      return Response.json({
        hasConsoleAdmins: Number(rows[0]?.n ?? 0) > 0,
        allowConsoleSignup: settings.allowConsoleSignup,
        authenticated: Boolean(session),
        consoleRole: session?.consoleRole ?? null,
      });
    },

    async postLogin(request: Request) {
      const body = (await request.json().catch(() => null)) as Record<
        string,
        any
      > | null;
      const email = String(body?.email ?? '')
        .trim()
        .toLowerCase();
      const password = String(body?.password ?? '');
      if (!email || !password) {
        return Response.json(
          { error: 'Email and password are required.' },
          { status: 400 },
        );
      }

      if (body?.action === 'signup') {
        if (!settings.allowConsoleSignup) {
          return Response.json(
            { error: 'Console self-signup is disabled.' },
            { status: 403 },
          );
        }
        if (password.length < 8) {
          return Response.json(
            { error: 'Password must be at least 8 characters.' },
            { status: 400 },
          );
        }
        const existing = await db.query<any>(
          'SELECT id FROM _local_auth_accounts WHERE email = ? AND project_id IS NULL LIMIT 1',
          [email],
        );
        if (existing[0]) {
          return Response.json(
            { error: 'An account with this email already exists.' },
            { status: 409 },
          );
        }
        const now = Date.now();
        const userId = crypto.randomUUID();
        const displayName =
          String(body?.displayName ?? '').trim() || email.split('@')[0];
        const hashed = await hashPassword(password, { iterations: 100_000 });
        await db.execute(
          `INSERT INTO _local_auth_accounts (id, email, display_name, password_hash, salt, iterations, algorithm, failed_login_attempts, locked_until, token_version, console_role, console_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, 1, 'admin', ?, ?, ?)`,
          [
            userId,
            email,
            displayName,
            hashed.hash,
            hashed.salt,
            hashed.iterations,
            hashed.algorithm,
            db.dialect === 'postgres' ? true : 1,
            now,
            now,
          ],
        );
        const token = createSignedToken({
          secret: sessionSecret,
          expiresInMs: SESSION_TTL_MS,
          payload: { sub: userId, email, consoleRole: 'admin', tv: 1 },
        });
        return Response.json(
          { ok: true, success: true, consoleRole: 'admin' },
          {
            headers: {
              'Set-Cookie': makeCookie(request, token, SESSION_TTL_MS / 1000),
            },
          },
        );
      }

      if (body?.action === 'bootstrap') {
        const sec = String(body.secret ?? '').trim();
        const validSecret =
          (settings.appSecret && safeEqual(sec, settings.appSecret)) ||
          safeEqual(sec, settings.apiKey);
        if (!validSecret)
          return Response.json(
            { error: 'Invalid APP_SECRET / SERVER_API_KEY.' },
            { status: 403 },
          );
        if (password.length < 8)
          return Response.json(
            { error: 'Password must be at least 8 characters.' },
            { status: 400 },
          );
        const existing = await db.query<any>(
          'SELECT id FROM _local_auth_accounts WHERE email = ? AND project_id IS NULL LIMIT 1',
          [email],
        );
        const now = Date.now();
        let userId: string;
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
              userId,
              email,
              email.split('@')[0],
              hashed.hash,
              hashed.salt,
              hashed.iterations,
              hashed.algorithm,
              'super_admin',
              db.dialect === 'postgres' ? true : 1,
              now,
              now,
            ],
          );
        }
        const token = createSignedToken({
          secret: sessionSecret,
          expiresInMs: SESSION_TTL_MS,
          payload: { sub: userId, email, consoleRole: 'super_admin', tv: 1 },
        });
        return Response.json(
          { ok: true, success: true, consoleRole: 'super_admin' },
          {
            headers: {
              'Set-Cookie': makeCookie(request, token, SESSION_TTL_MS / 1000),
            },
          },
        );
      }

      const rows = await db.query<any>(
        'SELECT * FROM _local_auth_accounts WHERE email = ? LIMIT 1',
        [email],
      );
      const user = rows[0];
      if (!user || !user.console_active || !user.console_role) {
        return Response.json(
          { error: 'Invalid console credentials.' },
          { status: 401 },
        );
      }
      const ok = await verifyPassword(
        password,
        user.password_hash,
        user.salt,
        Number(user.iterations),
        user.algorithm,
      );
      if (!ok)
        return Response.json(
          { error: 'Invalid console credentials.' },
          { status: 401 },
        );
      const role =
        user.console_role === 'super_admin' ? 'super_admin' : 'admin';
      const token = createSignedToken({
        secret: sessionSecret,
        expiresInMs: SESSION_TTL_MS,
        payload: {
          sub: String(user.id),
          email,
          consoleRole: role,
          tv: Number(user.token_version ?? 1),
        },
      });
      return Response.json(
        { ok: true, success: true, consoleRole: role },
        {
          headers: {
            'Set-Cookie': makeCookie(request, token, SESSION_TTL_MS / 1000),
          },
        },
      );
    },

    async postLogout(request: Request, session: AdminSession | null) {
      if (
        new URL(request.url).searchParams.get('all') === '1' &&
        session?.userId
      ) {
        await db.execute(
          'UPDATE _local_auth_accounts SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?',
          [session.userId],
        );
      }
      return Response.json(
        { ok: true, success: true },
        { headers: { 'Set-Cookie': makeCookie(request, '', 0) } },
      );
    },
  };
}
