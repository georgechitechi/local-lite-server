import type { SqlExecutor, SyncEventBroker } from 'local-lite/server';
import type { ServerSettings } from '../config.js';
import { importUserModule, resolveProjectFile } from '../core/resolve.js';
import type { CommandAuth } from '../commands/index.js';
import type { SchemaDictionary } from '../db/schema.js';

export interface CustomRoutesContext {
  db: SqlExecutor;
  settings: ServerSettings;
  schema: SchemaDictionary;
  broker: SyncEventBroker;
  resolveAuth: (
    request: Request,
    allowQuery?: boolean,
  ) => Promise<CommandAuth | null>;
}

export type CustomRoutesMap = Record<
  string,
  Record<string, (ctx: any) => Promise<Response> | Response>
>;
export type CustomRoutesFactory = (ctx: CustomRoutesContext) => CustomRoutesMap;

export function resolveRoutesFile(
  explicit?: string,
  cwd = process.cwd(),
): string | null {
  return resolveProjectFile(
    explicit,
    'ROUTES_PATH',
    ['routes.mjs', 'src/routes.ts', 'routes.ts'],
    cwd,
  );
}

export async function loadRoutesFile(
  file: string,
): Promise<CustomRoutesMap | CustomRoutesFactory> {
  const loaded = await importUserModule(file);
  const mod = loaded.default;
  if (
    !mod ||
    (typeof mod !== 'object' && typeof mod !== 'function') ||
    Array.isArray(mod)
  ) {
    throw new Error(
      `${file} must export default an endpoints object or factory function.`,
    );
  }
  return mod as CustomRoutesMap | CustomRoutesFactory;
}
