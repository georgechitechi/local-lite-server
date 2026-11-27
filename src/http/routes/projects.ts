import {
  SlugTakenError,
  type ProjectRecord,
  type ProjectService,
} from '../../services/projects.js';
import type { SchemaDictionary } from '../../db/schema.js';
import type { AuthContext, ProjectCaller } from '../authContext.js';
import type { ProjectRuntimeCache } from '../projectRuntime.js';

export function projectRoutes(deps: {
  projects: ProjectService;
  authCtx: AuthContext;
  runtimeCache: ProjectRuntimeCache;
}) {
  const { projects, authCtx, runtimeCache } = deps;

  const withManagedProject = async (
    request: Request,
    id: string,
    run: (
      project: ProjectRecord,
      caller: ProjectCaller,
    ) => Promise<Response> | Response,
  ): Promise<Response> => {
    const caller = await authCtx.resolveProjectCaller(request);
    if (!caller) return authCtx.unauthorized();
    const project = await projects.getProject(id);
    if (!project)
      return Response.json({ error: 'Project not found.' }, { status: 404 });
    if (!authCtx.canManageProject(caller, project)) return authCtx.forbidden();
    return run(project, caller);
  };

  return {
    '/projects': {
      GET: async ({ request }: { request: Request }) => {
        const caller = await authCtx.resolveProjectCaller(request);
        if (!caller) return authCtx.unauthorized();
        const list = await projects.listProjects(
          caller.isSuperAdmin ? undefined : (caller.userId ?? ''),
        );
        return Response.json({ projects: list });
      },
      POST: async ({ request }: { request: Request }) => {
        const caller = await authCtx.resolveProjectCaller(request);
        if (!caller) return authCtx.unauthorized();
        const body = (await request.json().catch(() => null)) as {
          name?: string;
          slug?: string;
          schema?: SchemaDictionary;
          rules?: Record<string, any>;
        } | null;
        try {
          const project = await projects.createProject({
            name: String(body?.name ?? ''),
            slug: body?.slug ? String(body.slug) : undefined,
            ownerUserId: caller.userId,
            schema:
              body?.schema && typeof body.schema === 'object'
                ? body.schema
                : undefined,
            rules:
              body?.rules && typeof body.rules === 'object'
                ? body.rules
                : undefined,
          });
          return Response.json({ project }, { status: 201 });
        } catch (err) {
          if (err instanceof SlugTakenError) {
            return Response.json(
              { error: err.message, suggestions: err.suggestions },
              { status: 409 },
            );
          }
          return Response.json(
            { error: (err as Error).message },
            { status: 400 },
          );
        }
      },
    },
    '/projects/:id/schema': {
      POST: ({
        request,
        params,
      }: {
        request: Request;
        params: Record<string, string>;
      }) =>
        withManagedProject(request, params.id, async (project) => {
          const body = (await request.json().catch(() => null)) as {
            schema?: SchemaDictionary;
            rules?: Record<string, any>;
          } | null;
          if (
            !body?.schema ||
            typeof body.schema !== 'object' ||
            Array.isArray(body.schema)
          ) {
            return Response.json(
              { error: 'schema object is required.' },
              { status: 400 },
            );
          }
          try {
            const res = await projects.applyProjectSchema(
              project.id,
              body.schema,
              body.rules,
            );
            runtimeCache.invalidate(project.id);
            return Response.json(res);
          } catch (err) {
            return Response.json(
              { error: (err as Error).message },
              { status: 400 },
            );
          }
        }),
    },
    '/projects/:id/export': {
      GET: ({
        request,
        params,
      }: {
        request: Request;
        params: Record<string, string>;
      }) =>
        withManagedProject(request, params.id, async (project) =>
          Response.json(await projects.exportProject(project.id)),
        ),
    },
    '/projects/:id': {
      DELETE: ({
        request,
        params,
      }: {
        request: Request;
        params: Record<string, string>;
      }) =>
        withManagedProject(request, params.id, async (project) => {
          await projects.deleteProject(project.id);
          runtimeCache.invalidate(project.id);
          return Response.json({ ok: true });
        }),
    },
  };
}
