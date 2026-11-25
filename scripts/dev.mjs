import { execSync, spawn } from 'node:child_process';

// Initial build so dist/cli.js exists before node --watch starts.
execSync('npx tsc -p tsconfig.json', { stdio: 'inherit' });

const tsc = spawn('npx', ['tsc', '-p', 'tsconfig.json', '-w', '--preserveWatchOutput'], {
  stdio: 'inherit',
  shell: true,
});

const srv = spawn('node', ['--watch', '--env-file-if-exists=.env', 'dist/cli.js', 'start'], {
  stdio: 'inherit',
});

const stop = () => {
  tsc.kill();
  srv.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
srv.on('exit', (code) => {
  tsc.kill();
  process.exit(code ?? 0);
});
