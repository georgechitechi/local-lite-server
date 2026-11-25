import fs from 'node:fs';
import { build } from 'esbuild';

// Self-contained ESM bundle for cPanel "Setup Node.js App" (Node 24+).
// Code-split into a tiny app.mjs entry + chunks/ so unused DB/mail drivers aren't loaded.
const common = {
  entryPoints: ['src/app.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  splitting: true,
  outdir: 'dist/cpanel',
  entryNames: 'app',
  chunkNames: 'chunks/[name]-[hash]',
  outExtension: { '.js': '.mjs' },
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  minify: true,
  logLevel: 'info',
  // Optional mobile/native peers referenced via guarded dynamic requires in
  // local-lite; never reached on a server.
  external: [
    'react-native', 'react-native/*', '@react-native/*', '@react-native-community/*',
    'expo', 'expo-*', 'expo-modules-core', 'react', 'react/*',
    'better-sqlite3', '@libsql/*', 'op-sqlite', '@op-engineering/*',
    'pg-native',
  ],
};

fs.rmSync('dist/cpanel', { recursive: true, force: true });
await build(common);

fs.copyFileSync('schema.ts', 'dist/cpanel/schema.ts');
fs.copyFileSync('.env.example', 'dist/cpanel/.env.example');
fs.copyFileSync('docs/cpanel.md', 'dist/cpanel/README-cpanel.md');
if (fs.existsSync('functions')) {
  fs.cpSync('functions', 'dist/cpanel/functions', { recursive: true });
}
if (fs.existsSync('admin/dist')) {
  fs.cpSync('admin/dist', 'dist/cpanel/admin-ui', { recursive: true });
}
console.log('\ncPanel package ready: dist/cpanel/ (app.mjs, chunks/, schema.ts, .env.example, README-cpanel.md)');
