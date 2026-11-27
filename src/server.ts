import {
  createServer,
  createSyncEventBroker,
  type SqlExecutor,
  type SyncEventBroker,
} from 'local-lite/server';
import { createAdminConsole } from './admin/index.js';
import { createApiKeyService } from './apiKeys.js';
import { createAuthService } from './auth.js';
import type { ServerSettings } from './config.js';
import { scopeBroker } from './core/broker.js';
import { corsHeaders, createHttpServer } from './core/http.js';
import { createFunctionRuntime, type FunctionRegistry } from './functions/index.js';
import { createAuthContext } from './http/authContext.js';
import { createProjectRuntimeCache } from './http/projectRuntime.js';
import { adminRoutes } from './http/routes/admin.js';
import { projectRoutes } from './http/routes/projects.js';
import { syncAndProjectRoutes } from './http/routes/sync.js';
import { handleOAuthTokenExchange } from './oauth.js';
import { createProjectService } from './projects.js';
import { createDistributedRateLimiter } from './rateLimit.js';
import type { CustomRoutesFactory, CustomRoutesMap } from './routes.js';
import type { RulesDictionary } from './rules.js';
import type { SchemaDictionary } from './schema.js';
import { createStorageHandler } from './storage.js';
import { TableSyncStorage } from './tableStorage.js';

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
  const rootBroker = brokerOverride ?? createSyncEventBroker();
  const scopedRootBroker = scopeBroker(rootBroker, null);
  const rootStorage = new TableSyncStorage(executor, { schema, rules, broker: scopedRootBroker });
  const rootAuth = createAuthService(settings, executor, null);
  const apiKeys = createApiKeyService(executor);
  const projects = createProjectService(executor, {
    maxProjectsPerUser: settings.maxProjectsPerUser,
    uploadDir: settings.uploadDir,
  });
  const fnRuntime = createFunctionRuntime({ registry: functions, db: executor, schema, broker: scopedRootBroker });
  const consoleApi = createAdminConsole({ settings, db: executor, schema, broker: scopedRootBroker, fnRuntime });
  const authLimiter = createDistributedRateLimiter(executor, 20, 60_000, settings.multiInstance);

  let runtimeCache: ReturnType<typeof createProjectRuntimeCache>;

  const authCtx = createAuthContext({
    settings,
    apiKeys,
    rootAuth,
    projects,
    authenticateAdmin: (req) => consoleApi.authenticate(req),
    authLimiter,
    getProjectAuth: (p) => runtimeCache.get(p).auth,
  });

  runtimeCache = createProjectRuntimeCache({
    settings,
    db: executor,
    rootBroker,
    rootRules: rules,
    functions,
    resolveAuth: (req, allowQuery, projectScope) => authCtx.resolveAuth(req, allowQuery, projectScope),
  });

  const rootStorageHandler = createStorageHandler(settings, executor, async (req) => {
    const a = await authCtx.resolveAuth(req, true);
    return a ? { userId: a.userId ?? 'admin', isAdmin: a.isAdmin } : null;
  });

  const customRoutes =
    typeof customRoutesInput === 'function'
      ? customRoutesInput({
          db: executor,
          settings,
          schema,
          broker: scopedRootBroker,
          resolveAuth: (req, allowQuery) => authCtx.resolveAuth(req, allowQuery),
        })
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
        POST: async ({ request }) => (await authCtx.rateLimited(request)) ?? handleOAuthTokenExchange(request),
      },
      '/auth/github-token': {
        POST: async ({ request }) => (await authCtx.rateLimited(request)) ?? handleOAuthTokenExchange(request),
      },
      '/auth/*': {
        POST: async ({ request }) => (await authCtx.rateLimited(request)) ?? rootAuth.handler(request),
      },
      ...projectRoutes({ projects, authCtx, runtimeCache }),
      ...syncAndProjectRoutes({
        authCtx,
        projects,
        runtimeCache,
        rootStorage,
        rootBroker: scopedRootBroker,
        rootFnRuntime: fnRuntime,
        rootStorageHandler,
      }),
      ...(settings.adminUi ? adminRoutes({ consoleApi, apiKeys, authCtx }) : {}),
    },
  });

  return { fetch: (req: Request) => api.fetch(req), broker: scopedRootBroker, fnRuntime };
}
