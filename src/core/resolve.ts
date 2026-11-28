import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

/** Dynamically imports a user module and adds an actionable hint if a bare package cannot resolve without node_modules. */
export async function importUserModule(file: string, query = ''): Promise<any> {
  const url = pathToFileURL(file).href + query;
  try {
    return await import(url);
  } catch (err: any) {
    if (
      err?.code === 'ERR_MODULE_NOT_FOUND' &&
      typeof err?.message === 'string' &&
      err.message.includes("Cannot find package 'local-lite-server'")
    ) {
      throw new Error(
        `Cannot find package 'local-lite-server' imported from ${file}. Install dependencies or deploy the bundled .mjs files from dist/cpanel/ (built with build:cpanel) instead of raw .ts files.`,
        { cause: err },
      );
    }
    throw err;
  }
}
