import {
  createAuthEndpoint,
  verifyAuthTokenWithStorage,
  type ServerAuthOtpRecord,
  type ServerAuthStorage,
  type ServerAuthUserRecord,
  type SqlExecutor,
} from 'local-lite/server';
import type { ServerSettings } from '../config.js';
import { sendSmtpMail } from '../core/mailer.js';

const num = (v: unknown) => (v == null ? null : Number(v));

/** SQL-backed accounts + reset OTPs (tables created by migration 20261127081945_core_schema). */
export function createAuthStorage(db: SqlExecutor, projectId: string | null = null): ServerAuthStorage {
  const scopeWhere = projectId ? 'project_id = ?' : 'project_id IS NULL';
  const scopeParams = projectId ? [projectId] : [];

  return {
    async findUserByEmail(email): Promise<ServerAuthUserRecord | null> {
      const [r] = await db.query<any>(
        `SELECT * FROM _local_auth_accounts WHERE email = ? AND ${scopeWhere} LIMIT 1`,
        [email, ...scopeParams],
      );
      if (!r) return null;
      return {
        id: String(r.id),
        email: String(r.email),
        displayName: r.display_name ?? null,
        passwordHash: String(r.password_hash),
        salt: String(r.salt),
        iterations: Number(r.iterations),
        algorithm: String(r.algorithm),
        failedLoginAttempts: Number(r.failed_login_attempts ?? 0),
        lockedUntil: num(r.locked_until),
        tokenVersion: r.token_version != null ? Number(r.token_version) : 1,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
      };
    },
    async createUser(u) {
      await db.execute(
        `INSERT INTO _local_auth_accounts (id, email, display_name, password_hash, salt, iterations, algorithm, failed_login_attempts, locked_until, token_version, project_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [u.id, u.email, u.displayName ?? null, u.passwordHash, u.salt, u.iterations, u.algorithm,
         u.failedLoginAttempts, u.lockedUntil ?? null, u.tokenVersion ?? 1, projectId, u.createdAt, u.updatedAt],
      );
    },
    async recordFailedAttempt(userId, attempts, lockedUntil, updatedAt) {
      await db.execute(
        'UPDATE _local_auth_accounts SET failed_login_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?',
        [attempts, lockedUntil, updatedAt, userId],
      );
    },
    async updatePasswordAndResetLockout(userId, p) {
      await db.execute(
        'UPDATE _local_auth_accounts SET password_hash = ?, salt = ?, iterations = ?, algorithm = ?, failed_login_attempts = 0, locked_until = NULL, token_version = COALESCE(token_version, 1) + 1, updated_at = ? WHERE id = ?',
        [p.passwordHash, p.salt, p.iterations, p.algorithm, p.updatedAt, userId],
      );
    },
    async invalidateActiveOtps(email, usedAt) {
      await db.execute(
        `UPDATE _local_auth_reset_otps SET used_at = ? WHERE email = ? AND ${scopeWhere} AND used_at IS NULL`,
        [usedAt, email, ...scopeParams],
      );
    },
    async createResetOtp(o: ServerAuthOtpRecord) {
      await db.execute(
        'INSERT INTO _local_auth_reset_otps (id, user_id, email, otp_hash, attempts, expires_at, used_at, project_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [o.id, o.userId, o.email, o.otpHash, o.attempts, o.expiresAt, o.usedAt ?? null, projectId, o.createdAt],
      );
    },
    async findLatestActiveOtp(email): Promise<ServerAuthOtpRecord | null> {
      const [r] = await db.query<any>(
        `SELECT * FROM _local_auth_reset_otps WHERE email = ? AND ${scopeWhere} AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [email, ...scopeParams],
      );
      if (!r) return null;
      return {
        id: String(r.id),
        userId: String(r.user_id),
        email: String(r.email),
        otpHash: String(r.otp_hash),
        attempts: Number(r.attempts ?? 0),
        expiresAt: Number(r.expires_at),
        usedAt: num(r.used_at),
        createdAt: Number(r.created_at),
      };
    },
    async incrementOtpAttempts(id, attempts, usedAt) {
      await db.execute('UPDATE _local_auth_reset_otps SET attempts = ?, used_at = ? WHERE id = ?', [attempts, usedAt, id]);
    },
    async markOtpUsed(id, usedAt) {
      await db.execute('UPDATE _local_auth_reset_otps SET used_at = ? WHERE id = ?', [usedAt, id]);
    },
  };
}

export interface AuthService {
  enabled: boolean;
  handler: (request: Request) => Promise<Response>;
  /** True when the bearer/query token is a valid, non-revoked user token. */
  verifyToken: (token: string) => Promise<boolean>;
  verifyUser: (token: string) => Promise<{ id: string; email: string } | null>;
  userCount: () => Promise<number>;
}

export function createAuthService(
  s: ServerSettings,
  db: SqlExecutor,
  projectId: string | null = null,
): AuthService {
  const storage = createAuthStorage(db, projectId);
  const scopeWhere = projectId ? 'project_id = ?' : 'project_id IS NULL';
  const scopeParams = projectId ? [projectId] : [];
  const userCount = async () =>
    Number((await db.query<any>(`SELECT COUNT(*) AS n FROM _local_auth_accounts WHERE ${scopeWhere}`, scopeParams))[0]?.n ?? 0);

  if (!s.appSecret) {
    return {
      enabled: false,
      handler: async () =>
        Response.json({ error: 'Accounts are disabled: set APP_SECRET to enable /auth.' }, { status: 503 }),
      verifyToken: async () => false,
      verifyUser: async () => null,
      userCount,
    };
  }

  const secret = s.appSecret;
  const handler = createAuthEndpoint({
    storage,
    secret,
    sendResetOtpEmail: async ({ to, otp, expiresMinutes }) => {
      if (!s.smtp) throw new Error('SMTP is not configured (set SMTP_HOST etc.).');
      await sendSmtpMail(
        s.smtp,
        to,
        `${s.appName} password reset code`,
        `Your verification code is: ${otp}\n\nIt expires in ${expiresMinutes} minutes.\nIf you did not request this, ignore this email.`,
      );
    },
  });
  const verifyUser = async (token: string) => {
    const user = await verifyAuthTokenWithStorage(token, secret, storage);
    return user ? { id: user.id, email: user.email } : null;
  };
  return {
    enabled: true,
    handler,
    verifyToken: async (token) => Boolean(await verifyUser(token)),
    verifyUser,
    userCount,
  };
}
