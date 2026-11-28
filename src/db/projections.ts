import type { CommandAuth, CommandDb } from '../commands/types.js';
import { importUserModule, resolveProjectFile } from '../core/resolve.js';

export type ProjectionOp = 'insert' | 'patch' | 'remove';

export interface ProjectionChange {
  table: string;
  rowId: string;
  op: ProjectionOp;
  before: Record<string, any> | null;
  after: Record<string, any> | null;
}

export interface ProjectionContext {
  db: CommandDb;
  auth: CommandAuth;
}

export interface ProjectionDef {
  __kind: 'projection';
  tables: string[];
  handler: (
    ctx: ProjectionContext,
    change: ProjectionChange,
  ) => Promise<void> | void;
}

export type ProjectionRegistry = Map<string, ProjectionDef>;

/**
 * Defines an incremental SQL projection that runs inside the same transaction
 * as a mutating command, keeping summary tables consistent and sync-ready.
 */
export function defineProjection(def: {
  on: string | string[];
  handler: (
    ctx: ProjectionContext,
    change: ProjectionChange,
  ) => Promise<void> | void;
}): ProjectionDef {
  const tables = Array.isArray(def.on) ? def.on : [def.on];
  if (tables.length === 0 || tables.some((t) => !t || typeof t !== 'string')) {
    throw new Error('defineProjection requires one or more valid table names.');
  }
  return { __kind: 'projection', tables, handler: def.handler };
}

/** Builds a ProjectionRegistry from a named dictionary of projection definitions. */
export function defineProjections(
  input: Record<string, ProjectionDef>,
): ProjectionRegistry {
  const registry: ProjectionRegistry = new Map();
  for (const [name, def] of Object.entries(input)) {
    if (def) registry.set(name, def);
  }
  return registry;
}

export function resolveProjectionsFile(
  explicit?: string,
  cwd = process.cwd(),
): string | null {
  return resolveProjectFile(
    explicit,
    'PROJECTIONS_PATH',
    ['projections.mjs', 'src/projections.ts', 'projections.ts'],
    cwd,
  );
}

export async function loadProjectionsFile(
  file: string,
): Promise<ProjectionRegistry> {
  const loaded = await importUserModule(file);
  const mod = loaded.default;
  if (mod instanceof Map) return mod as ProjectionRegistry;
  if (!mod || typeof mod !== 'object' || Array.isArray(mod)) {
    throw new Error(
      `${file} must export default defineProjections({ ... }).`,
    );
  }
  return defineProjections(mod as Record<string, ProjectionDef>);
}
