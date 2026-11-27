import type { ApiKeyService } from '../../auth/apiKeys.js';
import type { AdminSession } from '../../admin/session.js';
import type { AuthContext } from '../authContext.js';

export function adminRoutes(deps: {
  consoleApi: any;
  apiKeys: ApiKeyService;
  authCtx: AuthContext;
}) {
  const { consoleApi, apiKeys, authCtx } = deps;

  return {
    '/admin': {
      GET: ({ request }: { request: Request }) => consoleApi.serveStatic(new URL(request.url).pathname),
    },
    '/admin/login': {
      GET: ({ request }: { request: Request }) => consoleApi.getLogin(request),
      POST: async ({ request }: { request: Request }) =>
        (await authCtx.rateLimited(request)) ?? consoleApi.postLogin(request),
    },
    '/admin/logout': {
      POST: async ({ request }: { request: Request }) =>
        consoleApi.postLogout(request, await consoleApi.authenticate(request)),
    },
    '/admin/overview': {
      GET: authCtx.withAdmin(async (req, s) => {
        const { project, error } = await authCtx.resolveAdminProject(req, s, true);
        if (error) return error;
        return consoleApi.overview(s as AdminSession, project);
      }),
    },
    '/admin/table': {
      ALL: authCtx.withAdminProject((req, _s, project) => consoleApi.handleTable(req, project)),
    },
    '/admin/endpoints': {
      GET: authCtx.withAdmin(() => consoleApi.listEndpoints()),
    },
    '/admin/users': {
      GET: authCtx.withAdminProject((_req, _s, project) => consoleApi.listUsers(project)),
      POST: authCtx.withAdminProject((req, s, project) =>
        consoleApi.manageUsers(req, s as AdminSession, project),
      ),
    },
    '/admin/logs': {
      GET: authCtx.withAdminProject((req, _s, project) => consoleApi.handleLogs(new URL(req.url), project)),
    },
    '/admin/env': {
      ALL: authCtx.withAdminProject((req, _s, project) => consoleApi.handleEnv(req, project)),
    },
    '/admin/backups': { ALL: authCtx.withSuperAdmin((req) => consoleApi.handleBackups(req)) },
    '/admin/storage': {
      ALL: authCtx.withAdminProject((req, _s, project) => consoleApi.handleStorage(req, project)),
    },
    '/admin/crons': { ALL: authCtx.withSuperAdmin((req) => consoleApi.handleCrons(req)) },
    '/admin/settings': { ALL: authCtx.withSuperAdmin((req) => consoleApi.handleSettings(req)) },
    '/admin/api-keys': {
      GET: authCtx.withAdminProject(async (_req, _s, project) =>
        Response.json({ keys: await apiKeys.listKeys(project?.id ?? null) }),
      ),
      POST: authCtx.withAdminProject(async (request, s, project) => {
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
      PATCH: authCtx.withAdminProject(async (request, _s, project) => {
        const body = (await request.json().catch(() => null)) as { id?: string; action?: string } | null;
        if (!body?.id || body.action !== 'revoke') {
          return Response.json({ error: 'Provide id and action: "revoke".' }, { status: 400 });
        }
        const ok = await apiKeys.revokeKey(String(body.id), project?.id ?? null);
        return ok
          ? Response.json({ ok: true })
          : Response.json({ error: 'Key not found or already revoked.' }, { status: 404 });
      }),
      DELETE: authCtx.withAdminProject(async (request, _s, project) => {
        const id = new URL(request.url).searchParams.get('id') ?? '';
        if (!id) return Response.json({ error: 'Missing id.' }, { status: 400 });
        const ok = await apiKeys.deleteKey(id, project?.id ?? null);
        return ok
          ? Response.json({ ok: true })
          : Response.json({ error: 'Key not found.' }, { status: 404 });
      }),
    },
    '/admin/*': {
      GET: ({ request }: { request: Request }) => consoleApi.serveStatic(new URL(request.url).pathname),
    },
  };
}
