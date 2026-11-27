import {
  createServer,
  createSyncEventBroker,
  createSyncEventsHandler,
  type SqlExecutor,
  type SyncEventBroker,
} from 'local-lite/server';
import type { ServerSettings } from './config.js';
import type { SchemaDictionary } from './schema.js';
import type { RulesDictionary } from './rules.js';
import { ClientError, ForbiddenError, TableSyncStorage } from './tableStorage.js';
import { createAuthService } from './auth.js';
import { createApiKeyService } from './apiKeys.js';
import { handleOAuthTokenExchange, verifyOAuthToken } from './oauth.js';
import { createAdminConsole } from './admin/index.js';
import { createProjectService, type ProjectRecord } from './projects.js';
import { createStorageHandler } from './storage.js';
import { corsHeaders, createHttpServer, safeEqual } from './core/http.js';
import { clientIp, createDistributedRateLimiter } from './rateLimit.js';
import type { CustomRoutesFactory, CustomRoutesMap } from './routes.js';
import {
  createFunctionRuntime,
  FunctionError,
  type FunctionAuth,
  type FunctionRegistry,
} from './functions/index.js';

export { createHttpServer };

export function createApp(
  settings: ServerSettings,
  executor: SqlExecutor,
  schema: SchemaDictionary,
  functions: FunctionRegistry = new Map(),
  rules: RulesDictionary = {},
  brokerOverride?: SyncEventBroker,
  customRoutesInput?: CustomRoutesMap | CustomRoutesFactory,
) {
  const broker = brokerOverride ?? createSyncEventBroker();
  const storage = new TableSyncStorage(executor, { schema, rules, broker });
  const auth = createAuthService(settings, executor);
  const apiKeys = createApiKeyService(executor);
  const projects = createProjectService(executor);
  const fnRuntime = createFunctionRuntime({ registry: functions, db: executor, schema, broker });
  const consoleApi = createAdminConsole({ settings, db: executor, schema, broker, fnRuntime });
  const storageHandler = createStorageHandler(settings, executor, async (req) => {
    const a = await resolveAuth(req, true);
    return a ? { userId: a.userId ?? 'admin', isAdmin: a.isAdmin } : null;
  });
  const authLimiter = createDistributedRateLimiter(executor, 20, 60_000, settings.multiInstance);

  type ResolvedAuth = FunctionAuth & { projectId?: string | null; isSuperAdmin?: boolean };

  const bearer = (request: Request): string => {
    const header = request.headers.get('authorization') ?? '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  };
  const apiKeyHeader = (request: Request): string =>
    request.headers.get('x-api-key')?.trim() ?? '';
  /** Admin key, API key, console cookie session, or a valid user token. */
  const resolveAuth = async (request: Request, allowQuery = false): Promise<ResolvedAuth | null> => {
    const token =
      bearer(request) ||
      apiKeyHeader(request) ||
      (allowQuery ? (new URL(request.url).searchParams.get('token') ?? '') : '');
    if (token) {
      if (safeEqual(token, settings.apiKey)) return { isAdmin: true, isSuperAdmin: true, projectId: null };
      const keyAuth = await apiKeys.verifyKey(token);
      if (keyAuth) return { isAdmin: keyAuth.isAdmin, userId: keyAuth.userId, projectId: keyAuth.projectId ?? null };
      const user = await auth.verifyUser(token);
      if (user) return { isAdmin: false, userId: user.id };
      const oauthUser = await verifyOAuthToken(token);
      if (oauthUser) return { isAdmin: false, userId: oauthUser.id };
    }
    if (settings.adminUi) {
      const adminSession = await consoleApi.authenticate(request);
      if (adminSession) {
        return {
          isAdmin: true,
          userId: adminSession.userId,
          isSuperAdmin: adminSession.consoleRole === 'super_admin',
        };
      }
    }
    return null;
  };
  const canSync = async (request: Request, allowQuery = false): Promise<boolean> =>
    Boolean(await resolveAuth(request, allowQuery));

  const guard = async (run: () => Promise<Response>): Promise<Response> => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof ClientError) {
        return Response.json({ error: err.message }, { status: 400 });
      }
      if (err instanceof ForbiddenError) {
        return Response.json({ error: err.message }, { status: 403 });
      }
      if (err instanceof FunctionError) {
        return Response.json({ error: err.message }, { status: err.status });
      }
      if (err instanceof Error && typeof (err as any).status === 'number') {
        const status = (err as any).status;
        if (status >= 400 && status < 500) {
          return Response.json({ error: err.message }, { status });
        }
      }
      throw err;
    }
  };
  const unauthorized = () => Response.json({ error: 'Unauthorized' }, { status: 401 });
  const forbidden = (msg = 'Forbidden') => Response.json({ error: msg }, { status: 403 });
  type AdminSession = NonNullable<Awaited<ReturnType<typeof consoleApi.authenticate>>>;

  const withAdmin =
    (run: (request: Request, session: AdminSession) => Promise<Response> | Response) =>
    async ({ request }: { request: Request }) => {
      const s = await consoleApi.authenticate(request);
      return s ? run(request, s) : unauthorized();
    };
  const withSuperAdmin =
    (run: (request: Request, session: AdminSession) => Promise<Response> | Response) =>
    withAdmin((request, s) => (s.consoleRole === 'super_admin' ? run(request, s) : forbidden('Super admin required.')));

  const resolveAdminProject = async (
    request: Request,
    s: AdminSession,
    allowDefaultForAdmin = false,
  ): Promise<{ project: ProjectRecord | null; error?: Response }> => {
    const pid =
      request.headers.get('x-project-id')?.trim() ||
      new URL(request.url).searchParams.get('projectId')?.trim() ||
      '';
    if (!pid) {
      if (s.consoleRole !== 'super_admin' && !allowDefaultForAdmin) {
        return { project: null, error: forbidden('Select a project.') };
      }
      return { project: null };
    }
    const project = await projects.getProject(pid);
    if (!project) return { project: null, error: Response.json({ error: 'Project not found.' }, { status: 404 }) };
    if (s.consoleRole !== 'super_admin' && project.ownerUserId !== s.userId) {
      return { project: null, error: forbidden('You do not own this project.') };
    }
    return { project };
  };

  const withAdminProject =
    (run: (request: Request, session: AdminSession, project: ProjectRecord | null) => Promise<Response> | Response) =>
    withAdmin(async (request, s) => {
      const { project, error } = await resolveAdminProject(request, s);
      if (error) return error;
      return run(request, s, project);
    });

  const resolveProjectCaller = async (
    request: Request,
  ): Promise<{ isSuperAdmin: boolean; userId: string | null } | null> => {
    const token = bearer(request) || apiKeyHeader(request);
    if (token && safeEqual(token, settings.apiKey)) {
      return { isSuperAdmin: true, userId: null };
    }
    if (settings.adminUi) {
      const s = await consoleApi.authenticate(request);
      if (s) return { isSuperAdmin: s.consoleRole === 'super_admin', userId: s.userId ?? null };
    }
    return null;
  };
  const canManageProject = (caller: { isSuperAdmin: boolean; userId: string | null }, p: ProjectRecord) =>
    caller.isSuperAdmin || (caller.userId !== null && p.ownerUserId === caller.userId);

  const projectSync = (project: ProjectRecord) =>
    new TableSyncStorage(executor, { schema: project.schema, rules, broker, projectId: project.id });

  const projectStorageEndpoint = (project: ProjectRecord, basePath: string) =>
    createStorageHandler(
      settings,
      executor,
      async (req) => {
        const a = await resolveAuth(req, true);
        if (!a) return null;
        if (a.projectId && a.projectId !== project.id) return null;
        if (a.isAdmin && !a.isSuperAdmin && !a.projectId && project.ownerUserId !== a.userId) return null;
        return { userId: a.userId ?? 'admin', isAdmin: a.isAdmin };
      },
      { projectId: project.id, basePath },
    );

  const handleSyncGet = async (request: Request, slug?: string) => {
    const userAuth = await resolveAuth(request);
    if (!userAuth) return unauthorized();
    const targetId = slug ?? userAuth.projectId ?? null;
    let targetStorage = storage;
    if (targetId) {
      const project = await projects.getProject(targetId);
      if (!project) return Response.json({ error: 'Project not found.' }, { status: 404 });
      if (userAuth.projectId && userAuth.projectId !== project.id) return forbidden();
      if (userAuth.isAdmin && !userAuth.isSuperAdmin && !userAuth.projectId && project.ownerUserId !== userAuth.userId) {
        return forbidden();
      }
      targetStorage = projectSync(project);
    }
    const url = new URL(request.url);
    const tables = (url.searchParams.get('tables') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 500), 1), 2000);
    return guard(async () => {
      const result = await targetStorage.getDeltas(
        tables,
        Number(url.searchParams.get('since') || 0),
        limit,
        userAuth,
      );
      return Response.json({ success: true, ...result });
    });
  };

  const handleSyncPost = async (request: Request, slug?: string) => {
    const userAuth = await resolveAuth(request);
    if (!userAuth) return unauthorized();
    const targetId = slug ?? userAuth.projectId ?? null;
    let targetStorage = storage;
    if (targetId) {
      const project = await projects.getProject(targetId);
      if (!project) return Response.json({ error: 'Project not found.' }, { status: 404 });
      if (userAuth.projectId && userAuth.projectId !== project.id) return forbidden();
      if (userAuth.isAdmin && !userAuth.isSuperAdmin && !userAuth.projectId && project.ownerUserId !== userAuth.userId) {
        return forbidden();
      }
      targetStorage = projectSync(project);
    }
    const body = (await request.json().catch(() => null)) as { operations?: unknown } | null;
    if (!body || !Array.isArray(body.operations)) {
      return Response.json({ error: 'Operations must be an array.' }, { status: 400 });
    }
    return guard(async () => {
      const result = await targetStorage.applyOperations(
        body.operations as never[],
        undefined,
        userAuth,
      );
      return Response.json({ success: true, processed: result.applied, ...result });
    });
  };
  const rateLimited = async (request: Request): Promise<Response | null> => {
    const limit = await authLimiter(clientIp(request));
    if (limit.ok) return null;
    return Response.json(
      { error: 'Too many requests. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  };

  const events = createSyncEventsHandler({
    broker,
    authenticate: (req) => canSync(req, true),
  });

  const customRoutes =
    typeof customRoutesInput === 'function'
      ? customRoutesInput({ db: executor, settings, schema, broker, resolveAuth })
      : (customRoutesInput ?? {});

  const api = createServer({
    config: {},
    middleware: [
      async ({ request }, next) => {
        const cors = corsHeaders(request, settings);
        if (request.method === 'OPTIONS') {
          return new Response(null, { status: 204, headers: cors });
        }
        let res: Response;
        try {
          res = await next();
        } catch (err) {
          console.error('[local-lite-server]', err);
          return Response.json(
            { error: err instanceof Error ? err.message : 'Internal Server Error' },
            { status: 500, headers: cors },
          );
        }
        const out = new Response(res.body, res);
        for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
        return out;
      },
    ],
    onError: (error) => console.error('[local-lite-server]', error),
    endpoints: {
      ...customRoutes,
      '/health': {
        GET: async () => {
          try {
            await executor.query('SELECT 1');
            return Response.json({ ok: true, timestamp: new Date().toISOString() });
          } catch {
            return Response.json({ ok: false, timestamp: new Date().toISOString() }, { status: 503 });
          }
        },
      },
      '/auth/google-token': {
        POST: async ({ request }) => (await rateLimited(request)) ?? handleOAuthTokenExchange(request),
      },
      '/auth/github-token': {
        POST: async ({ request }) => (await rateLimited(request)) ?? handleOAuthTokenExchange(request),
      },
      '/auth/*': {
        POST: async ({ request }) => (await rateLimited(request)) ?? auth.handler(request),
      },
      '/sync/events': {
        GET: ({ request }) => events(request),
      },
      '/storage/*': {
        ALL: async ({ request }) => {
          const a = await resolveAuth(request, true);
          if (a?.projectId) {
            const p = await projects.getProject(a.projectId);
            if (!p) return Response.json({ error: 'Project not found.' }, { status: 404 });
            return projectStorageEndpoint(p, '/storage')(request);
          }
          return storageHandler(request);
        },
      },
      '/public/files/*': {
        GET: async ({ request }) => {
          const url = new URL(request.url);
          url.pathname = url.pathname.replace(/^\/public\/files/, '/storage/files');
          const req = new Request(url, request);
          const a = await resolveAuth(request, true);
          if (a?.projectId) {
            const p = await projects.getProject(a.projectId);
            if (!p) return Response.json({ error: 'Project not found.' }, { status: 404 });
            return projectStorageEndpoint(p, '/storage')(req);
          }
          return storageHandler(req);
        },
      },
      '/projects': {
        GET: async ({ request }) => {
          const caller = await resolveProjectCaller(request);
          if (!caller) return unauthorized();
          const list = await projects.listProjects(caller.isSuperAdmin ? undefined : caller.userId ?? '');
          return Response.json({ projects: list });
        },
        POST: async ({ request }) => {
          const caller = await resolveProjectCaller(request);
          if (!caller) return unauthorized();
          const body = (await request.json().catch(() => null)) as {
            name?: string;
            slug?: string;
            schema?: SchemaDictionary;
          } | null;
          try {
            const project = await projects.createProject({
              name: String(body?.name ?? ''),
              slug: body?.slug ? String(body.slug) : undefined,
              ownerUserId: caller.userId,
              schema: body?.schema && typeof body.schema === 'object' ? body.schema : undefined,
            });
            return Response.json({ project }, { status: 201 });
          } catch (err) {
            return Response.json({ error: (err as Error).message }, { status: 400 });
          }
        },
      },
      '/projects/:id/schema': {
        POST: async ({ request, params }) => {
          const caller = await resolveProjectCaller(request);
          if (!caller) return unauthorized();
          const project = await projects.getProject(params.id);
          if (!project) return Response.json({ error: 'Project not found.' }, { status: 404 });
          if (!canManageProject(caller, project)) return forbidden();
          const body = (await request.json().catch(() => null)) as { schema?: SchemaDictionary } | null;
          if (!body?.schema || typeof body.schema !== 'object' || Array.isArray(body.schema)) {
            return Response.json({ error: 'schema object is required.' }, { status: 400 });
          }
          try {
            const res = await projects.applyProjectSchema(project.id, body.schema);
            return Response.json(res);
          } catch (err) {
            return Response.json({ error: (err as Error).message }, { status: 400 });
          }
        },
      },
      '/projects/:id': {
        DELETE: async ({ request, params }) => {
          const caller = await resolveProjectCaller(request);
          if (!caller) return unauthorized();
          const project = await projects.getProject(params.id);
          if (!project) return Response.json({ error: 'Project not found.' }, { status: 404 });
          if (!canManageProject(caller, project)) return forbidden();
          await projects.deleteProject(project.id);
          return Response.json({ ok: true });
        },
      },
      '/p/:slug/sync': {
        GET: ({ request, params }) => handleSyncGet(request, params.slug),
        POST: ({ request, params }) => handleSyncPost(request, params.slug),
      },
      '/p/:slug/sync/events': {
        GET: async ({ request, params }) => {
          const p = await projects.getProject(params.slug);
          if (!p) return Response.json({ error: 'Project not found.' }, { status: 404 });
          return createSyncEventsHandler({
            broker,
            authenticate: async (req) => {
              const a = await resolveAuth(req, true);
              if (!a) return false;
              if (a.projectId && a.projectId !== p.id) return false;
              if (a.isAdmin && !a.isSuperAdmin && !a.projectId && p.ownerUserId !== a.userId) return false;
              return true;
            },
          })(request);
        },
      },
      '/p/:slug/storage/*': {
        ALL: async ({ request, params }) => {
          const p = await projects.getProject(params.slug);
          if (!p) return Response.json({ error: 'Project not found.' }, { status: 404 });
          return projectStorageEndpoint(p, `/p/${params.slug}/storage`)(request);
        },
      },
      '/p/:slug/public/files/*': {
        GET: async ({ request, params }) => {
          const p = await projects.getProject(params.slug);
          if (!p) return Response.json({ error: 'Project not found.' }, { status: 404 });
          const url = new URL(request.url);
          url.pathname = url.pathname.replace(
            new RegExp(`^/p/${params.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/public/files`),
            `/p/${params.slug}/storage/files`,
          );
          return projectStorageEndpoint(p, `/p/${params.slug}/storage`)(new Request(url, request));
        },
      },
      '/fn': {
        GET: async ({ request }) => {
          if (!(await canSync(request))) return unauthorized();
          return Response.json({ functions: fnRuntime.list() });
        },
      },
      '/fn/:module/:name': {
        POST: async ({ request, params }) => {
          const userAuth = await resolveAuth(request);
          if (!userAuth) return unauthorized();
          const raw = (await request.json().catch(() => ({}))) as Record<string, unknown> | null;
          const args =
            raw && typeof raw === 'object' && raw.args && typeof raw.args === 'object'
              ? (raw.args as Record<string, unknown>)
              : raw && typeof raw === 'object'
                ? raw
                : {};
          return guard(async () => {
            const { result } = await fnRuntime.run(
              `${params.module}/${params.name}`,
              args,
              userAuth,
            );
            return Response.json({ success: true, result });
          });
        },
      },
      '/subscribe/:module/:name': {
        GET: async ({ request, params }) => {
          const userAuth = await resolveAuth(request, true);
          if (!userAuth) return unauthorized();
          const rawArgs = new URL(request.url).searchParams.get('args');
          let args: Record<string, unknown> = {};
          if (rawArgs) {
            try {
              const parsed = JSON.parse(rawArgs);
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                args = parsed as Record<string, unknown>;
              }
            } catch {
              return Response.json({ error: 'Invalid args JSON.' }, { status: 400 });
            }
          }
          return guard(() =>
            fnRuntime.subscribe(`${params.module}/${params.name}`, args, userAuth),
          );
        },
      },
      '/sync': {
        GET: ({ request }) => handleSyncGet(request),
        POST: ({ request }) => handleSyncPost(request),
      },
      ...(settings.adminUi
        ? {
            '/admin': { GET: ({ request }: { request: Request }) => consoleApi.serveStatic(new URL(request.url).pathname) },
            '/admin/login': {
              GET: ({ request }: { request: Request }) => consoleApi.getLogin(request),
              POST: async ({ request }: { request: Request }) =>
                (await rateLimited(request)) ?? consoleApi.postLogin(request),
            },
            '/admin/logout': {
              POST: async ({ request }: { request: Request }) =>
                consoleApi.postLogout(request, await consoleApi.authenticate(request)),
            },
            '/admin/overview': {
              GET: withAdmin(async (req, s) => {
                const { project, error } = await resolveAdminProject(req, s, true);
                if (error) return error;
                return consoleApi.overview(s, project);
              }),
            },
            '/admin/table': {
              ALL: withAdminProject((req, _s, project) => consoleApi.handleTable(req, project)),
            },
            '/admin/endpoints': { GET: withAdmin(() => consoleApi.listEndpoints()) },
            '/admin/users': {
              GET: withSuperAdmin(() => consoleApi.listUsers()),
              POST: withSuperAdmin((req) => consoleApi.manageUsers(req)),
            },
            '/admin/logs': {
              GET: withAdminProject((req, _s, project) => consoleApi.handleLogs(new URL(req.url), project)),
            },
            '/admin/env': { ALL: withSuperAdmin((req) => consoleApi.handleEnv(req)) },
            '/admin/backups': { ALL: withSuperAdmin((req) => consoleApi.handleBackups(req)) },
            '/admin/storage': {
              ALL: withAdminProject((req, _s, project) => consoleApi.handleStorage(req, project)),
            },
            '/admin/crons': { ALL: withSuperAdmin((req) => consoleApi.handleCrons(req)) },
            '/admin/settings': { ALL: withSuperAdmin((req) => consoleApi.handleSettings(req)) },
            '/admin/api-keys': {
              GET: withAdminProject(async (_req, _s, project) =>
                Response.json({ keys: await apiKeys.listKeys(project?.id ?? null) }),
              ),
              POST: withAdminProject(async (request, s, project) => {
                const body = (await request.json().catch(() => null)) as {
                  name?: string;
                  role?: 'admin' | 'user';
                  userId?: string;
                  expiresInDays?: number | null;
                } | null;
                const days = Number(body?.expiresInDays ?? 0);
                const expiresAt = Number.isFinite(days) && days > 0 ? Date.now() + days * 86_400_000 : null;
                try {
                  const created = await apiKeys.createKey({
                    name: String(body?.name ?? ''),
                    role: body?.role === 'user' ? 'user' : 'admin',
                    userId: body?.userId ?? null,
                    projectId: project?.id ?? null,
                    createdBy: s.userId,
                    expiresAt,
                  });
                  return Response.json(created, { status: 201 });
                } catch (err) {
                  return Response.json({ error: (err as Error).message }, { status: 400 });
                }
              }),
              PATCH: withAdminProject(async (request, _s, project) => {
                const body = (await request.json().catch(() => null)) as { id?: string; action?: string } | null;
                if (!body?.id || body.action !== 'revoke') {
                  return Response.json({ error: 'Provide id and action: "revoke".' }, { status: 400 });
                }
                const ok = await apiKeys.revokeKey(String(body.id), project?.id ?? null);
                return ok ? Response.json({ ok: true }) : Response.json({ error: 'Key not found or already revoked.' }, { status: 404 });
              }),
              DELETE: withAdminProject(async (request, _s, project) => {
                const id = new URL(request.url).searchParams.get('id') ?? '';
                if (!id) return Response.json({ error: 'Missing id.' }, { status: 400 });
                const ok = await apiKeys.deleteKey(id, project?.id ?? null);
                return ok ? Response.json({ ok: true }) : Response.json({ error: 'Key not found.' }, { status: 404 });
              }),
            },
            '/admin/*': {
              GET: ({ request }: { request: Request }) => consoleApi.serveStatic(new URL(request.url).pathname),
            },
          }
        : {}),
    },
  });

  return { fetch: (req: Request) => api.fetch(req), broker, fnRuntime };
}
