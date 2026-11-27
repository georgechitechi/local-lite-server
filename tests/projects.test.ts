import { describe, expect, it } from 'vitest';
import { loadSettings } from '../src/config.js';
import { createProjectService, toPhysicalTable } from '../src/projects.js';
import { normalizeSchema } from '../src/schema.js';
import { createApp } from '../src/server.js';
import { TableSyncStorage } from '../src/tableStorage.js';

const baseEnv = {
  DB_DIALECT: 'mysql',
  DB_HOST: 'h',
  DB_USER: 'u',
  DB_NAME: 'n',
  SERVER_API_KEY: 'master-secret',
  APP_SECRET: 'test-app-secret-1234',
  ADMIN_UI: 'true',
  ALLOW_CONSOLE_SIGNUP: 'true',
} as NodeJS.ProcessEnv;

function createMockDb() {
  const accounts = new Map<string, any>();
  const projects = new Map<string, any>();
  const keys = new Map<string, any>();
  const changes: any[] = [];
  const tables = new Map<string, Map<string, any>>();
  const executedSql: string[] = [];
  let checkpoint = 1000;

  const getTable = (name: string) => {
    let t = tables.get(name);
    if (!t) {
      t = new Map();
      tables.set(name, t);
    }
    return t;
  };

  const ex: any = {
    dialect: 'mysql',
    executedSql,
    tables,
    changes,
    query: async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM _local_auth_accounts WHERE email = ?')) {
        for (const a of accounts.values()) {
          if (a.email === params[0]) return [a];
        }
        return [];
      }
      if (sql.includes('FROM _local_auth_accounts WHERE id = ?')) {
        const a = accounts.get(params[0]);
        return a ? [a] : [];
      }
      if (sql.includes('FROM _lls_projects WHERE slug = ?')) {
        for (const p of projects.values()) {
          if (p.slug === params[0]) return [p];
        }
        return [];
      }
      if (sql.includes('FROM _lls_projects WHERE owner_user_id = ?')) {
        return Array.from(projects.values()).filter((p) => p.owner_user_id === params[0]);
      }
      if (sql.includes('FROM _lls_projects WHERE id = ? OR slug = ?')) {
        for (const p of projects.values()) {
          if (p.id === params[0] || p.slug === params[1]) return [p];
        }
        return [];
      }
      if (sql.includes('FROM _lls_projects')) {
        return Array.from(projects.values());
      }
      if (sql.includes('FROM _lls_api_keys WHERE key_hash = ?')) {
        for (const k of keys.values()) {
          if (k.key_hash === params[0]) return [k];
        }
        return [];
      }
      if (sql.includes('FROM _lls_api_keys')) {
        return Array.from(keys.values()).filter((k) =>
          sql.includes('WHERE project_id = ?') ? k.project_id === params[0] : k.project_id == null,
        );
      }
      if (sql.includes('FROM `information_schema`')) {
        return [];
      }
      if (sql.includes('FROM `_server_sync_clock`')) {
        return [{ checkpoint }];
      }
      if (sql.includes('FROM `_server_changes`')) {
        const since = Number(params[0] ?? 0);
        const hasPid = sql.includes('project_id = ?');
        const pid = hasPid ? params[1] : null;
        return changes
          .filter((c) => c.timestamp > since && (hasPid ? c.project_id === pid : c.project_id == null))
          .map((c) => ({ table_name: c.table_name, row_id: c.row_id, ts: c.timestamp }));
      }
      const m = sql.match(/SELECT \* FROM `([^`]+)` WHERE `id` IN/);
      if (m) {
        const t = getTable(m[1]);
        return params.map((id) => t.get(id)).filter(Boolean);
      }
      if (sql.includes('SELECT COUNT(*) AS n FROM')) {
        return [{ n: 0 }];
      }
      return [];
    },
    execute: async (sql: string, params: any[] = []) => {
      executedSql.push(sql);
      if (sql.startsWith('INSERT INTO _local_auth_accounts')) {
        accounts.set(params[0], {
          id: params[0],
          email: params[1],
          password_hash: params[2],
          display_name: params[3],
          console_role: params[4],
          console_active: params[5],
          token_version: 1,
          created_at: params[6],
          updated_at: params[7],
        });
        return { affectedRows: 1 };
      }
      if (sql.startsWith('INSERT INTO _lls_projects')) {
        projects.set(params[0], {
          id: params[0],
          slug: params[1],
          name: params[2],
          owner_user_id: params[3],
          schema_json: params[4],
          rules_json: params[5],
          created_at: params[6],
          updated_at: params[7],
        });
        return { affectedRows: 1 };
      }
      if (sql.startsWith('UPDATE _lls_projects SET schema_json = ?')) {
        const p = projects.get(params[2]);
        if (p) {
          p.schema_json = params[0];
          p.updated_at = params[1];
        }
        return { affectedRows: p ? 1 : 0 };
      }
      if (sql.startsWith('DELETE FROM _lls_projects WHERE id = ?')) {
        return { affectedRows: projects.delete(params[0]) ? 1 : 0 };
      }
      if (sql.startsWith('INSERT INTO _lls_api_keys')) {
        keys.set(params[0], {
          id: params[0],
          name: params[1],
          key_prefix: params[2],
          key_hash: params[3],
          role: params[4],
          user_id: params[5],
          project_id: params[6],
          created_by: params[7],
          last_used_at: null,
          expires_at: params[8],
          revoked_at: null,
          created_at: params[9],
        });
        return { affectedRows: 1 };
      }
      if (sql.startsWith('UPDATE `_server_sync_clock` SET checkpoint = ?')) {
        checkpoint = Number(params[0]);
        return { affectedRows: 1 };
      }
      if (sql.startsWith('INSERT INTO `_server_changes`')) {
        changes.push({
          table_name: params[0],
          row_id: params[1],
          timestamp: Number(params[2]),
          project_id: params[3] ?? null,
        });
        return { affectedRows: 1 };
      }
      const upsert = sql.match(/INSERT INTO `([^`]+)` \(([^)]+)\)/);
      if (upsert) {
        const tbl = getTable(upsert[1]);
        const cols = upsert[2].split(',').map((c) => c.trim().replace(/`/g, ''));
        const row: Record<string, any> = {};
        cols.forEach((c, i) => {
          row[c] = params[i];
        });
        tbl.set(String(row.id), row);
        return { affectedRows: 1 };
      }
      return { affectedRows: 0 };
    },
    withTransaction: async (fn: any) => fn(ex),
  };
  return ex;
}

describe('multi-project central server', () => {
  it('maps logical tables to p_<shortId>_<table> physical SQL tables', () => {
    const pid = 'prj_1234567890abcdef';
    expect(toPhysicalTable(pid, 'notes')).toBe('p_12345678_notes');
    expect(toPhysicalTable(null, 'notes')).toBe('notes');
  });

  it('allows console developer self-signup when ALLOW_CONSOLE_SIGNUP=true and isolates projects per owner', async () => {
    const db = createMockDb();
    const app = createApp(loadSettings(baseEnv), db, normalizeSchema({ server_notes: { title: 'string' } }));

    // Disabled check
    const appNoSignup = createApp(
      loadSettings({ ...baseEnv, ALLOW_CONSOLE_SIGNUP: 'false' }),
      db,
      normalizeSchema({}),
    );
    const blocked = await appNoSignup.fetch(
      new Request('http://localhost/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'signup', email: 'a@test.com', password: 'password123' }),
      }),
    );
    expect(blocked.status).toBe(403);

    // User A signs up -> console_role = 'admin'
    const signupA = await app.fetch(
      new Request('http://localhost/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'signup', email: 'alice@test.com', password: 'password123', name: 'Alice' }),
      }),
    );
    expect(signupA.status).toBe(200);
    const cookieA = signupA.headers.get('set-cookie')!.split(';')[0];

    // User B signs up
    const signupB = await app.fetch(
      new Request('http://localhost/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'signup', email: 'bob@test.com', password: 'password123', name: 'Bob' }),
      }),
    );
    expect(signupB.status).toBe(200);
    const cookieB = signupB.headers.get('set-cookie')!.split(';')[0];

    // User A creates a project with schema
    const createA = await app.fetch(
      new Request('http://localhost/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieA },
        body: JSON.stringify({
          name: 'Alice App',
          slug: 'alice-app',
          schema: { notes: { title: 'string' } },
        }),
      }),
    );
    expect(createA.status).toBe(201);
    const { project: projA } = (await createA.json()) as any;
    expect(projA.slug).toBe('alice-app');

    // User B lists projects -> sees 0 (cannot see Alice's project)
    const listB = await app.fetch(
      new Request('http://localhost/projects', { headers: { cookie: cookieB } }),
    );
    expect(((await listB.json()) as any).projects).toHaveLength(0);

    // User B cannot access Alice's project via X-Project-Id or delete it
    const crossTable = await app.fetch(
      new Request('http://localhost/admin/table?table=notes', {
        headers: { cookie: cookieB, 'x-project-id': projA.id },
      }),
    );
    expect(crossTable.status).toBe(403);

    const crossDel = await app.fetch(
      new Request(`http://localhost/projects/${projA.id}`, {
        method: 'DELETE',
        headers: { cookie: cookieB },
      }),
    );
    expect(crossDel.status).toBe(403);

    // Regular admin cannot access Default server tables or super_admin endpoints
    const defaultTable = await app.fetch(
      new Request('http://localhost/admin/table?table=server_notes', {
        headers: { cookie: cookieA },
      }),
    );
    expect(defaultTable.status).toBe(403);

    const adminUsers = await app.fetch(
      new Request('http://localhost/admin/users', { headers: { cookie: cookieA } }),
    );
    expect(adminUsers.status).toBe(403);

    // Super admin (master key) sees all projects
    const listSuper = await app.fetch(
      new Request('http://localhost/projects', {
        headers: { authorization: 'Bearer master-secret' },
      }),
    );
    expect(((await listSuper.json()) as any).projects).toHaveLength(1);
  });

  it('scopes API keys and sync storage to isolated project tables', async () => {
    const db = createMockDb();
    const app = createApp(loadSettings(baseEnv), db, normalizeSchema({}));

    const signup = await app.fetch(
      new Request('http://localhost/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'signup', email: 'dev@test.com', password: 'password123' }),
      }),
    );
    const cookie = signup.headers.get('set-cookie')!.split(';')[0];

    const p1Res = await app.fetch(
      new Request('http://localhost/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: 'App One', slug: 'app-one', schema: { notes: { title: 'string' } } }),
      }),
    );
    const { project: p1 } = (await p1Res.json()) as any;

    const p2Res = await app.fetch(
      new Request('http://localhost/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: 'App Two', slug: 'app-two', schema: { notes: { title: 'string' } } }),
      }),
    );
    const { project: p2 } = (await p2Res.json()) as any;

    // Create project-scoped API key for App One
    const keyRes = await app.fetch(
      new Request('http://localhost/admin/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, 'x-project-id': p1.id },
        body: JSON.stringify({ name: 'App One Key', role: 'admin' }),
      }),
    );
    expect(keyRes.status).toBe(201);
    const { key: p1Key } = (await keyRes.json()) as any;

    // Push via /sync using p1Key (auto-scoped to App One!)
    const pushRes = await app.fetch(
      new Request('http://localhost/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${p1Key}` },
        body: JSON.stringify({
          operations: [
            { id: 'op1', tableName: 'notes', rowId: 'n1', operation: 'UPDATE', payload: { title: 'Hello P1' } },
          ],
        }),
      }),
    );
    expect(pushRes.status).toBe(200);

    // Physical table p_<shortId>_notes holds the row, and _server_changes has project_id = p1.id
    const physTable = toPhysicalTable(p1.id, 'notes');
    expect(db.tables.get(physTable)?.get('n1')?.title).toBe('Hello P1');
    expect(db.changes.at(-1)?.project_id).toBe(p1.id);

    // Pull via /p/app-one/sync succeeds; /p/app-two/sync with p1Key is forbidden
    const pullP1 = await app.fetch(
      new Request('http://localhost/p/app-one/sync?tables=notes&since=0', {
        headers: { authorization: `Bearer ${p1Key}` },
      }),
    );
    expect(pullP1.status).toBe(200);
    const pullP1Json = (await pullP1.json()) as any;
    expect(pullP1Json.changes.changes).toHaveLength(1);
    expect(pullP1Json.changes.changes[0].payload.title).toBe('Hello P1');

    const pullP2 = await app.fetch(
      new Request('http://localhost/p/app-two/sync?tables=notes&since=0', {
        headers: { authorization: `Bearer ${p1Key}` },
      }),
    );
    expect(pullP2.status).toBe(403);
  });

  it('supports TableSyncStorage and project service directly', async () => {
    const db = createMockDb();
    const svc = createProjectService(db);
    const proj = await svc.createProject({
      name: 'Direct',
      slug: 'direct',
      ownerUserId: 'u1',
      schema: { items: { label: 'string' } },
    });
    const storage = new TableSyncStorage(db, { schema: proj.schema, projectId: proj.id });
    await storage.applyOperations([
      { id: '1', tableName: 'items', rowId: 'i1', operation: 'UPDATE', payload: { label: 'One' } },
    ]);
    const deltas = await storage.getDeltas(['items'], 0, 50);
    expect(deltas.changes.changes).toHaveLength(1);
    expect(deltas.changes.changes[0].tableName).toBe('items');
    expect(deltas.changes.changes[0].payload?.label).toBe('One');
  });
});
