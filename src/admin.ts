import crypto from 'node:crypto';
import { buildUpsertSql, quoteIdent, type SqlExecutor, type SyncEventBroker } from 'local-lite/server';
import type { ServerSettings } from './config.js';
import { planSchema, type SchemaDictionary } from './schema.js';
import { coreMigrationStatus } from './migrations.js';
import type { AuthService } from './auth.js';
import type { FunctionKind } from './functions.js';
import { fromDbRow, toDbValue } from './tableStorage.js';
import { renderAdminHtml } from './adminUi.js';

const int = (v: string | null, d: number, min: number, max: number) =>
  Math.min(Math.max(Math.floor(Number(v ?? d)) || d, min), max);

const SYSTEM_COLS = new Set(['id', 'updated_at', 'deleted']);

export function createAdmin(
  s: ServerSettings,
  db: SqlExecutor,
  schema: SchemaDictionary,
  auth: AuthService,
  opts: {
    broker?: SyncEventBroker;
    listFunctions?: () => Array<{ name: string; kind: FunctionKind }>;
  } = {},
) {
  const q = (n: string) => quoteIdent(n, db.dialect);
  const notDeleted = db.dialect === 'postgres' ? 'FALSE' : '0';

  async function recordChange(tx: SqlExecutor, table: string, id: string): Promise<number> {
    const clock = await tx.query<{ checkpoint: number }>(
      `SELECT checkpoint FROM ${q('_server_sync_clock')} WHERE id = 1 FOR UPDATE`,
    );
    const ts = Math.max(Date.now(), Number(clock[0]?.checkpoint ?? 0) + 1);
    await tx.execute(
      `INSERT INTO ${q('_server_changes')} (table_name, row_id, ${q('timestamp')}) VALUES (?, ?, ?)`,
      [table, id, ts],
    );
    await tx.execute(`UPDATE ${q('_server_sync_clock')} SET checkpoint = ? WHERE id = 1`, [ts]);
    return ts;
  }

  return {
    async status(): Promise<Response> {
      const tables: Record<string, number> = {};
      for (const t of Object.keys(schema)) {
        tables[t] = Number((await db.query<any>(`SELECT COUNT(*) AS n FROM ${q(t)}`))[0]?.n ?? 0);
      }
      const clock = await db.query<any>('SELECT checkpoint FROM _server_sync_clock WHERE id = 1');
      const plan = await planSchema(db, schema).catch(() => null);
      return Response.json({
        dialect: s.dialect,
        database: s.db.database,
        cursor: Number(clock[0]?.checkpoint ?? 0),
        accounts: { enabled: auth.enabled, users: await auth.userCount() },
        smtp: Boolean(s.smtp),
        autoMigrate: s.autoMigrate,
        tables,
        schema,
        functions: opts.listFunctions?.() ?? [],
        core: await coreMigrationStatus(db),
        schemaPending: plan ? plan.up.length : null,
        schemaWarnings: plan?.warnings ?? [],
        serverTime: Date.now(),
      });
    },

    async rows(table: string, url: URL): Promise<Response> {
      if (!Object.hasOwn(schema, table)) return Response.json({ error: 'Unknown table.' }, { status: 404 });
      const fields = schema[table];
      const limit = int(url.searchParams.get('limit'), 50, 1, 500);
      const offset = int(url.searchParams.get('offset'), 0, 0, 10_000_000);
      const includeDeleted = url.searchParams.get('includeDeleted') === '1';
      const where = includeDeleted ? '' : `WHERE ${q('deleted')} = ${notDeleted}`;
      const total = Number(
        (await db.query<any>(`SELECT COUNT(*) AS n FROM ${q(table)} ${where}`))[0]?.n ?? 0,
      );
      const raw = await db.query<Record<string, any>>(
        `SELECT * FROM ${q(table)} ${where} ORDER BY ${q('updated_at')} DESC LIMIT ${limit} OFFSET ${offset}`,
      );
      const rows = raw.map((r) => ({ id: String(r.id), ...fromDbRow(fields, r) }));
      const columns = [...Object.keys(fields), 'deleted', 'updated_at'];
      return Response.json({ table, columns, total, limit, offset, rows });
    },

    async createRow(table: string, request: Request): Promise<Response> {
      if (!Object.hasOwn(schema, table)) return Response.json({ error: 'Unknown table.' }, { status: 404 });
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') return Response.json({ error: 'Invalid JSON.' }, { status: 400 });
      const fields = schema[table];
      const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : crypto.randomUUID();
      const cols = Object.keys(fields).filter(
        (c) => !SYSTEM_COLS.has(c) && c !== 'created_at' && Object.hasOwn(body, c),
      );
      const ts = await db.withTransaction(async (tx) => {
        const checkpoint = await recordChange(tx, table, id);
        const insertCols = ['id', ...cols, 'updated_at', 'deleted'];
        const params: unknown[] = [
          id,
          ...cols.map((c) => toDbValue(fields[c], body[c], db.dialect)),
          checkpoint,
          db.dialect === 'postgres' ? false : 0,
        ];
        if (fields.created_at) {
          insertCols.push('created_at');
          params.push(body.created_at != null ? toDbValue(fields.created_at, body.created_at, db.dialect) : checkpoint);
        }
        await tx.execute(
          buildUpsertSql({
            table,
            conflictCols: ['id'],
            insertCols,
            updateCols: [...cols, 'updated_at', 'deleted'],
            dialect: db.dialect,
          }),
          params,
        );
        return checkpoint;
      });
      opts.broker?.publish({ scopeId: 'default', tableName: table, checkpoint: ts });
      return Response.json({ success: true, id, cursor: ts }, { status: 201 });
    },

    async updateRow(table: string, id: string, request: Request): Promise<Response> {
      if (!Object.hasOwn(schema, table)) return Response.json({ error: 'Unknown table.' }, { status: 404 });
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') return Response.json({ error: 'Invalid JSON.' }, { status: 400 });
      const fields = schema[table];
      const cols = Object.keys(fields).filter((c) => !SYSTEM_COLS.has(c) && Object.hasOwn(body, c));
      const ts = await db.withTransaction(async (tx) => {
        const checkpoint = await recordChange(tx, table, id);
        const sets = [...cols.map((c) => `${q(c)} = ?`), `${q('updated_at')} = ?`];
        const params = [...cols.map((c) => toDbValue(fields[c], body[c], db.dialect)), checkpoint, id];
        await tx.execute(`UPDATE ${q(table)} SET ${sets.join(', ')} WHERE ${q('id')} = ?`, params);
        return checkpoint;
      });
      opts.broker?.publish({ scopeId: 'default', tableName: table, checkpoint: ts });
      return Response.json({ success: true, id, cursor: ts });
    },

    async deleteRow(table: string, id: string, url: URL): Promise<Response> {
      if (!Object.hasOwn(schema, table)) return Response.json({ error: 'Unknown table.' }, { status: 404 });
      const restore = url.searchParams.get('restore') === '1';
      const delVal = db.dialect === 'postgres' ? !restore : restore ? 0 : 1;
      const ts = await db.withTransaction(async (tx) => {
        const checkpoint = await recordChange(tx, table, id);
        await tx.execute(
          `UPDATE ${q(table)} SET ${q('deleted')} = ?, ${q('updated_at')} = ? WHERE ${q('id')} = ?`,
          [delVal, checkpoint, id],
        );
        return checkpoint;
      });
      opts.broker?.publish({ scopeId: 'default', tableName: table, checkpoint: ts });
      return Response.json({ success: true, id, deleted: !restore, cursor: ts });
    },

    async syncLogs(url: URL): Promise<Response> {
      const limit = int(url.searchParams.get('limit'), 100, 1, 500);
      const table = url.searchParams.get('table')?.trim() || '';
      if (table && !Object.hasOwn(schema, table)) {
        return Response.json({ error: 'Unknown table.' }, { status: 400 });
      }
      const where = table ? 'WHERE table_name = ?' : '';
      const params = table ? [table] : [];
      const logs = await db.query(
        `SELECT id, table_name, row_id, ${q('timestamp')} FROM ${q('_server_changes')} ${where} ORDER BY id DESC LIMIT ${limit}`,
        params,
      );
      return Response.json({ logs });
    },

    async listUsers(): Promise<Response> {
      const users = await db.query(
        'SELECT id, email, display_name, failed_login_attempts, locked_until, token_version, created_at, updated_at FROM _local_auth_accounts ORDER BY created_at DESC LIMIT 200',
      );
      return Response.json({ users });
    },

    async revokeUser(id: string): Promise<Response> {
      await db.execute(
        'UPDATE _local_auth_accounts SET token_version = COALESCE(token_version, 1) + 1, failed_login_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
        [Date.now(), id],
      );
      return Response.json({ success: true });
    },

    page(): Response {
      return new Response(renderAdminHtml(s.appName), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    },
  };
}
