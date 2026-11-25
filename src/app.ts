// cPanel / Passenger entry point (bundled to dist/cpanel/app.js).
import { start } from './start.js';

start().catch((err) => {
  console.error('[local-lite-server] failed to start:', err);
  process.exit(1);
});
