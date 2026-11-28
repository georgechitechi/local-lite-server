import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const cwd = process.cwd();
const outDir = path.resolve(cwd, process.argv[2] || 'dist/cpanel');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const banner = {
  js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
};

// 1. Bundle server entry (CLI + start + all npm deps) with ESM code-splitting into chunks/
await build({
  entryPoints: { app: path.resolve(cwd, 'src/cli.ts') },
  outdir: outDir,
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  outExtension: { '.js': '.mjs' },
  splitting: true,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  minify: true,
  external: [
    'react-native',
    'expo-sqlite',
    'expo-file-system',
    'better-sqlite3',
    '@libsql/client',
    '@op-engineering/op-sqlite',
    'sql.js',
    'pg-native',
  ],
  banner,
  logLevel: 'warning',
});

// 2. Copy built Vite dashboard assets
const dashSrc = path.resolve(cwd, 'dashboard/dist');
if (fs.existsSync(dashSrc)) {
  fs.cpSync(dashSrc, path.join(outDir, 'dashboard/dist'), { recursive: true });
}

// 3. Bundle optional user files (schema, rules, routes, commands/) if present
const bundleUserFile = async (candidates, outName) => {
  for (const rel of candidates) {
    const abs = path.resolve(cwd, rel);
    if (!fs.existsSync(abs)) continue;
    await build({
      entryPoints: [abs],
      outfile: path.join(outDir, outName),
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'esm',
      banner,
      logLevel: 'warning',
    });
    return true;
  }
  return false;
};

await bundleUserFile(['src/schema.ts', 'schema.ts'], 'schema.mjs');
await bundleUserFile(['src/rules.ts', 'rules.ts'], 'rules.mjs');
await bundleUserFile(['src/lenses.ts', 'lenses.ts'], 'lenses.mjs');
await bundleUserFile(['src/projections.ts', 'projections.ts'], 'projections.mjs');
await bundleUserFile(['src/outbox.ts', 'outbox.ts'], 'outbox.mjs');
await bundleUserFile(['src/routes.ts', 'routes.ts'], 'routes.mjs');

const cmdsDir = ['commands', 'src/commands']
  .map((d) => path.resolve(cwd, d))
  .find(
    (d) =>
      fs.existsSync(d) &&
      fs.statSync(d).isDirectory() &&
      !fs.existsSync(path.join(d, 'runtime.ts')),
  );

if (cmdsDir) {
  const cmdOut = path.join(outDir, 'commands');
  fs.mkdirSync(cmdOut, { recursive: true });
  for (const entry of fs.readdirSync(cmdsDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('_') || !/\.(ts|mts|mjs|js)$/.test(entry.name)) {
      continue;
    }
    const base = entry.name.replace(/\.(ts|mts|mjs|js)$/, '');
    await build({
      entryPoints: [path.join(cmdsDir, entry.name)],
      outfile: path.join(cmdOut, `${base}.mjs`),
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'esm',
      banner,
      logLevel: 'warning',
    });
  }
}

// 4. Write minimal package.json + .env.example for cPanel / Passenger
const rootPkg = JSON.parse(fs.readFileSync(path.resolve(cwd, 'package.json'), 'utf8'));
fs.writeFileSync(
  path.join(outDir, 'package.json'),
  JSON.stringify(
    {
      name: 'local-lite-server-cpanel',
      version: rootPkg.version,
      private: true,
      type: 'module',
      main: 'app.mjs',
      engines: { node: '>=24.0.0' },
      scripts: { start: 'node app.mjs' },
    },
    null,
    2,
  ) + '\n',
);

const envExample = path.resolve(cwd, '.env.example');
if (fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, path.join(outDir, '.env.example'));
}

console.log(`Standalone cPanel bundle ready: ${path.relative(cwd, outDir) || outDir}/ (zero node_modules required)`);
