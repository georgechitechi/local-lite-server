import fs from 'node:fs';
import { build } from 'esbuild';

// Self-contained bundle for cPanel "Setup Node.js App": no `npm install` needed on the server.
// Startup file: app.cjs (CommonJS loads under every Passenger/lsnode version). app.mjs is the ESM twin.
const common = {
  entryPoints: ['src/app.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
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
await build({ ...common, format: 'cjs', outfile: 'dist/cpanel/app.cjs' });
await build({
  ...common,
  format: 'esm',
  outfile: 'dist/cpanel/app.mjs',
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});

fs.copyFileSync('schema.ts', 'dist/cpanel/schema.ts');
fs.copyFileSync('.env.example', 'dist/cpanel/.env.example');
fs.copyFileSync('docs/cpanel.md', 'dist/cpanel/README-cpanel.md');
if (fs.existsSync('functions')) {
  fs.cpSync('functions', 'dist/cpanel/functions', { recursive: true });
}
console.log('\ncPanel package ready: dist/cpanel/ (app.cjs, schema.ts, .env.example, README-cpanel.md)');
