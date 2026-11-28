import path from 'node:path';
import { execSync, spawn } from 'node:child_process';

const tscBin = path.resolve('node_modules/typescript/bin/tsc');

// Initial build so dist/cli.js exists before node --watch starts.
execSync(`"${process.execPath}" "${tscBin}" -p tsconfig.json`, { stdio: 'inherit' });

const cwdPrefix = process.cwd() + path.sep;
const escapedPrefix = cwdPrefix.replaceAll('\\', '\\\\');

const tsc = spawn(process.execPath, [tscBin, '-p', 'tsconfig.json', '-w', '--preserveWatchOutput'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

const pipeCompact = (stream, dest) => {
  stream?.on('data', (chunk) => {
    const lines = String(chunk)
      .replaceAll(escapedPrefix, '')
      .replaceAll(cwdPrefix, '')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '');
    if (
      lines.some(
        (l) =>
          l.includes('Starting incremental compilation') ||
          l.includes('Restarting '),
      )
    ) {
      console.clear();
    }
    if (lines.length) dest.write(`${lines.join('\n')}\n`);
  });
};
pipeCompact(tsc.stdout, process.stdout);
pipeCompact(tsc.stderr, process.stderr);

const srv = spawn('node', ['--watch', '--env-file-if-exists=.env', 'dist/cli.js', 'start'], {
  stdio: ['inherit', 'pipe', 'pipe'],
});
pipeCompact(srv.stdout, process.stdout);
pipeCompact(srv.stderr, process.stderr);

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
