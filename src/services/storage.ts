import path from 'node:path';
import {
  buildUpsertSql,
  createStorageEndpoint,
  type SqlExecutor,
  type StorageAuthContext,
  type StorageMetadataAdapter,
  type StoredFileMeta,
} from 'local-lite/server';
import type { ServerSettings } from '../config.js';
import { projectScope } from './projects.js';

export function createSqlStorageMetadata(
  db: SqlExecutor,
  projectId: string | null = null,
): StorageMetadataAdapter {
  const scope = projectScope(projectId ? { id: projectId } : null);

  return {
    async getBucket(name) {
      const rows = await db.query<any>(
        `SELECT * FROM _lls_storage_buckets WHERE name = ? AND ${scope.where} LIMIT 1`,
        [scope.key(name), ...scope.params],
      );
      if (!rows[0]) return null;
      return {
        id: scope.unkey(String(rows[0].name)),
        name: scope.unkey(String(rows[0].name)),
        visibility: rows[0].visibility === 'public' ? 'public' : 'private',
        createdAt: Number(rows[0].created_at),
      };
    },
    async listBuckets() {
      const rows = await db.query<any>(
        `SELECT * FROM _lls_storage_buckets WHERE ${scope.where} ORDER BY name ASC`,
        scope.params,
      );
      return rows.map((r) => {
        const logicalName = scope.unkey(String(r.name));
        return {
          id: logicalName,
          name: logicalName,
          visibility: r.visibility === 'public' ? 'public' : 'private',
          createdAt: Number(r.created_at),
        };
      });
    },
    async createBucket(bucket) {
      await db.execute(
        buildUpsertSql({
          table: '_lls_storage_buckets',
          conflictCols: ['name'],
          insertCols: ['name', 'visibility', 'project_id', 'created_at'],
          updateCols: ['visibility', 'project_id'],
          dialect: db.dialect,
        }),
        [scope.key(bucket.name), bucket.visibility, projectId, bucket.createdAt ?? Date.now()],
      );
    },
    async deleteBucket(name) {
      await db.execute(
        `DELETE FROM _lls_storage_buckets WHERE name = ? AND ${scope.where}`,
        [scope.key(name), ...scope.params],
      );
    },
    async countFilesInBucket(bucket) {
      const rows = await db.query<any>(
        `SELECT COUNT(*) AS n FROM _lls_storage_files WHERE bucket = ? AND ${scope.where}`,
        [bucket, ...scope.params],
      );
      return Number(rows[0]?.n ?? 0);
    },
    async upsertFile(file: StoredFileMeta) {
      await db.execute(
        buildUpsertSql({
          table: '_lls_storage_files',
          conflictCols: ['storage_key'],
          insertCols: ['id', 'storage_key', 'bucket', 'name', 'mime_type', 'size_bytes', 'project_id', 'created_at'],
          updateCols: ['bucket', 'name', 'mime_type', 'size_bytes', 'project_id'],
          dialect: db.dialect,
        }),
        [file.id, file.storageKey, file.bucket, file.name, file.mimeType, file.sizeBytes, projectId, file.createdAt],
      );
    },
    async getFile(storageKey, bucket) {
      const rows = bucket
        ? await db.query<any>(
            `SELECT * FROM _lls_storage_files WHERE storage_key = ? AND bucket = ? AND ${scope.where} LIMIT 1`,
            [storageKey, bucket, ...scope.params],
          )
        : await db.query<any>(
            `SELECT * FROM _lls_storage_files WHERE storage_key = ? AND ${scope.where} LIMIT 1`,
            [storageKey, ...scope.params],
          );
      const r = rows[0];
      if (!r) return null;
      return {
        id: String(r.id),
        storageKey: String(r.storage_key),
        bucket: String(r.bucket),
        name: String(r.name),
        mimeType: String(r.mime_type),
        sizeBytes: Number(r.size_bytes),
        createdAt: Number(r.created_at),
      };
    },
    async updateFileBucket(storageKey, toBucket) {
      await db.execute(
        `UPDATE _lls_storage_files SET bucket = ? WHERE storage_key = ? AND ${scope.where}`,
        [toBucket, storageKey, ...scope.params],
      );
    },
    async deleteFile(storageKey) {
      await db.execute(
        `DELETE FROM _lls_storage_files WHERE storage_key = ? AND ${scope.where}`,
        [storageKey, ...scope.params],
      );
    },
  };
}

export function createStorageHandler(
  settings: ServerSettings,
  db: SqlExecutor,
  authenticate: (req: Request) => Promise<StorageAuthContext | null>,
  opts?: { projectId?: string | null; basePath?: string },
) {
  const projectId = opts?.projectId ?? null;
  return createStorageEndpoint({
    uploadDir: projectId ? path.join(settings.uploadDir, 'projects', projectId) : settings.uploadDir,
    signingSecret: settings.appSecret || settings.apiKey,
    metadata: createSqlStorageMetadata(db, projectId),
    authenticate,
    basePath: opts?.basePath ?? '/storage',
  });
}
