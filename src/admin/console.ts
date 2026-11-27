import { quoteIdent, type SqlExecutor, type SyncEventBroker } from 'local-lite/server';
import type { ServerSettings } from '../config.js';
import type { FunctionRuntime } from '../functions/index.js';
import type { SchemaDictionary } from '../schema.js';
import { toPhysicalTable, type ProjectRecord } from '../projects.js';
import { fromDbRow } from '../tableStorage.js';
import { newRowId, patchTableRow, recordChange, setRowDeleted, upsertTableRow } from '../core/changes.js';
import type { AdminSession } from './session.js';

export const clampInt = (v: string | null, d: number, min: number, max: number) =>
  Math.min(Math.max(Math.floor(Number(v ?? d)) || d, min), max);

export function createAdminData(opts: {
  settings: ServerSettings;
  db: SqlExecutor;
  schema: SchemaDictionary;
  broker?: SyncEventBroker;
  fnRuntime?: FunctionRuntime;
}) {
  const { settings, db, schema, broker, fnRuntime } = opts;
  const q = (n: string) => quoteIdent(n, db.dialect);
  const notDeleted = db.dialect === 'postgres' ? 'FALSE' : '0';

  return {
    async overview(session: AdminSession, project?: ProjectRecord | null) {
      let dbConnected = true;
      let dbError: string | null = null;
      const tableCounts: Array<{ table: string; count: number }> = [];
      const activeSchema = project ? project.schema : session.consoleRole === 'super_admin' ? schema : {};
      try {
        for (const t of Object.keys(activeSchema)) {
          const phys = toPhysicalTable(project?.id ?? null, t);
          const r = await db.query<any>(`SELECT COUNT(*) AS n FROM ${q(phys)}`);
          tableCounts.push({ table: t, count: Number(r[0]?.n ?? 0) });
        }
      } catch {
        dbConnected = false;
        dbError = 'Database unavailable';
      }
      let accountsCount = 0;
      let backupsCount = 0;
      if (session.consoleRole === 'super_admin') {
        const acctRow = await db.query<any>('SELECT COUNT(*) AS n FROM _local_auth_accounts');
        const bkpRow = await db.query<any>('SELECT COUNT(*) AS n FROM _lls_backups');
        accountsCount = Number(acctRow[0]?.n ?? 0);
        backupsCount = Number(bkpRow[0]?.n ?? 0);
      }
      return Response.json({
        health: { ok: dbConnected, dialect: settings.dialect },
        dbConnected,
        dbError,
        tableCounts,
        accountsCount,
        backupsCount,
        consoleRole: session.consoleRole,
      });
    },

    async listEndpoints() {
      const fns = (fnRuntime?.list() ?? []).map((f) => ({
        method: f.kind.toUpperCase(),
        path: `/fn/${f.name}`,
      }));
      return Response.json({
        endpoints: [
          { method: 'GET', path: '/health' },
          { method: 'GET', path: '/sync' },
          { method: 'POST', path: '/sync' },
          { method: 'GET', path: '/sync/events' },
          ...fns,
        ],
      });
    },

    async listUsers(project?: ProjectRecord | null) {
      const projectId = project?.id ?? null;
      const where = projectId ? 'WHERE project_id = ?' : 'WHERE project_id IS NULL';
      const params = projectId ? [projectId] : [];
      const accounts = await db.query<any>(
        `SELECT id, email, display_name, failed_login_attempts, locked_until, console_role, console_active, created_at
         FROM _local_auth_accounts ${where} ORDER BY created_at DESC LIMIT 200`,
        params,
      );
      return Response.json({
        localAccounts: accounts.map((a) => ({
          id: String(a.id),
          email: String(a.email),
          displayName: a.display_name ?? null,
          failedLoginAttempts: Number(a.failed_login_attempts ?? 0),
          lockedUntil: a.locked_until != null ? Number(a.locked_until) : null,
          tokenVersion: 1,
          consoleRole: a.console_role ?? null,
          consoleActive: Boolean(a.console_active),
          createdAt: Number(a.created_at),
        })),
      });
    },

    async handleTable(
      request: Request,
      project?: ProjectRecord | null,
      tableOverride?: string,
      idOverride?: string,
    ) {
      const activeSchema = project ? project.schema : schema;
      const projectId = project?.id ?? null;
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      if (method === 'GET') {
        const table = tableOverride || url.searchParams.get('table') || '';
        if (!Object.hasOwn(activeSchema, table)) return Response.json({ error: 'Invalid table name.' }, { status: 400 });
        const fields = activeSchema[table];
        const phys = toPhysicalTable(projectId, table);
        const limit = clampInt(url.searchParams.get('limit'), 30, 1, 500);
        const offset = clampInt(url.searchParams.get('offset'), 0, 0, 10_000_000);
        const where = url.searchParams.get('includeDeleted') === '1' ? '' : `WHERE ${q('deleted')} = ${notDeleted}`;
        const total = Number((await db.query<any>(`SELECT COUNT(*) AS n FROM ${q(phys)} ${where}`))[0]?.n ?? 0);
        const raw = await db.query<Record<string, any>>(
          `SELECT * FROM ${q(phys)} ${where} ORDER BY ${q('updated_at')} DESC LIMIT ${limit} OFFSET ${offset}`,
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
      if (!Object.hasOwn(activeSchema, table)) return Response.json({ error: 'Invalid table name.' }, { status: 400 });
      const fields = activeSchema[table];
      const phys = toPhysicalTable(projectId, table);
      const rowData = body?.row && typeof body.row === 'object' ? body.row : body || {};

      if (method === 'POST' || method === 'PATCH') {
        const id = idOverride || newRowId(rowData.id);
        const ts = await db.withTransaction(async (tx) => {
          const checkpoint = await recordChange(tx, table, id, '_server_changes', '_server_sync_clock', projectId);
          if (method === 'PATCH') await patchTableRow(tx, phys, fields, id, rowData, checkpoint);
          else await upsertTableRow(tx, phys, fields, id, rowData, checkpoint);
          return checkpoint;
        });
        broker?.publish({ scopeId: 'default', tableName: table, checkpoint: ts });
        return Response.json({ success: true, id, cursor: ts }, { status: method === 'POST' ? 201 : 200 });
      }

      if (method === 'DELETE') {
        const id = idOverride || url.searchParams.get('id') || String(body?.id ?? '');
        const restore = url.searchParams.get('restore') === '1';
        const ts = await db.withTransaction(async (tx) => {
          const checkpoint = await recordChange(tx, table, id, '_server_changes', '_server_sync_clock', projectId);
          await setRowDeleted(tx, phys, id, !restore, checkpoint);
          return checkpoint;
        });
        broker?.publish({ scopeId: 'default', tableName: table, checkpoint: ts });
        return Response.json({ success: true, id, deleted: !restore, cursor: ts });
      }
      return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    },

    async manageUsers(request: Request, session: AdminSession, project?: ProjectRecord | null) {
      const body = (await request.json().catch(() => null)) as Record<string, any> | null;
      const userId = String(body?.userId ?? '');
      const action = String(body?.action ?? '');
      if (!userId) return Response.json({ error: 'userId is required.' }, { status: 400 });
      const projectId = project?.id ?? null;
      const scopeWhere = projectId ? 'AND project_id = ?' : 'AND project_id IS NULL';
      const scopeParams = projectId ? [projectId] : [];

      if (action === 'unlock') {
        await db.execute(
          `UPDATE _local_auth_accounts SET failed_login_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ? ${scopeWhere}`,
          [Date.now(), userId, ...scopeParams],
        );
      } else if (action === 'revoke_sessions') {
        await db.execute(
          `UPDATE _local_auth_accounts SET token_version = COALESCE(token_version, 1) + 1, updated_at = ? WHERE id = ? ${scopeWhere}`,
          [Date.now(), userId, ...scopeParams],
        );
      } else if (action === 'set_console_role') {
        if (session.consoleRole !== 'super_admin' || projectId) {
          return Response.json({ error: 'Super admin on root server required.' }, { status: 403 });
        }
        const role = body?.consoleRole === 'super_admin' || body?.consoleRole === 'admin' ? body.consoleRole : null;
        const active = role !== null;
        await db.execute(
          'UPDATE _local_auth_accounts SET console_role = ?, console_active = ?, updated_at = ? WHERE id = ? AND project_id IS NULL',
          [role, db.dialect === 'postgres' ? active : active ? 1 : 0, Date.now(), userId],
        );
      } else {
        return Response.json({ error: 'Unsupported action.' }, { status: 400 });
      }
      return Response.json({ success: true });
    },

    async handleLogs(url: URL, project?: ProjectRecord | null) {
      const activeSchema = project ? project.schema : schema;
      const projectId = project?.id ?? null;
      const table = url.searchParams.get('table') || 'ALL';
      const limit = clampInt(url.searchParams.get('limit'), 30, 1, 200);
      const offset = clampInt(url.searchParams.get('offset'), 0, 0, 10_000_000);
      const hasTable = table !== 'ALL' && Object.hasOwn(activeSchema, table);
      const clauses = [projectId ? 'project_id = ?' : 'project_id IS NULL'];
      const params: unknown[] = projectId ? [projectId] : [];
      if (hasTable) {
        clauses.push('table_name = ?');
        params.push(table);
      }
      const where = `WHERE ${clauses.join(' AND ')}`;
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
  };
}
