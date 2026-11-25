import {
  buildUpsertSql,
  createStorageEndpoint,
  type SqlExecutor,
  type StorageAuthContext,
  type StorageMetadataAdapter,
  type StoredFileMeta,
} from 'local-lite/server';
import type { ServerSettings } from './config.js';

export function createSqlStorageMetadata(db: SqlExecutor): StorageMetadataAdapter {
  return {
    async getBucket(name) {
      const rows = await db.query<any>('SELECT * FROM _lls_storage_buckets WHERE name = ? LIMIT 1', [name]);
      if (!rows[0]) return null;
      return {
        id: String(rows[0].name),
        name: String(rows[0].name),
        visibility: rows[0].visibility === 'public' ? 'public' : 'private',
        createdAt: Number(rows[0].created_at),
      };
    },
    async listBuckets() {
      const rows = await db.query<any>('SELECT * FROM _lls_storage_buckets ORDER BY name ASC');
      return rows.map((r) => ({
        id: String(r.name),
        name: String(r.name),
        visibility: r.visibility === 'public' ? 'public' : 'private',
        createdAt: Number(r.created_at),
      }));
    },
    async createBucket(bucket) {
      await db.execute(
        buildUpsertSql({
          table: '_lls_storage_buckets',
          conflictCols: ['name'],
          insertCols: ['name', 'visibility', 'created_at'],
          updateCols: ['visibility'],
          dialect: db.dialect,
        }),
        [bucket.name, bucket.visibility, bucket.createdAt ?? Date.now()],
      );
    },
    async deleteBucket(name) {
      await db.execute('DELETE FROM _lls_storage_buckets WHERE name = ?', [name]);
    },
    async countFilesInBucket(bucket) {
      const rows = await db.query<any>('SELECT COUNT(*) AS n FROM _lls_storage_files WHERE bucket = ?', [bucket]);
      return Number(rows[0]?.n ?? 0);
    },
    async upsertFile(file: StoredFileMeta) {
      await db.execute(
        buildUpsertSql({
          table: '_lls_storage_files',
          conflictCols: ['storage_key'],
          insertCols: ['id', 'storage_key', 'bucket', 'name', 'mime_type', 'size_bytes', 'created_at'],
          updateCols: ['bucket', 'name', 'mime_type', 'size_bytes'],
          dialect: db.dialect,
        }),
        [file.id, file.storageKey, file.bucket, file.name, file.mimeType, file.sizeBytes, file.createdAt],
      );
    },
    async getFile(storageKey, bucket) {
      const rows = bucket
        ? await db.query<any>('SELECT * FROM _lls_storage_files WHERE storage_key = ? AND bucket = ? LIMIT 1', [storageKey, bucket])
        : await db.query<any>('SELECT * FROM _lls_storage_files WHERE storage_key = ? LIMIT 1', [storageKey]);
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
      await db.execute('UPDATE _lls_storage_files SET bucket = ? WHERE storage_key = ?', [toBucket, storageKey]);
    },
    async deleteFile(storageKey) {
      await db.execute('DELETE FROM _lls_storage_files WHERE storage_key = ?', [storageKey]);
    },
  };
}

export function createStorageHandler(
  settings: ServerSettings,
  db: SqlExecutor,
  authenticate: (req: Request) => Promise<StorageAuthContext | null>,
) {
  return createStorageEndpoint({
    uploadDir: settings.uploadDir,
    signingSecret: settings.appSecret || settings.apiKey,
    metadata: createSqlStorageMetadata(db),
    authenticate,
    basePath: '/storage',
  });
}
