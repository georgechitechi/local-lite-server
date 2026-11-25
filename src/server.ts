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
  const fnRuntime = createFunctionRuntime({ registry: functions, db: executor, schema, broker });
  const consoleApi = createAdminConsole({ settings, db: executor, schema, broker, fnRuntime });
  const storageHandler = createStorageHandler(settings, executor, async (req) => {
    const a = await resolveAuth(req, true);
    return a ? { userId: a.userId ?? 'admin', isAdmin: a.isAdmin } : null;
  });
  const authLimiter = createDistributedRateLimiter(executor, 20, 60_000, settings.multiInstance);

  const bearer = (request: Request): string => {
    const header = request.headers.get('authorization') ?? '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  };
  const apiKeyHeader = (request: Request): string =>
    request.headers.get('x-api-key')?.trim() ?? '';
  /** Admin key, API key, console cookie session, or a valid user token. */
  const resolveAuth = async (request: Request, allowQuery = false): Promise<FunctionAuth | null> => {
    const token =
      bearer(request) ||
      apiKeyHeader(request) ||
      (allowQuery ? (new URL(request.url).searchParams.get('token') ?? '') : '');
    if (token) {
      if (safeEqual(token, settings.apiKey)) return { isAdmin: true };
      const keyAuth = await apiKeys.verifyKey(token);
      if (keyAuth) return { isAdmin: keyAuth.isAdmin, userId: keyAuth.userId };
      const user = await auth.verifyUser(token);
      if (user) return { isAdmin: false, userId: user.id };
      const oauthUser = await verifyOAuthToken(token);
      if (oauthUser) return { isAdmin: false, userId: oauthUser.id };
    }
    if (settings.adminUi) {
      const adminSession = await consoleApi.authenticate(request);
      if (adminSession) return { isAdmin: true, userId: adminSession.userId };
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
        const res = await next();
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
        POST: async ({ request }) => {
          const limit = await authLimiter(clientIp(request));
          if (!limit.ok) {
            return Response.json(
              { error: 'Too many requests. Please try again shortly.' },
              { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
            );
          }
          return handleOAuthTokenExchange(request);
        },
      },
      '/auth/github-token': {
        POST: async ({ request }) => {
          const limit = await authLimiter(clientIp(request));
          if (!limit.ok) {
            return Response.json(
              { error: 'Too many requests. Please try again shortly.' },
              { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
            );
          }
          return handleOAuthTokenExchange(request);
        },
      },
      '/auth/*': {
        POST: async ({ request }) => {
          const limit = await authLimiter(clientIp(request));
          if (!limit.ok) {
            return Response.json(
              { error: 'Too many requests. Please try again shortly.' },
              { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
            );
          }
          return auth.handler(request);
        },
      },
      '/sync/events': {
        GET: ({ request }) => events(request),
      },
      '/storage/*': {
        ALL: ({ request }) => storageHandler(request),
      },
      '/public/files/*': {
        GET: ({ request }) => {
          const url = new URL(request.url);
          url.pathname = url.pathname.replace(/^\/public\/files/, '/storage/files');
          return storageHandler(new Request(url, request));
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
        GET: async ({ request }) => {
          const userAuth = await resolveAuth(request);
          if (!userAuth) return unauthorized();
          const url = new URL(request.url);
          const tables = (url.searchParams.get('tables') ?? '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
          const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 500), 1), 2000);
          return guard(async () => {
            const result = await storage.getDeltas(
              tables,
              Number(url.searchParams.get('since') || 0),
              limit,
              userAuth,
            );
            return Response.json({ success: true, ...result });
          });
        },
        POST: async ({ request }) => {
          const userAuth = await resolveAuth(request);
          if (!userAuth) return unauthorized();
          const body = (await request.json().catch(() => null)) as {
            operations?: unknown;
          } | null;
          if (!body || !Array.isArray(body.operations)) {
            return Response.json({ error: 'Operations must be an array.' }, { status: 400 });
          }
          return guard(async () => {
            const result = await storage.applyOperations(
              body.operations as never[],
              undefined,
              userAuth,
            );
            return Response.json({ success: true, processed: result.applied, ...result });
          });
        },
      },
      ...(settings.adminUi
        ? {
            '/admin': { GET: ({ request }: { request: Request }) => consoleApi.serveStatic(new URL(request.url).pathname) },
            '/admin/login': {
              GET: ({ request }: { request: Request }) => consoleApi.getLogin(request),
              POST: async ({ request }: { request: Request }) => {
                const limit = await authLimiter(clientIp(request));
                if (!limit.ok) {
                  return Response.json(
                    { error: 'Too many requests. Please try again shortly.' },
                    { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
                  );
                }
                return consoleApi.postLogin(request);
              },
            },
            '/admin/logout': {
              POST: async ({ request }: { request: Request }) =>
                consoleApi.postLogout(request, await consoleApi.authenticate(request)),
            },
            '/admin/overview': {
              GET: async ({ request }: { request: Request }) => {
                const s = await consoleApi.authenticate(request);
                return s ? consoleApi.overview(s) : unauthorized();
              },
            },
            '/admin/table': {
              ALL: async ({ request }: { request: Request }) =>
                (await consoleApi.authenticate(request)) ? consoleApi.handleTable(request) : unauthorized(),
            },
            '/admin/endpoints': {
              GET: async ({ request }: { request: Request }) =>
                (await consoleApi.authenticate(request)) ? consoleApi.listEndpoints() : unauthorized(),
            },
            '/admin/users': {
              GET: async ({ request }: { request: Request }) =>
                (await consoleApi.authenticate(request)) ? consoleApi.listUsers() : unauthorized(),
              POST: async ({ request }: { request: Request }) =>
                (await consoleApi.authenticate(request)) ? consoleApi.manageUsers(request) : unauthorized(),
            },
            '/admin/logs': {
              GET: async ({ request }: { request: Request }) =>
                (await consoleApi.authenticate(request))
                  ? consoleApi.handleLogs(new URL(request.url))
                  : unauthorized(),
            },
            '/admin/env': {
              ALL: async ({ request }: { request: Request }) =>
                (await consoleApi.authenticate(request)) ? consoleApi.handleEnv(request) : unauthorized(),
            },
            '/admin/backups': {
              ALL: async ({ request }: { request: Request }) =>
                (await consoleApi.authenticate(request)) ? consoleApi.handleBackups(request) : unauthorized(),
            },
            '/admin/storage': {
              ALL: async ({ request }: { request: Request }) =>
                (await consoleApi.authenticate(request)) ? consoleApi.handleStorage(request) : unauthorized(),
            },
            '/admin/crons': {
              ALL: async ({ request }: { request: Request }) =>
                (await consoleApi.authenticate(request)) ? consoleApi.handleCrons(request) : unauthorized(),
            },
            '/admin/settings': {
              ALL: async ({ request }: { request: Request }) =>
                (await consoleApi.authenticate(request)) ? consoleApi.handleSettings(request) : unauthorized(),
            },
            '/admin/api-keys': {
              GET: async ({ request }: { request: Request }) => {
                const s = await consoleApi.authenticate(request);
                if (!s) return unauthorized();
                return Response.json({ keys: await apiKeys.listKeys() });
              },
              POST: async ({ request }: { request: Request }) => {
                const s = await consoleApi.authenticate(request);
                if (!s) return unauthorized();
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
                    createdBy: s.userId,
                    expiresAt,
                  });
                  return Response.json(created, { status: 201 });
                } catch (err) {
                  return Response.json({ error: (err as Error).message }, { status: 400 });
                }
              },
              PATCH: async ({ request }: { request: Request }) => {
                const s = await consoleApi.authenticate(request);
                if (!s) return unauthorized();
                const body = (await request.json().catch(() => null)) as { id?: string; action?: string } | null;
                if (!body?.id || body.action !== 'revoke') {
                  return Response.json({ error: 'Provide id and action: "revoke".' }, { status: 400 });
                }
                const ok = await apiKeys.revokeKey(String(body.id));
                return ok ? Response.json({ ok: true }) : Response.json({ error: 'Key not found or already revoked.' }, { status: 404 });
              },
              DELETE: async ({ request }: { request: Request }) => {
                const s = await consoleApi.authenticate(request);
                if (!s) return unauthorized();
                const id = new URL(request.url).searchParams.get('id') ?? '';
                if (!id) return Response.json({ error: 'Missing id.' }, { status: 400 });
                const ok = await apiKeys.deleteKey(id);
                return ok ? Response.json({ ok: true }) : Response.json({ error: 'Key not found.' }, { status: 404 });
              },
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
