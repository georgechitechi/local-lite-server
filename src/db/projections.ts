import type { CommandAuth, CommandDb } from '../commands/types.js';

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
