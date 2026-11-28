import { buildUpsertSql, type SqlExecutor } from 'local-lite/server';
import { projectScope, type ProjectRecord } from '../../services/projects.js';

export function createEnvHandler(db: SqlExecutor) {
  return async (request: Request, project?: ProjectRecord | null) => {
    const method = request.method.toUpperCase();
    const scope = projectScope(project);

    if (method === 'GET') {
      const rows = await db.query<any>(
        `SELECT var_key, var_value, is_secret, updated_at FROM _lls_env_vars WHERE ${scope.where} ORDER BY var_key ASC`,
        scope.params,
      );
      return Response.json({
        vars: rows.map((r) => ({
          key: scope.unkey(String(r.var_key)),
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
        const rows = await db.query<any>(
          `SELECT var_value FROM _lls_env_vars WHERE var_key = ? AND ${scope.where}`,
          [scope.key(String(body.key ?? '')), ...scope.params],
        );
        return Response.json({ value: rows[0]?.var_value ?? '' });
      }
      const key = String(body?.key ?? '').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
        return Response.json({ error: 'Invalid key.' }, { status: 400 });
      const val = String(body?.value ?? '');
      const isSecret = Boolean(body?.isSecret);
      await db.execute(
        buildUpsertSql({
          table: '_lls_env_vars',
          conflictCols: ['var_key'],
          insertCols: [
            'var_key',
            'project_id',
            'var_value',
            'is_secret',
            'updated_at',
          ],
          updateCols: ['project_id', 'var_value', 'is_secret', 'updated_at'],
          dialect: db.dialect,
        }),
        [
          scope.key(key),
          scope.projectId,
          val,
          db.dialect === 'postgres' ? isSecret : isSecret ? 1 : 0,
          Date.now(),
        ],
      );
      if (!scope.projectId) process.env[key] = val;
      return Response.json({ success: true });
    }
    if (method === 'DELETE') {
      const key = new URL(request.url).searchParams.get('key') || '';
      await db.execute(
        `DELETE FROM _lls_env_vars WHERE var_key = ? AND ${scope.where}`,
        [scope.key(key), ...scope.params],
      );
      return Response.json({ success: true });
    }
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  };
}
