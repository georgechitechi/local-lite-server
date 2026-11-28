import {
  createServer,
  createSyncEventBroker,
  type SqlExecutor,
  type SyncEventBroker,
} from 'local-lite/server';
import { createApiKeyService } from './auth/apiKeys.js';
import { createAuthService } from './auth/auth.js';
import { handleOAuthTokenExchange } from './auth/oauth.js';
import { createDistributedRateLimiter } from './auth/rateLimit.js';
import {
  createCommandRuntime,
  type CommandRegistry,
} from './commands/index.js';
import type { ServerSettings } from './config.js';
import { corsHeaders, createHttpServer } from './core/http.js';
import type { LensRegistry } from './db/lenses.js';
import type { ProjectionRegistry } from './db/projections.js';
import type { RulesDictionary } from './db/rules.js';
import type { SchemaDictionary } from './db/schema.js';
import { TableSyncStorage } from './db/tableStorage.js';
import { createAuthContext } from './http/authContext.js';
import { syncRoutes } from './http/routes/sync.js';
import { createWsUpgradeHandler, PresenceHub } from './http/ws.js';
import type {
  CustomRoutesFactory,
  CustomRoutesMap,
} from './services/routes.js';

export { createHttpServer };

export function createApp(
  settings: ServerSettings,
  executor: SqlExecutor,
  schema: SchemaDictionary,
  commands: CommandRegistry = new Map(),
  rules: RulesDictionary = {},
  brokerOverride?: SyncEventBroker,
  customRoutesInput?: CustomRoutesMap | CustomRoutesFactory,
  lenses: LensRegistry = new Map(),
  projections: ProjectionRegistry = new Map(),
) {
  const broker = brokerOverride ?? createSyncEventBroker();
  const storage = new TableSyncStorage(executor, { schema, rules, broker });
  const auth = createAuthService(settings, executor, null);
  const apiKeys = createApiKeyService(executor);
  const cmdRuntime = createCommandRuntime({
    registry: commands,
    db: executor,
    schema,
    broker,
    projections,
  });
  const authLimiter = createDistributedRateLimiter(
    executor,
    20,
    60_000,
    settings.multiInstance,
  );
  const authCtx = createAuthContext({ settings, apiKeys, auth, authLimiter });

  const customRoutes =
    typeof customRoutesInput === 'function'
      ? customRoutesInput({
          db: executor,
          settings,
          schema,
          broker,
          resolveAuth: (req, allowQuery) =>
            authCtx.resolveAuth(req, allowQuery),
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
            {
              error:
                err instanceof Error ? err.message : 'Internal Server Error',
            },
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
            return Response.json({
              ok: true,
              timestamp: new Date().toISOString(),
            });
          } catch {
            return Response.json(
              { ok: false, timestamp: new Date().toISOString() },
              { status: 503 },
            );
          }
        },
      },
      '/auth/google-token': {
        POST: async ({ request }) =>
          (await authCtx.rateLimited(request)) ??
          handleOAuthTokenExchange(request),
      },
      '/auth/github-token': {
        POST: async ({ request }) =>
          (await authCtx.rateLimited(request)) ??
          handleOAuthTokenExchange(request),
      },
      '/auth/*': {
        POST: async ({ request }) =>
          (await authCtx.rateLimited(request)) ?? auth.handler(request),
      },
      ...syncRoutes({
        authCtx,
        db: executor,
        schema,
        rules,
        lenses,
        storage,
        broker,
        cmdRuntime,
      }),
    },
  });

  const presence = new PresenceHub();
  const handleUpgrade = createWsUpgradeHandler({
    authCtx,
    db: executor,
    schema,
    rules,
    lenses,
    broker,
    cmdRuntime,
    presence,
  });

  return {
    fetch: (req: Request) => api.fetch(req),
    handleUpgrade,
    presence,
    broker,
    cmdRuntime,
  };
}
