import { buildUpsertSql, type SqlExecutor } from 'local-lite/server';
import type { ServerSettings } from '../../config.js';
import type { FunctionRuntime } from '../../functions/index.js';
import { runCronAction } from '../../services/crons.js';
import { projectScope, type ProjectRecord } from '../../services/projects.js';

export function createCronsHandler(
  settings: ServerSettings,
  db: SqlExecutor,
  fnRuntime?: FunctionRuntime,
) {
  const executeJob = async (job: any, jobKey: string) => {
    try {
      const summary = await runCronAction(job.action_type, job.config_json, {
        settings,
        db,
        fnRuntime,
      });
      await db.execute(
        'UPDATE _lls_crons SET last_run_at = ?, last_status = ?, last_summary = ? WHERE job_key = ?',
        [Date.now(), 'ok', summary, jobKey],
      );
      return { ok: true as const, summary };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Execution failed.';
      await db.execute(
        'UPDATE _lls_crons SET last_run_at = ?, last_status = ?, last_summary = ? WHERE job_key = ?',
        [Date.now(), 'error', msg, jobKey],
      );
      return { ok: false as const, error: msg };
    }
  };

  return async (request: Request, project?: ProjectRecord | null) => {
    const scope = projectScope(project);
    const normalize = (r: any) => ({
      job_key: scope.unkey(String(r.job_key)),
      label: r.label,
      action_type: r.action_type,
      cron: r.cron_expr,
      timezone: r.timezone,
      enabled: Boolean(r.enabled),
      config_json: r.config_json ?? null,
      last_run_at: r.last_run_at ?? null,
      last_status: r.last_status ?? null,
      last_summary: r.last_summary ?? null,
    });

    const method = request.method.toUpperCase();
    if (method === 'GET') {
      const rows = await db.query<any>(
        `SELECT * FROM _lls_crons WHERE ${scope.where} ORDER BY job_key ASC`,
        scope.params,
      );
      return Response.json({ jobs: rows.map(normalize) });
    }

    if (method === 'POST') {
      if (
        new URL(request.url).searchParams.get('job') === 'storage_orphan_prune'
      ) {
        const summary = await runCronAction('storage_orphan_prune', null, {
          settings,
          db,
          fnRuntime,
        });
        return Response.json({ success: true, summary });
      }
      const body = (await request.json().catch(() => null)) as any;
      if (body?.action === 'save') {
        const label = String(body.label ?? '').trim();
        const cronExpr = String(body.cron ?? '').trim();
        const logicalKey =
          String(body.job_key ?? '').trim() ||
          label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        if (!logicalKey || !label || !cronExpr) {
          return Response.json(
            { error: 'label and cron are required.' },
            { status: 400 },
          );
        }
        const jobKey = scope.key(logicalKey);
        const actionType = String(body.action_type || 'http_webhook');
        const timezone = String(body.timezone || 'UTC');
        const configJson =
          body.config_json != null ? JSON.stringify(body.config_json) : null;
        await db.execute(
          buildUpsertSql({
            table: '_lls_crons',
            conflictCols: ['job_key'],
            insertCols: [
              'job_key',
              'project_id',
              'label',
              'action_type',
              'cron_expr',
              'timezone',
              'enabled',
              'config_json',
            ],
            updateCols: [
              'project_id',
              'label',
              'action_type',
              'cron_expr',
              'timezone',
              'enabled',
              'config_json',
            ],
            dialect: db.dialect,
          }),
          [
            jobKey,
            scope.projectId,
            label,
            actionType,
            cronExpr,
            timezone,
            db.dialect === 'postgres'
              ? body.enabled !== false
              : body.enabled !== false
                ? 1
                : 0,
            configJson,
          ],
        );
        const [saved] = await db.query<any>(
          'SELECT * FROM _lls_crons WHERE job_key = ?',
          [jobKey],
        );
        return Response.json({ success: true, job: normalize(saved) });
      }

      const logicalKey = String(body?.job_key ?? '').trim();
      if (logicalKey === 'all') {
        const enabledCond =
          db.dialect === 'postgres' ? 'enabled = TRUE' : 'enabled = 1';
        const rows = await db.query<any>(
          `SELECT * FROM _lls_crons WHERE ${scope.where} AND ${enabledCond}`,
          scope.params,
        );
        for (const job of rows) await executeJob(job, job.job_key);
        return Response.json({ success: true });
      }

      const jobKey = scope.key(logicalKey);
      const [job] = await db.query<any>(
        `SELECT * FROM _lls_crons WHERE job_key = ? AND ${scope.where}`,
        [jobKey, ...scope.params],
      );
      if (!job)
        return Response.json({ error: 'Schedule not found.' }, { status: 404 });
      const res = await executeJob(job, jobKey);
      return res.ok
        ? Response.json({ success: true, summary: res.summary })
        : Response.json({ error: res.error }, { status: 500 });
    }

    if (method === 'DELETE') {
      const logicalKey = new URL(request.url).searchParams.get('job_key') || '';
      await db.execute(
        `DELETE FROM _lls_crons WHERE job_key = ? AND ${scope.where}`,
        [scope.key(logicalKey), ...scope.params],
      );
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  };
}
