import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { quoteIdent, type SqlExecutor } from 'local-lite/server';
import type { ServerSettings } from '../../config.js';
import type { SchemaDictionary } from '../../db/schema.js';
import { fromDbRow } from '../../db/tableStorage.js';
import { projectScope, toPhysicalTable, type ProjectRecord } from '../../services/projects.js';

export function createBackupsHandler(settings: ServerSettings, db: SqlExecutor, schema: SchemaDictionary) {
  const q = (n: string) => quoteIdent(n, db.dialect);

  return async (request: Request, project?: ProjectRecord | null) => {
    const scope = projectScope(project);
    const dir = scope.projectId
      ? path.resolve(settings.backupDir, 'projects', scope.projectId)
      : path.resolve(settings.backupDir);
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === 'GET') {
      const file = url.searchParams.get('file');
      if (!file) {
        const rows = await db.query<any>(
          `SELECT id, user_id, file_name, status, size_bytes, record_count, created_at
           FROM _lls_backups WHERE ${scope.where} ORDER BY created_at DESC LIMIT 50`,
          scope.params,
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
      const activeSchema = project ? project.schema : schema;
      const data: Record<string, unknown[]> = {};
      let recordCount = 0;
      for (const [table, fields] of Object.entries(activeSchema)) {
        const rows = await db.query<Record<string, any>>(
          `SELECT * FROM ${q(toPhysicalTable(project?.slug ?? null, table))}`,
        );
        data[table] = rows.map((r) => ({ id: String(r.id), ...fromDbRow(fields, r) }));
        recordCount += rows.length;
      }
      const now = Date.now();
      const fileName = `backup-${project ? project.slug : settings.db.database}-${now}.json`;
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
        'INSERT INTO _lls_backups (id, project_id, user_id, file_name, status, size_bytes, record_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [backup.id, scope.projectId, backup.userId, backup.fileName, backup.status, backup.sizeBytes, backup.recordCount, backup.createdAt],
      );
      return Response.json({ success: true, backup });
    }

    if (method === 'DELETE') {
      const file = path.basename(url.searchParams.get('file') || '');
      const target = path.resolve(dir, file);
      if (fs.existsSync(target)) fs.unlinkSync(target);
      await db.execute(`DELETE FROM _lls_backups WHERE file_name = ? AND ${scope.where}`, [file, ...scope.params]);
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  };
}
