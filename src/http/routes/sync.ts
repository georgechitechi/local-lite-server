import { createSyncEventsHandler, type SyncEventBroker } from 'local-lite/server';
import type { FunctionRuntime } from '../../functions/index.js';
import type { ProjectRecord, ProjectService } from '../../projects.js';
import type { TableSyncStorage } from '../../tableStorage.js';
import type { AuthContext, ResolvedAuth } from '../authContext.js';
import type { ProjectRuntimeCache } from '../projectRuntime.js';

function assertProjectAccess(userAuth: ResolvedAuth, project: ProjectRecord, authCtx: AuthContext): Response | null {
  if (userAuth.projectId && userAuth.projectId !== project.id) return authCtx.forbidden();
  if (
    userAuth.isAdmin &&
    !userAuth.isSuperAdmin &&
    !userAuth.projectId &&
    project.ownerUserId !== userAuth.userId
  ) {
    return authCtx.forbidden();
  }
  return null;
}

function parseFnArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (obj.args && typeof obj.args === 'object' && !Array.isArray(obj.args)) {
      return obj.args as Record<string, unknown>;
    }
    return obj;
  }
  return {};
}

export function syncAndProjectRoutes(deps: {
  authCtx: AuthContext;
  projects: ProjectService;
  runtimeCache: ProjectRuntimeCache;
  rootStorage: TableSyncStorage;
  rootBroker: SyncEventBroker;
  rootFnRuntime: FunctionRuntime;
  rootStorageHandler: (req: Request) => Promise<Response>;
}) {
  const { authCtx, projects, runtimeCache, rootStorage, rootBroker, rootFnRuntime, rootStorageHandler } = deps;

  const resolveScope = async (
    request: Request,
    slug?: string,
    allowQuery = false,
  ): Promise<
    | { error: Response }
    | {
        error?: undefined;
        userAuth: ResolvedAuth;
        project: ProjectRecord | null;
        storage: TableSyncStorage;
        fnRuntime: FunctionRuntime;
        broker: SyncEventBroker;
      }
  > => {
    const slugProject = slug ? await projects.getProject(slug) : null;
    if (slug && !slugProject) {
      return { error: Response.json({ error: 'Project not found.' }, { status: 404 }) };
    }
    const userAuth = await authCtx.resolveAuth(request, allowQuery, slugProject);
    if (!userAuth) return { error: authCtx.unauthorized() };

    const project = slugProject ?? (userAuth.projectId ? await projects.getProject(userAuth.projectId) : null);
    if (userAuth.projectId && !project) {
      return { error: Response.json({ error: 'Project not found.' }, { status: 404 }) };
    }
    if (project) {
      const denied = assertProjectAccess(userAuth, project, authCtx);
      if (denied) return { error: denied };
      const rt = runtimeCache.get(project);
      return { userAuth, project, storage: rt.syncStorage, fnRuntime: rt.fnRuntime, broker: rt.broker };
    }
    return { userAuth, project: null, storage: rootStorage, fnRuntime: rootFnRuntime, broker: rootBroker };
  };

  const handleSyncGet = async (request: Request, slug?: string) => {
    const scoped = await resolveScope(request, slug);
    if (scoped.error) return scoped.error;
    const url = new URL(request.url);
    const tables = (url.searchParams.get('tables') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 500), 1), 2000);
    return authCtx.guard(async () => {
      const result = await scoped.storage.getDeltas(
        tables,
        Number(url.searchParams.get('since') || 0),
        limit,
        scoped.userAuth,
      );
      return Response.json({ success: true, ...result });
    });
  };

  const handleSyncPost = async (request: Request, slug?: string) => {
    const scoped = await resolveScope(request, slug);
    if (scoped.error) return scoped.error;
    const body = (await request.json().catch(() => null)) as { operations?: unknown } | null;
    if (!body || !Array.isArray(body.operations)) {
      return Response.json({ error: 'Operations must be an array.' }, { status: 400 });
    }
    return authCtx.guard(async () => {
      const result = await scoped.storage.applyOperations(
        body.operations as never[],
        undefined,
        scoped.userAuth,
      );
      return Response.json({ success: true, processed: result.applied, ...result });
    });
  };

  const handleSyncEvents = async (request: Request, slug?: string) => {
    const scoped = await resolveScope(request, slug, true);
    if (scoped.error) return scoped.error;
    return createSyncEventsHandler({
      broker: scoped.broker,
      authenticate: async () => true,
    })(request);
  };

  const handleFnRun = async (request: Request, params: Record<string, string>, slug?: string) => {
    const scoped = await resolveScope(request, slug);
    if (scoped.error) return scoped.error;
    const raw = await request.json().catch(() => ({}));
    return authCtx.guard(async () => {
      const { result } = await scoped.fnRuntime.run(
        `${params.module}/${params.name}`,
        parseFnArgs(raw),
        scoped.userAuth,
      );
      return Response.json({ success: true, result });
    });
  };

  const handleFnSubscribe = async (request: Request, params: Record<string, string>, slug?: string) => {
    const scoped = await resolveScope(request, slug, true);
    if (scoped.error) return scoped.error;
    const rawArgs = new URL(request.url).searchParams.get('args');
    let args: Record<string, unknown> = {};
    if (rawArgs) {
      try {
        args = parseFnArgs(JSON.parse(rawArgs));
      } catch {
        return Response.json({ error: 'Invalid args JSON.' }, { status: 400 });
      }
    }
    return authCtx.guard(() =>
      scoped.fnRuntime.subscribe(`${params.module}/${params.name}`, args, scoped.userAuth),
    );
  };

  const handleRootStorage = async (request: Request, rewritePublic = false) => {
    const url = new URL(request.url);
    if (rewritePublic) url.pathname = url.pathname.replace(/^\/public\/files/, '/storage/files');
    const a = await authCtx.resolveAuth(request, true);
    if (a?.projectId) {
      const p = await projects.getProject(a.projectId);
      if (!p) return Response.json({ error: 'Project not found.' }, { status: 404 });
      url.pathname = `/p/${p.slug}${url.pathname}`;
      return runtimeCache.get(p).storageHandler(new Request(url, request));
    }
    return rootStorageHandler(rewritePublic ? new Request(url, request) : request);
  };

  return {
    '/sync': {
      GET: ({ request }: { request: Request }) => handleSyncGet(request),
      POST: ({ request }: { request: Request }) => handleSyncPost(request),
    },
    '/sync/events': {
      GET: ({ request }: { request: Request }) => handleSyncEvents(request),
    },
    '/storage/*': {
      ALL: ({ request }: { request: Request }) => handleRootStorage(request),
    },
    '/public/files/*': {
      GET: ({ request }: { request: Request }) => handleRootStorage(request, true),
    },
    '/fn': {
      GET: async ({ request }: { request: Request }) => {
        if (!(await authCtx.resolveAuth(request))) return authCtx.unauthorized();
        return Response.json({ functions: rootFnRuntime.list() });
      },
    },
    '/fn/:module/:name': {
      POST: ({ request, params }: { request: Request; params: Record<string, string> }) =>
        handleFnRun(request, params),
    },
    '/subscribe/:module/:name': {
      GET: ({ request, params }: { request: Request; params: Record<string, string> }) =>
        handleFnSubscribe(request, params),
    },
    '/p/:slug/sync': {
      GET: ({ request, params }: { request: Request; params: Record<string, string> }) =>
        handleSyncGet(request, params.slug),
      POST: ({ request, params }: { request: Request; params: Record<string, string> }) =>
        handleSyncPost(request, params.slug),
    },
    '/p/:slug/sync/events': {
      GET: ({ request, params }: { request: Request; params: Record<string, string> }) =>
        handleSyncEvents(request, params.slug),
    },
    '/p/:slug/auth/*': {
      POST: async ({ request, params }: { request: Request; params: Record<string, string> }) => {
        const limited = await authCtx.rateLimited(request);
        if (limited) return limited;
        const p = await projects.getProject(params.slug);
        if (!p) return Response.json({ error: 'Project not found.' }, { status: 404 });
        const url = new URL(request.url);
        url.pathname = url.pathname.slice(`/p/${params.slug}`.length) || '/';
        return runtimeCache.get(p).auth.handler(new Request(url, request));
      },
    },
    '/p/:slug/storage/*': {
      ALL: async ({ request, params }: { request: Request; params: Record<string, string> }) => {
        const p = await projects.getProject(params.slug);
        if (!p) return Response.json({ error: 'Project not found.' }, { status: 404 });
        return runtimeCache.get(p).storageHandler(request);
      },
    },
    '/p/:slug/public/files/*': {
      GET: async ({ request, params }: { request: Request; params: Record<string, string> }) => {
        const p = await projects.getProject(params.slug);
        if (!p) return Response.json({ error: 'Project not found.' }, { status: 404 });
        const url = new URL(request.url);
        url.pathname = url.pathname.replace(
          new RegExp(`^/p/${params.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/public/files`),
          `/p/${params.slug}/storage/files`,
        );
        return runtimeCache.get(p).storageHandler(new Request(url, request));
      },
    },
    '/p/:slug/fn/:module/:name': {
      POST: ({ request, params }: { request: Request; params: Record<string, string> }) =>
        handleFnRun(request, params, params.slug),
    },
    '/p/:slug/subscribe/:module/:name': {
      GET: ({ request, params }: { request: Request; params: Record<string, string> }) =>
        handleFnSubscribe(request, params, params.slug),
    },
  };
}
