import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SqlExecutor, SyncEventBroker } from 'local-lite/server';
import type { ServerSettings } from './config.js';
import type { FunctionAuth } from './functions/index.js';
import type { SchemaDictionary } from './schema.js';

export interface CustomRoutesContext {
  db: SqlExecutor;
  settings: ServerSettings;
  schema: SchemaDictionary;
  broker: SyncEventBroker;
  resolveAuth: (request: Request, allowQuery?: boolean) => Promise<FunctionAuth | null>;
}

export type CustomRoutesMap = Record<string, Record<string, (ctx: any) => Promise<Response> | Response>>;
export type CustomRoutesFactory = (ctx: CustomRoutesContext) => CustomRoutesMap;

const CANDIDATES = ['routes.mjs', 'src/routes.ts', 'routes.ts'];

export function resolveRoutesFile(explicit?: string, cwd = process.cwd()): string | null {
  if (explicit) {
    const abs = path.resolve(cwd, explicit);
    if (!fs.existsSync(abs)) throw new Error(`ROUTES_PATH not found: ${abs}`);
    return abs;
  }
  const isOwnRepo = fs.existsSync(path.resolve(cwd, 'src/cli.ts'));
  for (const name of CANDIDATES) {
    if (isOwnRepo && name === 'src/routes.ts') continue;
    const abs = path.resolve(cwd, name);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

export async function loadRoutesFile(file: string): Promise<CustomRoutesMap | CustomRoutesFactory> {
  const loaded = await import(pathToFileURL(file).href);
  const mod = loaded.default ?? loaded.routes;
  if (!mod || (typeof mod !== 'object' && typeof mod !== 'function') || Array.isArray(mod)) {
    throw new Error(`${file} must export default an endpoints object or factory function.`);
  }
  return mod as CustomRoutesMap | CustomRoutesFactory;
}
