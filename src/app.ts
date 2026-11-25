// cPanel / Passenger entry point (bundled to dist/cpanel/app.mjs).
import fs from 'node:fs';
import { start } from './start.js';

if (fs.existsSync('.env')) {
  (process as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.('.env');
}

start().catch((err) => {
  console.error('[local-lite-server] failed to start:', err);
  process.exit(1);
});
