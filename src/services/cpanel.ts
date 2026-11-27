import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { resolveRoutesFile } from './routes.js';
import { resolveRulesFile } from '../db/rules.js';
import { resolveSchemaFile } from '../db/schema.js';

const require = createRequire(import.meta.url);

const EXTERNAL_PEERS = [
  'react-native',
  'react-native/*',
  '@react-native/*',
  '@react-native-community/*',
  'expo',
  'expo-*',
  'expo-modules-core',
  'react',
  'react/*',
  'better-sqlite3',
  '@libsql/*',
  'op-sqlite',
  '@op-engineering/*',
  'pg-native',
];

export async function buildCpanelBundle(
  cwd = process.cwd(),
  outDir = 'dist/cpanel',
) {
  const pkgRoot = path.resolve(import.meta.dirname, '../..');
  const isOwnRepo = fs.existsSync(path.resolve(cwd, 'src/cli.ts'));
  const entryPoint = isOwnRepo
    ? path.resolve(cwd, 'src/app.ts')
    : path.resolve(import.meta.dirname, '../app.js');
  const absOut = path.resolve(cwd, outDir);
  const nodemailerDir = path.dirname(
    require.resolve('nodemailer/package.json'),
  );

  fs.rmSync(absOut, { recursive: true, force: true });

  await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    splitting: true,
    treeShaking: true,
    legalComments: 'none',
    drop: ['debugger'],
    alias: {
      nodemailer: nodemailerDir,
    },
    outdir: absOut,
    entryNames: 'app',
    chunkNames: 'chunks/[name]-[hash]',
    outExtension: { '.js': '.mjs' },
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    minify: true,
    logLevel: 'info',
    external: EXTERNAL_PEERS,
  });

  const bundleSingle = async (entry: string, outfile: string) => {
    await build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'esm',
      treeShaking: true,
      legalComments: 'none',
      outfile,
      minify: true,
      logLevel: 'info',
      external: EXTERNAL_PEERS,
    });
  };

  try {
    const schemaFile = resolveSchemaFile(undefined, cwd);
    await bundleSingle(schemaFile, path.join(absOut, 'schema.mjs'));
  } catch {
    // User may upload schema separately
  }

  const rulesFile = resolveRulesFile(undefined, cwd);
  if (rulesFile) {
    await bundleSingle(rulesFile, path.join(absOut, 'rules.mjs'));
  }

  const routesFile = resolveRoutesFile(undefined, cwd);
  if (routesFile) {
    await bundleSingle(routesFile, path.join(absOut, 'routes.mjs'));
  }

  const envExample = fs.existsSync(path.resolve(cwd, '.env.example'))
    ? path.resolve(cwd, '.env.example')
    : path.resolve(pkgRoot, 'templates/.env.example');
  if (fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, path.join(absOut, '.env.example'));
  }

  const cpanelDoc = path.resolve(pkgRoot, 'docs/cpanel.md');
  if (fs.existsSync(cpanelDoc)) {
    fs.copyFileSync(cpanelDoc, path.join(absOut, 'README-cpanel.md'));
  }

  const srcFns = path.resolve(cwd, 'src/functions');
  const rootFns = path.resolve(cwd, 'functions');
  const fnsDir =
    !isOwnRepo && fs.existsSync(srcFns)
      ? srcFns
      : fs.existsSync(rootFns)
        ? rootFns
        : null;
  if (fnsDir) {
    fs.cpSync(fnsDir, path.join(absOut, 'functions'), { recursive: true });
  }

  const adminDist = path.resolve(pkgRoot, 'admin/dist');
  if (fs.existsSync(adminDist)) {
    fs.cpSync(adminDist, path.join(absOut, 'admin'), { recursive: true });
  }

  console.log(
    `\ncPanel package ready: ${outDir}/ (app.mjs, chunks/, schema.mjs, rules.mjs, .env.example, README-cpanel.md)`,
  );
}
