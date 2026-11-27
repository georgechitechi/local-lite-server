import fs from 'node:fs';
import path from 'node:path';
import { buildUpsertSql, type SqlExecutor } from 'local-lite/server';
import type { ServerSettings } from '../../config.js';
import { projectScope, type ProjectRecord } from '../../services/projects.js';
import { clampInt } from '../console.js';

export function createStorageAdminHandler(settings: ServerSettings, db: SqlExecutor) {
  return async (request: Request, project?: ProjectRecord | null) => {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const scope = projectScope(project);

    if (method === 'GET') {
      const bucket = url.searchParams.get('bucket');
      const limit = clampInt(url.searchParams.get('limit'), 30, 1, 200);
      const offset = clampInt(url.searchParams.get('offset'), 0, 0, 10_000_000);
      const rawBuckets = await db.query<any>(
        `SELECT * FROM _lls_storage_buckets WHERE ${scope.where} ORDER BY name ASC`,
        scope.params,
      );
      const buckets = rawBuckets.map((b) => ({ ...b, name: scope.unkey(String(b.name)) }));
      const where = bucket ? `WHERE ${scope.where} AND bucket = ?` : `WHERE ${scope.where}`;
      const params = bucket ? [...scope.params, bucket] : scope.params;
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
          insertCols: ['name', 'visibility', 'project_id', 'created_at'],
          updateCols: ['visibility', 'project_id'],
          dialect: db.dialect,
        }),
        [scope.key(name), vis, scope.projectId, Date.now()],
      );
      return Response.json({ success: true, name, visibility: vis }, { status: 201 });
    }

    if (method === 'DELETE') {
      const bucket = url.searchParams.get('bucket');
      const key = url.searchParams.get('key');
      if (bucket) {
        await db.execute(
          `DELETE FROM _lls_storage_buckets WHERE name = ? AND ${scope.where}`,
          [scope.key(bucket), ...scope.params],
        );
        return Response.json({ success: true });
      }
      if (key) {
        const uploadRoot = scope.projectId ? path.join(settings.uploadDir, 'projects', scope.projectId) : settings.uploadDir;
        const target = path.resolve(uploadRoot, key);
        if (fs.existsSync(target)) fs.unlinkSync(target);
        await db.execute(
          `DELETE FROM _lls_storage_files WHERE storage_key = ? AND ${scope.where}`,
          [key, ...scope.params],
        );
        return Response.json({ success: true });
      }
      return Response.json({ error: 'bucket or key required.' }, { status: 400 });
    }

    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  };
}
