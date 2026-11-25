import crypto from 'node:crypto';
import http from 'node:http';
import {
  createServer,
  createSyncEventBroker,
  createSyncEventsHandler,
  type SqlExecutor,
} from 'local-lite/server';
import type { ServerSettings } from './config.js';
import type { SchemaDictionary } from './schema.js';
import { ClientError, TableSyncStorage } from './tableStorage.js';
import { createAuthService } from './auth.js';
import { createAdmin } from './admin.js';
import { clientIp, createRateLimiter } from './rateLimit.js';
import {
  createFunctionRuntime,
  FunctionError,
  type FunctionAuth,
  type FunctionRegistry,
} from './functions.js';

const MAX_BODY_BYTES = 6_000_000;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function createApp(
  settings: ServerSettings,
  executor: SqlExecutor,
  schema: SchemaDictionary,
  functions: FunctionRegistry = new Map(),
) {
  const broker = createSyncEventBroker();
  const storage = new TableSyncStorage(executor, { schema, broker });
  const auth = createAuthService(settings, executor);
  const admin = createAdmin(settings, executor, schema, auth);
  const fnRuntime = createFunctionRuntime({ registry: functions, db: executor, schema, broker });
  const authLimiter = createRateLimiter(20, 60_000);

  const bearer = (request: Request): string => {
    const header = request.headers.get('authorization') ?? '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  };
  /** Server admin key (full access). */
  const isAdmin = (request: Request): boolean => {
    const token = bearer(request);
    return token.length > 0 && safeEqual(token, settings.apiKey);
  };
  /** Admin key or a valid user token. */
  const resolveAuth = async (request: Request, allowQuery = false): Promise<FunctionAuth | null> => {
    if (isAdmin(request)) return { isAdmin: true };
    const token =
      bearer(request) || (allowQuery ? (new URL(request.url).searchParams.get('token') ?? '') : '');
    if (!token) return null;
    if (safeEqual(token, settings.apiKey)) return { isAdmin: true };
    const user = await auth.verifyUser(token);
    return user ? { isAdmin: false, userId: user.id } : null;
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
      '/health': {
        GET: async () => {
          try {
            await executor.query('SELECT 1');
            return Response.json({ ok: true, dialect: settings.dialect });
          } catch {
            return Response.json({ ok: false }, { status: 503 });
          }
        },
      },
      '/auth/*': {
        POST: async ({ request }) => {
          const limit = authLimiter(clientIp(request));
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
          if (!(await canSync(request))) return unauthorized();
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
            );
            return Response.json({ success: true, ...result });
          });
        },
        POST: async ({ request }) => {
          if (!(await canSync(request))) return unauthorized();
          const body = (await request.json().catch(() => null)) as {
            operations?: unknown;
          } | null;
          if (!body || !Array.isArray(body.operations)) {
            return Response.json({ error: 'Operations must be an array.' }, { status: 400 });
          }
          return guard(async () => {
            const result = await storage.applyOperations(body.operations as never[]);
            return Response.json({ success: true, processed: result.applied, ...result });
          });
        },
      },
      ...(settings.adminUi
        ? {
            '/admin': { GET: () => admin.page() },
            '/admin/status': {
              GET: async ({ request }: { request: Request }) =>
                isAdmin(request) ? admin.status() : unauthorized(),
            },
            '/admin/tables/:table': {
              GET: async ({ request, params }: { request: Request; params: Record<string, string> }) =>
                isAdmin(request) ? admin.rows(params.table, new URL(request.url)) : unauthorized(),
            },
          }
        : {}),
    },
  });

  return { fetch: (req: Request) => api.fetch(req), broker };
}

function corsHeaders(request: Request, s: ServerSettings): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowAll = s.corsOrigins.includes('*');
  const allowed = allowAll ? '*' : origin && s.corsOrigins.includes(origin) ? origin : '';
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '600',
  };
  if (allowed) h['Access-Control-Allow-Origin'] = allowed;
  if (!allowAll) h['Vary'] = 'Origin';
  return h;
}

/** Node http -> fetch bridge. No framework needed. */
export function createHttpServer(app: { fetch(req: Request): Promise<Response> }) {
  return http.createServer(async (req, res) => {
    try {
      const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const url = `${proto}://${req.headers.host ?? 'localhost'}${req.url}`;
      const chunks: Buffer[] = [];
      let size = 0;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request body is too large.' }));
            return;
          }
          chunks.push(chunk);
        }
      }
      const init: RequestInit & { duplex?: string } = {
        method: req.method,
        headers: req.headers as Record<string, string>,
      };
      if (chunks.length) {
        init.body = Buffer.concat(chunks);
        init.duplex = 'half';
      }
      const response = await app.fetch(new Request(url, init));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) return void res.end();
      // Stream so SSE works.
      const reader = response.body.getReader();
      res.on('close', () => void reader.cancel().catch(() => {}));
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (error) {
      console.error('[local-lite-server]', error);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request failed.' }));
    }
  });
}
