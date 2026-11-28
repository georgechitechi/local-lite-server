import fs from 'node:fs';
import path from 'node:path';
import { importUserModule } from '../core/resolve.js';
import type { CommandDef, CommandRegistry } from './types.js';

const EXTENSIONS = ['.ts', '.mts', '.mjs', '.js'];

function resolveCommandsDir(dir: string | undefined, cwd: string): string {
  if (dir) return path.resolve(cwd, dir);
  const inSrc = path.resolve(cwd, 'src/commands');
  // Avoid loading local-lite-server's own internal src/commands/ runtime when running inside this repo.
  if (
    fs.existsSync(inSrc) &&
    fs.statSync(inSrc).isDirectory() &&
    !fs.existsSync(path.join(inSrc, 'runtime.ts'))
  ) {
    return inSrc;
  }
  return path.resolve(cwd, 'commands');
}

export async function loadCommandsDir(
  dir?: string,
  cwd = process.cwd(),
  bustCache = false,
): Promise<CommandRegistry> {
  const registry: CommandRegistry = new Map();
  const abs = resolveCommandsDir(dir, cwd);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return registry;

  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      entry.name.startsWith('_') ||
      entry.name.endsWith('.d.ts')
    )
      continue;
    const ext = EXTENSIONS.find((e) => entry.name.endsWith(e));
    if (!ext) continue;
    const modName = entry.name.slice(0, -ext.length);
    const mod = await importUserModule(
      path.join(abs, entry.name),
      bustCache ? `?t=${Date.now()}` : '',
    );
    for (const [expName, val] of Object.entries(mod)) {
      if (
        val &&
        typeof val === 'object' &&
        (val as any).__kind === 'command' &&
        typeof (val as any).handler === 'function'
      ) {
        registry.set(
          `${modName}/${expName}`,
          val as CommandDef<any, any>,
        );
      }
    }
  }
  return registry;
}

/** Hot-reloads `commands/` in place on file edits. */
export function watchCommandsDir(
  dir: string | undefined,
  registry: CommandRegistry,
  cwd = process.cwd(),
): () => void {
  const abs = resolveCommandsDir(dir, cwd);
  if (!fs.existsSync(abs)) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = fs.watch(abs, () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const next = await loadCommandsDir(dir, cwd, true);
        registry.clear();
        for (const [k, v] of next) registry.set(k, v);
        console.log(
          `[local-lite-server] hot-reloaded ${registry.size} command(s)`,
        );
      } catch (err) {
        console.error('[local-lite-server] command reload failed:', err);
      }
    }, 150);
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
