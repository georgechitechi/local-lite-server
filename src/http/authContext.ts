import type { ApiKeyService } from '../auth/apiKeys.js';
import type { AuthService } from '../auth/auth.js';
import type { ServerSettings } from '../config.js';
import { HttpError } from '../core/errors.js';
import { safeEqual } from '../core/http.js';
import { FunctionError, type FunctionAuth } from '../functions/index.js';
import { verifyOAuthToken } from '../auth/oauth.js';
import type { ProjectRecord, ProjectService } from '../services/projects.js';
import { clientIp } from '../auth/rateLimit.js';
import { ClientError, ForbiddenError } from '../db/tableStorage.js';

export type ResolvedAuth = FunctionAuth & {
  projectId?: string | null;
  isSuperAdmin?: boolean;
};

export type ProjectCaller = {
  isSuperAdmin: boolean;
  userId: string | null;
};

export interface AdminSessionLike {
  userId?: string;
  consoleRole: 'super_admin' | 'admin';
}

export function createAuthContext(deps: {
  settings: ServerSettings;
  apiKeys: ApiKeyService;
  rootAuth: AuthService;
  projects: ProjectService;
  authenticateAdmin: (req: Request) => Promise<AdminSessionLike | null>;
  authLimiter: (ip: string) => Promise<{ ok: boolean; retryAfter?: number }>;
  getProjectAuth?: (project: ProjectRecord) => AuthService;
}) {
  const { settings, apiKeys, rootAuth, projects, authenticateAdmin, authLimiter } = deps;

  const bearer = (request: Request): string => {
    const header = request.headers.get('authorization') ?? '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  };
  const apiKeyHeader = (request: Request): string =>
    request.headers.get('x-api-key')?.trim() ?? '';

  const unauthorized = () => Response.json({ error: 'Unauthorized' }, { status: 401 });
  const forbidden = (msg = 'Forbidden') => Response.json({ error: msg }, { status: 403 });

  const resolveAuth = async (
    request: Request,
    allowQuery = false,
    projectScope?: ProjectRecord | null,
  ): Promise<ResolvedAuth | null> => {
    const token =
      bearer(request) ||
      apiKeyHeader(request) ||
      (allowQuery ? (new URL(request.url).searchParams.get('token') ?? '') : '');
    if (token) {
      if (safeEqual(token, settings.apiKey)) {
        return { isAdmin: true, isSuperAdmin: true, projectId: null };
      }
      const keyAuth = await apiKeys.verifyKey(token);
      if (keyAuth) {
        return {
          isAdmin: keyAuth.isAdmin,
          userId: keyAuth.userId,
          projectId: keyAuth.projectId ?? null,
        };
      }
      const authSvc = projectScope && deps.getProjectAuth ? deps.getProjectAuth(projectScope) : rootAuth;
      const user = await authSvc.verifyUser(token);
      if (user) {
        return { isAdmin: false, userId: user.id, projectId: projectScope?.id ?? null };
      }
      const oauthUser = await verifyOAuthToken(token);
      if (oauthUser) return { isAdmin: false, userId: oauthUser.id };
    }
    if (settings.adminUi) {
      const adminSession = await authenticateAdmin(request);
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

  const guard = async (run: () => Promise<Response>): Promise<Response> => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof HttpError || err instanceof FunctionError) {
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

  const withAdmin =
    (run: (request: Request, session: AdminSessionLike) => Promise<Response> | Response) =>
    async ({ request }: { request: Request }) => {
      const s = await authenticateAdmin(request);
      return s ? run(request, s) : unauthorized();
    };

  const withSuperAdmin =
    (run: (request: Request, session: AdminSessionLike) => Promise<Response> | Response) =>
    withAdmin((request, s) =>
      s.consoleRole === 'super_admin' ? run(request, s) : forbidden('Super admin required.'),
    );

  // Breaking change: /admin/* reads X-Project-Id header exclusively (no ?projectId= query fallback).
  const resolveAdminProject = async (
    request: Request,
    s: AdminSessionLike,
    allowDefaultForAdmin = false,
  ): Promise<{ project: ProjectRecord | null; error?: Response }> => {
    const pid = request.headers.get('x-project-id')?.trim() || '';
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
    (
      run: (
        request: Request,
        session: AdminSessionLike,
        project: ProjectRecord | null,
      ) => Promise<Response> | Response,
    ) =>
    withAdmin(async (request, s) => {
      const { project, error } = await resolveAdminProject(request, s);
      if (error) return error;
      return run(request, s, project);
    });

  const resolveProjectCaller = async (request: Request): Promise<ProjectCaller | null> => {
    const token = bearer(request) || apiKeyHeader(request);
    if (token && safeEqual(token, settings.apiKey)) {
      return { isSuperAdmin: true, userId: null };
    }
    if (settings.adminUi) {
      const s = await authenticateAdmin(request);
      if (s) return { isSuperAdmin: s.consoleRole === 'super_admin', userId: s.userId ?? null };
    }
    return null;
  };

  const canManageProject = (caller: ProjectCaller, p: ProjectRecord) =>
    caller.isSuperAdmin || (caller.userId !== null && p.ownerUserId === caller.userId);

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
    withAdmin,
    withSuperAdmin,
    resolveAdminProject,
    withAdminProject,
    resolveProjectCaller,
    canManageProject,
    rateLimited,
  };
}

export type AuthContext = ReturnType<typeof createAuthContext>;
