import type { SqlExecutor, SyncEventBroker } from 'local-lite/server';
import { createAuthService, type AuthService } from '../auth/auth.js';
import type { ServerSettings } from '../config.js';
import { scopeBroker } from '../core/broker.js';
import {
  createFunctionRuntime,
  type FunctionRegistry,
  type FunctionRuntime,
} from '../functions/index.js';
import type { ProjectRecord } from '../services/projects.js';
import type { RulesDictionary } from '../db/rules.js';
import { createStorageHandler } from '../services/storage.js';
import { TableSyncStorage } from '../db/tableStorage.js';
import type { ResolvedAuth } from './authContext.js';

export interface ProjectRuntimeBundle {
  project: ProjectRecord;
  broker: SyncEventBroker;
  syncStorage: TableSyncStorage;
  auth: AuthService;
  fnRuntime: FunctionRuntime;
  storageHandler: (req: Request) => Promise<Response>;
}

/**
 * Caches per-project runtime services (sync storage, isolated SSE broker,
 * project-scoped auth, functions, and file storage) and invalidates on schema/delete.
 */
export function createProjectRuntimeCache(deps: {
  settings: ServerSettings;
  db: SqlExecutor;
  rootBroker: SyncEventBroker;
  rootRules: RulesDictionary;
  functions: FunctionRegistry;
  resolveAuth: (
    request: Request,
    allowQuery?: boolean,
    projectScope?: ProjectRecord | null,
  ) => Promise<ResolvedAuth | null>;
}) {
  const cache = new Map<string, ProjectRuntimeBundle>();

  const get = (project: ProjectRecord): ProjectRuntimeBundle => {
    const existing = cache.get(project.id);
    if (existing && existing.project.updatedAt === project.updatedAt) {
      return existing;
    }

    const broker = scopeBroker(deps.rootBroker, project.id);
    const rules = Object.keys(project.rules).length ? project.rules : deps.rootRules;
    const syncStorage = new TableSyncStorage(deps.db, {
      schema: project.schema,
      rules,
      broker,
      projectId: project.id,
    });
    const auth = createAuthService(deps.settings, deps.db, project.id);
    const fnRuntime = createFunctionRuntime({
      registry: deps.functions,
      db: deps.db,
      schema: project.schema,
      broker,
      projectId: project.id,
    });
    const storageHandler = createStorageHandler(
      deps.settings,
      deps.db,
      async (req) => {
        const a = await deps.resolveAuth(req, true, project);
        if (!a) return null;
        if (a.projectId && a.projectId !== project.id) return null;
        if (a.isAdmin && !a.isSuperAdmin && !a.projectId && project.ownerUserId !== a.userId) {
          return null;
        }
        return { userId: a.userId ?? 'admin', isAdmin: a.isAdmin };
      },
      { projectId: project.id, basePath: `/p/${project.slug}/storage` },
    );

    const bundle: ProjectRuntimeBundle = {
      project,
      broker,
      syncStorage,
      auth,
      fnRuntime,
      storageHandler,
    };
    cache.set(project.id, bundle);
    return bundle;
  };

  const invalidate = (projectId: string) => {
    cache.delete(projectId);
  };

  return { get, invalidate };
}

export type ProjectRuntimeCache = ReturnType<typeof createProjectRuntimeCache>;
