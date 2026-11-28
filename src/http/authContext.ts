import type { ApiKeyService } from '../auth/apiKeys.js';
import type { AuthService } from '../auth/auth.js';
import { verifyOAuthToken } from '../auth/oauth.js';
import { clientIp } from '../auth/rateLimit.js';
import { CommandError, type CommandAuth } from '../commands/index.js';
import type { ServerSettings } from '../config.js';
import { HttpError } from '../core/errors.js';
import { safeEqual } from '../core/http.js';
import { ClientError, ForbiddenError } from '../db/tableStorage.js';

export type ResolvedAuth = CommandAuth;

export function createAuthContext(deps: {
  settings: ServerSettings;
  apiKeys: ApiKeyService;
  auth: AuthService;
  authLimiter: (ip: string) => Promise<{ ok: boolean; retryAfter?: number }>;
}) {
  const { settings, apiKeys, auth, authLimiter } = deps;

  const bearer = (request: Request): string => {
    const header = request.headers.get('authorization') ?? '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  };
  const apiKeyHeader = (request: Request): string =>
    request.headers.get('x-api-key')?.trim() ?? '';

  const unauthorized = () =>
    Response.json({ error: 'Unauthorized' }, { status: 401 });
  const forbidden = (msg = 'Forbidden') =>
    Response.json({ error: msg }, { status: 403 });

  const resolveAuth = async (
    request: Request,
    allowQuery = false,
  ): Promise<ResolvedAuth | null> => {
    const token =
      bearer(request) ||
      apiKeyHeader(request) ||
      (allowQuery
        ? (new URL(request.url).searchParams.get('token') ?? '')
        : '');
    if (!token) return null;

    if (safeEqual(token, settings.apiKey)) {
      return { isAdmin: true };
    }
    const keyAuth = await apiKeys.verifyKey(token);
    if (keyAuth) {
      return { isAdmin: keyAuth.isAdmin, userId: keyAuth.userId };
    }
    const user = await auth.verifyUser(token);
    if (user) {
      return { isAdmin: false, userId: user.id };
    }
    const oauthUser = await verifyOAuthToken(token);
    if (oauthUser) return { isAdmin: false, userId: oauthUser.id };
    return null;
  };

  const guard = async (run: () => Promise<Response>): Promise<Response> => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof HttpError || err instanceof CommandError) {
        return Response.json({ error: err.message }, { status: err.status });
      }
      if (err instanceof ClientError) {
        return Response.json({ error: err.message }, { status: 400 });
      }
      if (err instanceof ForbiddenError) {
        return Response.json({ error: err.message }, { status: 403 });
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

  const rateLimited = async (request: Request): Promise<Response | null> => {
    const limit = await authLimiter(clientIp(request));
    if (limit.ok) return null;
    return Response.json(
      { error: 'Too many requests. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  };

  return {
    bearer,
    apiKeyHeader,
    unauthorized,
    forbidden,
    resolveAuth,
    guard,
    rateLimited,
  };
}

export type AuthContext = ReturnType<typeof createAuthContext>;
