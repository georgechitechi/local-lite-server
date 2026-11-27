import crypto from 'node:crypto';
import {
  generateApiKey,
  hashApiKey,
  verifyApiKeyFormat,
} from 'local-lite/keys';
import type { SqlExecutor } from 'local-lite/server';

export type ApiKeyRole = 'admin' | 'user';

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  role: ApiKeyRole;
  userId: string | null;
  projectId: string | null;
  createdBy: string | null;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

export interface VerifiedApiKey {
  id: string;
  isAdmin: boolean;
  userId?: string;
  projectId?: string | null;
}

const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

function toRecord(r: any): ApiKeyRecord {
  return {
    id: String(r.id),
    name: String(r.name),
    keyPrefix: String(r.key_prefix),
    role: r.role === 'user' ? 'user' : 'admin',
    userId: r.user_id ?? null,
    projectId: r.project_id ?? null,
    createdBy: r.created_by ?? null,
    lastUsedAt: numOrNull(r.last_used_at),
    expiresAt: numOrNull(r.expires_at),
    revokedAt: numOrNull(r.revoked_at),
    createdAt: Number(r.created_at),
  };
}

export function createApiKeyService(db: SqlExecutor) {
  return {
    async listKeys(projectId?: string | null): Promise<ApiKeyRecord[]> {
      const where = projectId
        ? 'WHERE project_id = ?'
        : 'WHERE project_id IS NULL';
      const params = projectId ? [projectId] : [];
      const rows = await db.query<any>(
        `SELECT id, name, key_prefix, role, user_id, project_id, created_by, last_used_at, expires_at, revoked_at, created_at
         FROM _lls_api_keys
         ${where}
         ORDER BY created_at DESC`,
        params,
      );
      return rows.map(toRecord);
    },

    async createKey(input: {
      name: string;
      role?: ApiKeyRole;
      userId?: string | null;
      projectId?: string | null;
      createdBy?: string | null;
      expiresAt?: number | null;
    }): Promise<{ key: string; record: ApiKeyRecord }> {
      const name = input.name.trim();
      if (!name || name.length > 128) {
        throw new Error('API key name is required (max 128 chars).');
      }
      const role: ApiKeyRole = input.role === 'user' ? 'user' : 'admin';
      const id = `key_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const generated = generateApiKey({ prefix: 'lls', name });
      const rawKey = generated.key;
      const keyPrefix = generated.display;
      const keyHash = generated.keyHash;
      const now = Date.now();
      const userId =
        role === 'user' ? input.userId?.trim() || `api_key:${id}` : null;
      const projectId = input.projectId?.trim() || null;
      const expiresAt =
        input.expiresAt && input.expiresAt > now
          ? Math.floor(input.expiresAt)
          : null;

      await db.execute(
        `INSERT INTO _lls_api_keys
         (id, name, key_prefix, key_hash, role, user_id, project_id, created_by, last_used_at, expires_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`,
        [
          id,
          name,
          keyPrefix,
          keyHash,
          role,
          userId,
          projectId,
          input.createdBy ?? null,
          expiresAt,
          now,
        ],
      );

      return {
        key: rawKey,
        record: {
          id,
          name,
          keyPrefix,
          role,
          userId,
          projectId,
          createdBy: input.createdBy ?? null,
          lastUsedAt: null,
          expiresAt,
          revokedAt: null,
          createdAt: now,
        },
      };
    },

    async revokeKey(id: string, projectId?: string | null): Promise<boolean> {
      const scope = projectId
        ? ' AND project_id = ?'
        : ' AND project_id IS NULL';
      const params: unknown[] = projectId
        ? [Date.now(), id, projectId]
        : [Date.now(), id];
      const res = await db.execute(
        `UPDATE _lls_api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL${scope}`,
        params,
      );
      return (res?.affectedRows ?? 0) > 0;
    },

    async deleteKey(id: string, projectId?: string | null): Promise<boolean> {
      const scope = projectId
        ? ' AND project_id = ?'
        : ' AND project_id IS NULL';
      const params: unknown[] = projectId ? [id, projectId] : [id];
      const res = await db.execute(
        `DELETE FROM _lls_api_keys WHERE id = ?${scope}`,
        params,
      );
      return (res?.affectedRows ?? 0) > 0;
    },

    async verifyKey(rawKey: string): Promise<VerifiedApiKey | null> {
      if (!verifyApiKeyFormat(rawKey, 'lls')) return null;
      const keyHash = hashApiKey(rawKey);
      const [row] = await db.query<any>(
        'SELECT id, role, user_id, project_id, last_used_at, expires_at, revoked_at FROM _lls_api_keys WHERE key_hash = ? LIMIT 1',
        [keyHash],
      );
      if (!row || row.revoked_at != null) return null;
      const now = Date.now();
      if (row.expires_at != null && Number(row.expires_at) <= now) return null;

      // Throttle last_used_at writes to at most once per minute per key.
      if (row.last_used_at == null || now - Number(row.last_used_at) > 60_000) {
        void db
          .execute('UPDATE _lls_api_keys SET last_used_at = ? WHERE id = ?', [
            now,
            row.id,
          ])
          .catch(() => {});
      }

      const isAdmin = row.role !== 'user';
      return {
        id: String(row.id),
        isAdmin,
        userId: row.user_id ? String(row.user_id) : undefined,
        ...(row.project_id ? { projectId: String(row.project_id) } : {}),
      };
    },
  };
}

export type ApiKeyService = ReturnType<typeof createApiKeyService>;
