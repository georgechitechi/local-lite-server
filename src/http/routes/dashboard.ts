import fs from 'node:fs';
import path from 'node:path';
import {
  quoteIdent,
  type SqlExecutor,
  type SyncEventBroker,
} from 'local-lite/server';
import type { ApiKeyService } from '../../auth/apiKeys.js';
import type { CommandRuntime } from '../../commands/index.js';
import type { ServerSettings } from '../../config.js';
import {
  compactChangeLog,
  newRowId,
  recordChange,
  setRowDeleted,
  upsertTableRow,
} from '../../core/changes.js';
import type { LensRegistry } from '../../db/lenses.js';
import type { ProjectionRegistry } from '../../db/projections.js';
import type { SchemaDictionary } from '../../db/schema.js';
import { fromDbRow } from '../../db/tableStorage.js';
import type { AuthContext } from '../authContext.js';
import type { WsStats } from '../ws.js';

export function dashboardRoutes(deps: {
  authCtx: AuthContext;
  db: SqlExecutor;
  settings: ServerSettings;
  schema: SchemaDictionary;
  broker: SyncEventBroker;
  apiKeys: ApiKeyService;
  cmdRuntime: CommandRuntime;
  lenses: LensRegistry;
  projections: ProjectionRegistry;
  getWsStats: () => WsStats;
}) {
  const {
    authCtx,
    db,
    settings,
    schema,
    broker,
    apiKeys,
    cmdRuntime,
    lenses,
    projections,
    getWsStats,
  } = deps;
  const startedAt = Date.now();
  const q = (n: string) => quoteIdent(n, db.dialect);
  const notDeleted = db.dialect === 'postgres' ? 'FALSE' : '0';

  const requireAdmin = async (request: Request) => {
    const auth = await authCtx.resolveAuth(request, true);
    if (!auth) return { error: authCtx.unauthorized() };
    if (!auth.isAdmin) return { error: authCtx.forbidden('Admin key required.') };
    return { auth };
  };

  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json; charset=utf-8',
  };

  const distDir = path.resolve(import.meta.dirname, '../../../dashboard/dist');

  const serveAsset = async (relPath: string) => {
    const clean = relPath.replace(/^\/+/, '') || 'index.html';
    const target = path.resolve(distDir, clean);
    if (
      target.startsWith(distDir) &&
      fs.existsSync(target) &&
      fs.statSync(target).isFile()
    ) {
      const ext = path.extname(target);
      return new Response(fs.readFileSync(target), {
        status: 200,
        headers: {
          'Content-Type': MIME[ext] ?? 'application/octet-stream',
        },
      });
    }
    const indexFile = path.join(distDir, 'index.html');
    if (fs.existsSync(indexFile)) {
      return new Response(fs.readFileSync(indexFile), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('Dashboard not built. Run: npm run build:dashboard', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  };

  return {
    '/dashboard': { GET: () => serveAsset('index.html') },
    '/stats': { GET: () => serveAsset('index.html') },
    '/stats.json': {
      GET: async ({ request }: { request: Request }) => {
        const gate = await requireAdmin(request);
        if (gate.error) return gate.error;

        let checkpoint = 0;
        let compactedFloor = 0;
        let changeLogCount = 0;
        try {
          const clock = await db.query<{
            checkpoint?: number;
            compacted_floor?: number;
          }>(
            `SELECT checkpoint, compacted_floor FROM ${q('_server_sync_clock')} WHERE id = 1`,
          );
          checkpoint = Number(clock[0]?.checkpoint ?? 0);
          compactedFloor = Number(clock[0]?.compacted_floor ?? 0);
          const cnt = await db.query<{ n?: number }>(
            `SELECT COUNT(*) AS n FROM ${q('_server_changes')}`,
          );
          changeLogCount = Number(cnt[0]?.n ?? 0);
        } catch {
          // ignore if uninitialized in minimal mocks
        }

        const outbox = { pending: 0, delivered: 0, deadLetter: 0 };
        try {
          const ob = await db.query<{ status: string; n: number }>(
            `SELECT status, COUNT(*) AS n FROM ${q('_server_outbox')} GROUP BY status`,
          );
          for (const r of ob) {
            if (r.status === 'pending') outbox.pending = Number(r.n);
            else if (r.status === 'delivered') outbox.delivered = Number(r.n);
            else if (r.status === 'dead_letter') outbox.deadLetter = Number(r.n);
          }
        } catch {
          // ignore if uninitialized
        }

        const tables: Array<{ name: string; count: number }> = [];
        for (const t of Object.keys(schema)) {
          try {
            const rows = await db.query<{ n?: number }>(
              `SELECT COUNT(*) AS n FROM ${q(t)} WHERE ${q('deleted')} = ${notDeleted}`,
            );
            tables.push({ name: t, count: Number(rows[0]?.n ?? 0) });
          } catch {
            tables.push({ name: t, count: 0 });
          }
        }

        return Response.json({
          server: {
            uptimeMs: Date.now() - startedAt,
            dialect: settings.dialect,
            multiInstance: settings.multiInstance,
            nodeVersion: process.version,
            memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
          },
          sync: { checkpoint, compactedFloor, changeLogCount },
          outbox,
          ws: getWsStats(),
          tables,
          commands: cmdRuntime.list(),
          lenses: [...lenses.keys()],
          projections: [...projections.keys()],
        });
      },
    },
    '/dashboard/api/rows': {
      GET: async ({ request }: { request: Request }) => {
        const gate = await requireAdmin(request);
        if (gate.error) return gate.error;
        const url = new URL(request.url);
        const table = url.searchParams.get('table') ?? '';
        const fields = Object.hasOwn(schema, table) ? schema[table] : undefined;
        if (!fields) {
          return Response.json({ error: `Unknown table "${table}".` }, { status: 400 });
        }
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 200);
        const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);
        const includeDeleted = url.searchParams.get('includeDeleted') === '1';
        const where = includeDeleted ? '' : `WHERE ${q('deleted')} = ${notDeleted}`;
        const raw = await db.query<Record<string, any>>(
          `SELECT * FROM ${q(table)} ${where} ORDER BY ${q('updated_at')} DESC LIMIT ${limit} OFFSET ${offset}`,
        );
        return Response.json({
          rows: raw.map((r) => ({ id: String(r.id), ...fromDbRow(fields, r) })),
        });
      },
      POST: async ({ request }: { request: Request }) => {
        const gate = await requireAdmin(request);
        if (gate.error) return gate.error;
        const body = (await request.json().catch(() => ({}))) as Record<string, any>;
        const table = String(body.table ?? '');
        const fields = Object.hasOwn(schema, table) ? schema[table] : undefined;
        if (!fields) {
          return Response.json({ error: `Unknown table "${table}".` }, { status: 400 });
        }

        if (body.action === 'insert') {
          const data = body.data && typeof body.data === 'object' ? body.data : {};
          const id = newRowId(data.id);
          const ts = await db.withTransaction(async (tx) => {
            const c = await recordChange(tx, table, id);
            await upsertTableRow(tx, table, fields, id, data, c);
            return c;
          });
          broker.publish({
            scopeId: typeof data.scope_id === 'string' && data.scope_id ? data.scope_id : 'default',
            tableName: table,
            checkpoint: ts,
            rowId: id,
            op: 'insert',
            changedCols: Object.keys(data),
          });
          return Response.json({ success: true, id, checkpoint: ts });
        }

        if (body.action === 'remove') {
          const id = String(body.id ?? '');
          if (!id) return Response.json({ error: 'id required.' }, { status: 400 });
          const ts = await db.withTransaction(async (tx) => {
            const c = await recordChange(tx, table, id);
            await setRowDeleted(tx, table, id, true, c);
            return c;
          });
          broker.publish({
            scopeId: 'default',
            tableName: table,
            checkpoint: ts,
            rowId: id,
            op: 'remove',
          });
          return Response.json({ success: true, checkpoint: ts });
        }

        return Response.json({ error: 'Unsupported action.' }, { status: 400 });
      },
    },
    '/dashboard/api/outbox': {
      GET: async ({ request }: { request: Request }) => {
        const gate = await requireAdmin(request);
        if (gate.error) return gate.error;
        const status = new URL(request.url).searchParams.get('status') || 'all';
        const where = status !== 'all' ? 'WHERE status = ?' : '';
        const params = status !== 'all' ? [status] : [];
        const rows = await db.query<Record<string, any>>(
          `SELECT * FROM ${q('_server_outbox')} ${where} ORDER BY created_at DESC LIMIT 100`,
          params,
        );
        return Response.json({ rows });
      },
    },
    '/dashboard/api/outbox/retry': {
      POST: async ({ request }: { request: Request }) => {
        const gate = await requireAdmin(request);
        if (gate.error) return gate.error;
        const body = (await request.json().catch(() => ({}))) as { id?: string };
        if (!body.id) return Response.json({ error: 'id required.' }, { status: 400 });
        await db.execute(
          `UPDATE ${q('_server_outbox')} SET status = ?, next_attempt_at = ? WHERE id = ?`,
          ['pending', Date.now(), body.id],
        );
        return Response.json({ success: true });
      },
    },
    '/dashboard/api/outbox/purge': {
      POST: async ({ request }: { request: Request }) => {
        const gate = await requireAdmin(request);
        if (gate.error) return gate.error;
        const res = await db.execute(
          `DELETE FROM ${q('_server_outbox')} WHERE status = ?`,
          ['delivered'],
        );
        return Response.json({ success: true, deleted: Number(res.affectedRows ?? 0) });
      },
    },
    '/dashboard/api/changes': {
      GET: async ({ request }: { request: Request }) => {
        const gate = await requireAdmin(request);
        if (gate.error) return gate.error;
        const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit') || 50), 1), 200);
        const rows = await db.query<Record<string, any>>(
          `SELECT id, table_name, row_id, ${q('timestamp')} AS ts FROM ${q('_server_changes')} ORDER BY ${q('timestamp')} DESC LIMIT ${limit}`,
        );
        return Response.json({ rows });
      },
    },
    '/dashboard/api/changes/compact': {
      POST: async ({ request }: { request: Request }) => {
        const gate = await requireAdmin(request);
        if (gate.error) return gate.error;
        const body = (await request.json().catch(() => ({}))) as { retentionDays?: number };
        const res = await compactChangeLog(db, {
          retentionDays: Number(body.retentionDays ?? 30),
        });
        return Response.json({ success: true, ...res });
      },
    },
    '/dashboard/api/auth': {
      GET: async ({ request }: { request: Request }) => {
        const gate = await requireAdmin(request);
        if (gate.error) return gate.error;
        const keys = await apiKeys.listKeys();
        let accounts: Array<Record<string, any>> = [];
        try {
          accounts = await db.query<Record<string, any>>(
            'SELECT id, email, display_name, created_at FROM _local_auth_accounts ORDER BY created_at DESC LIMIT 100',
          );
        } catch {
          accounts = [];
        }
        return Response.json({ keys, accounts });
      },
    },
    '/dashboard/api/keys': {
      POST: async ({ request }: { request: Request }) => {
        const gate = await requireAdmin(request);
        if (gate.error) return gate.error;
        const body = (await request.json().catch(() => ({}))) as {
          name?: string;
          role?: 'admin' | 'user';
        };
        const created = await apiKeys.createKey({
          name: String(body.name ?? 'Dashboard Key'),
          role: body.role === 'user' ? 'user' : 'admin',
        });
        return Response.json({ success: true, ...created });
      },
    },
    '/dashboard/api/keys/:id': {
      DELETE: async ({
        request,
        params,
      }: {
        request: Request;
        params: Record<string, string>;
      }) => {
        const gate = await requireAdmin(request);
        if (gate.error) return gate.error;
        await apiKeys.deleteKey(params.id);
        return Response.json({ success: true });
      },
    },
    '/dashboard/*': {
      GET: ({ request }: { request: Request }) => {
        const pathname = new URL(request.url).pathname;
        return serveAsset(pathname.slice('/dashboard/'.length));
      },
    },
  };
}
