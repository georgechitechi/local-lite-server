import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FunctionDef, FunctionRegistry } from './types.js';

const EXTENSIONS = ['.ts', '.mts', '.mjs', '.js'];

function resolveFunctionsDir(dir: string | undefined, cwd: string): string {
  if (dir) return path.resolve(cwd, dir);
  const inSrc = path.resolve(cwd, 'src/functions');
  // Avoid loading local-lite-server's own internal src/functions/ runtime when running inside this repo.
  if (
    fs.existsSync(inSrc) &&
    fs.statSync(inSrc).isDirectory() &&
    !fs.existsSync(path.join(inSrc, 'runtime.ts'))
  ) {
    return inSrc;
  }
  return path.resolve(cwd, 'functions');
}

export async function loadFunctionsDir(
  dir?: string,
  cwd = process.cwd(),
  bustCache = false,
): Promise<FunctionRegistry> {
  const registry: FunctionRegistry = new Map();
  const abs = resolveFunctionsDir(dir, cwd);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return registry;

  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('_') || entry.name.endsWith('.d.ts')) continue;
    const ext = EXTENSIONS.find((e) => entry.name.endsWith(e));
    if (!ext) continue;
    const modName = entry.name.slice(0, -ext.length);
    const url = pathToFileURL(path.join(abs, entry.name)).href + (bustCache ? `?t=${Date.now()}` : '');
    const mod = await import(url);
    for (const [expName, val] of Object.entries(mod)) {
      if (val && typeof val === 'object' && '__kind' in val && typeof (val as any).handler === 'function') {
        registry.set(`${modName}/${expName}`, val as FunctionDef<any, any, any>);
      }
    }
  }
  return registry;
}

/** Hot-reloads `functions/` in place on file edits without dropping SSE connections. */
export function watchFunctionsDir(
  dir: string | undefined,
  registry: FunctionRegistry,
  cwd = process.cwd(),
): () => void {
  const abs = resolveFunctionsDir(dir, cwd);
  if (!fs.existsSync(abs)) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = fs.watch(abs, () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const next = await loadFunctionsDir(dir, cwd, true);
        registry.clear();
        for (const [k, v] of next) registry.set(k, v);
        console.log(`[local-lite-server] hot-reloaded ${registry.size} function(s)`);
      } catch (err) {
        console.error('[local-lite-server] function reload failed:', err);
      }
    }, 120);
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
