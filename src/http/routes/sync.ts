import {
  createSyncEventsHandler,
  type SqlExecutor,
  type SyncEventBroker,
} from 'local-lite/server';
import type { CommandRuntime } from '../../commands/index.js';
import {
  getLensDeltas,
  getLensSnapshot,
  streamLensSnapshot,
  subscribeLens,
  type LensRegistry,
} from '../../db/lenses.js';
import type { RulesDictionary } from '../../db/rules.js';
import type { SchemaDictionary } from '../../db/schema.js';
import type { TableSyncStorage } from '../../db/tableStorage.js';
import type { AuthContext } from '../authContext.js';

function parseArgsObj(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (obj.args && typeof obj.args === 'object' && !Array.isArray(obj.args)) {
      return obj.args as Record<string, unknown>;
    }
    return obj;
  }
  return {};
}

export function syncRoutes(deps: {
  authCtx: AuthContext;
  db: SqlExecutor;
  schema: SchemaDictionary;
  rules: RulesDictionary;
  lenses: LensRegistry;
  storage: TableSyncStorage;
  broker: SyncEventBroker;
  cmdRuntime: CommandRuntime;
}) {
  const { authCtx, db, schema, rules, lenses, storage, broker, cmdRuntime } =
    deps;

  const parseLensArgs = (url: URL): Record<string, unknown> | Response => {
    const rawArgs = url.searchParams.get('args');
    if (!rawArgs) return {};
    try {
      return parseArgsObj(JSON.parse(rawArgs));
    } catch {
      return Response.json({ error: 'Invalid args JSON.' }, { status: 400 });
    }
  };

  return {
    '/sync': {
      GET: async ({ request }: { request: Request }) => {
        const userAuth = await authCtx.resolveAuth(request);
        if (!userAuth) return authCtx.unauthorized();
        const url = new URL(request.url);
        const tables = (url.searchParams.get('tables') ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        const limit = Math.min(
          Math.max(Number(url.searchParams.get('limit') || 500), 1),
          2000,
        );
        return authCtx.guard(async () => {
          const result = await storage.getDeltas(
            tables,
            Number(url.searchParams.get('since') || 0),
            limit,
            userAuth,
          );
          return Response.json({ success: true, ...result });
        });
      },
      POST: async ({ request }: { request: Request }) => {
        const userAuth = await authCtx.resolveAuth(request);
        if (!userAuth) return authCtx.unauthorized();
        const body = (await request.json().catch(() => null)) as {
          operations?: unknown;
        } | null;
        if (!body || !Array.isArray(body.operations)) {
          return Response.json(
            { error: 'Operations must be an array.' },
            { status: 400 },
          );
        }
        return authCtx.guard(async () => {
          const result = await storage.applyOperations(
            body.operations as never[],
            undefined,
            userAuth,
          );
          return Response.json({
            success: true,
            processed: result.applied,
            ...result,
          });
        });
      },
    },
    '/sync/events': {
      GET: async ({ request }: { request: Request }) => {
        const userAuth = await authCtx.resolveAuth(request, true);
        if (!userAuth) return authCtx.unauthorized();
        return createSyncEventsHandler({
          broker,
          authenticate: async () => true,
        })(request);
      },
    },
    '/sync/lens/:name': {
      GET: async ({
        request,
        params,
      }: {
        request: Request;
        params: Record<string, string>;
      }) => {
        const userAuth = await authCtx.resolveAuth(request);
        if (!userAuth) return authCtx.unauthorized();
        const lens = lenses.get(params.name);
        if (!lens) {
          return Response.json(
            { error: `Lens "${params.name}" not found.` },
            { status: 404 },
          );
        }
        const url = new URL(request.url);
        const argsOrErr = parseLensArgs(url);
        if (argsOrErr instanceof Response) return argsOrErr;
        const limit = Math.min(
          Math.max(Number(url.searchParams.get('limit') || 500), 1),
          2000,
        );
        return authCtx.guard(async () => {
          const result = await getLensDeltas({
            db,
            schema,
            rules,
            lens,
            args: argsOrErr,
            since: Number(url.searchParams.get('since') || 0),
            limit,
            auth: userAuth,
          });
          return Response.json({ success: true, ...result });
        });
      },
    },
    '/sync/lens/:name/events': {
      GET: async ({
        request,
        params,
      }: {
        request: Request;
        params: Record<string, string>;
      }) => {
        const userAuth = await authCtx.resolveAuth(request, true);
        if (!userAuth) return authCtx.unauthorized();
        const lens = lenses.get(params.name);
        if (!lens) {
          return Response.json(
            { error: `Lens "${params.name}" not found.` },
            { status: 404 },
          );
        }
        const url = new URL(request.url);
        const argsOrErr = parseLensArgs(url);
        if (argsOrErr instanceof Response) return argsOrErr;
        return authCtx.guard(() =>
          subscribeLens({
            db,
            schema,
            rules,
            broker,
            lens,
            args: argsOrErr,
            since: Number(url.searchParams.get('since') || 0),
            auth: userAuth,
          }),
        );
      },
    },
    '/sync/snapshot/:name': {
      GET: async ({
        request,
        params,
      }: {
        request: Request;
        params: Record<string, string>;
      }) => {
        const userAuth = await authCtx.resolveAuth(request);
        if (!userAuth) return authCtx.unauthorized();
        const lens = lenses.get(params.name);
        if (!lens) {
          return Response.json(
            { error: `Lens "${params.name}" not found.` },
            { status: 404 },
          );
        }
        const url = new URL(request.url);
        const argsOrErr = parseLensArgs(url);
        if (argsOrErr instanceof Response) return argsOrErr;
        const format = url.searchParams.get('format');
        return authCtx.guard(async () => {
          if (format === 'json') {
            const snap = await getLensSnapshot({
              db,
              schema,
              rules,
              lens,
              args: argsOrErr,
              auth: userAuth,
            });
            return Response.json({ success: true, ...snap });
          }
          return streamLensSnapshot({
            db,
            schema,
            rules,
            lens,
            lensName: params.name,
            args: argsOrErr,
            auth: userAuth,
          });
        });
      },
    },
    '/cmd': {
      GET: async ({ request }: { request: Request }) => {
        if (!(await authCtx.resolveAuth(request))) return authCtx.unauthorized();
        return Response.json({ commands: cmdRuntime.list() });
      },
    },
    '/cmd/:module/:name': {
      POST: async ({
        request,
        params,
      }: {
        request: Request;
        params: Record<string, string>;
      }) => {
        const userAuth = await authCtx.resolveAuth(request);
        if (!userAuth) return authCtx.unauthorized();
        const raw = (await request.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        const idempotencyKey =
          request.headers.get('idempotency-key') ??
          (typeof raw.idempotencyKey === 'string'
            ? raw.idempotencyKey
            : undefined);
        return authCtx.guard(async () => {
          const runRes = await cmdRuntime.run(
            `${params.module}/${params.name}`,
            parseArgsObj(raw),
            userAuth,
            { idempotencyKey },
          );
          if (runRes.rejected) {
            return Response.json(
              {
                success: false,
                rejected: true,
                code: runRes.code,
                error: runRes.message,
                details: runRes.details,
              },
              { status: 409 },
            );
          }
          return Response.json({ success: true, ...runRes });
        });
      },
    },
  };
}
