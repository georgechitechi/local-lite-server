import fs from 'node:fs';
import path from 'node:path';

/** Resolves a project config file (`src/<name>` or `<name>`), skipping this repo's own `src/` internals. */
export function resolveProjectFile(
  explicit: string | undefined,
  envKey: string,
  candidates: readonly string[],
  cwd = process.cwd(),
): string | null {
  if (explicit) {
    const abs = path.resolve(cwd, explicit);
    if (!fs.existsSync(abs)) throw new Error(`${envKey} not found: ${abs}`);
    return abs;
  }
  const isOwnRepo = fs.existsSync(path.resolve(cwd, 'src/cli.ts'));
  for (const name of candidates) {
    if (isOwnRepo && name.startsWith('src/')) continue;
    const abs = path.resolve(cwd, name);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}
