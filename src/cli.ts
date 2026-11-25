#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadSettings } from './config.js';
import { createDatabase } from './db.js';
import { coreMigrationStatus } from './migrations.js';
import { planSchema } from './schema.js';
import { loadSchema, migrate, start } from './start.js';

if (fs.existsSync('.env')) {
  (process as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.('.env');
}

const cmd = process.argv[2] ?? 'start';
const sub = process.argv[3];

function resolveInitDir(targetDir: string | undefined, force: boolean): { cwd: string; relLabel?: string } {
  if (targetDir) {
    return { cwd: path.resolve(process.cwd(), targetDir), relLabel: targetDir };
  }
  const here = process.cwd();
  const hasFiles = fs.readdirSync(here).some((f) => !f.startsWith('.'));
  if (!hasFiles || force) {
    return { cwd: here };
  }
  let name = 'local-lite-server';
  let n = 2;
  while (fs.existsSync(path.join(here, name))) {
    name = `local-lite-server-${n++}`;
  }
  console.log(`Current directory is not empty; creating ./${name}/`);
  return { cwd: path.join(here, name), relLabel: name };
}

function runInit(targetDir: string | undefined, force: boolean) {
  const { cwd, relLabel } = resolveInitDir(targetDir, force);
  fs.mkdirSync(cwd, { recursive: true });
  const apiKey = crypto.randomBytes(24).toString('hex');
  const appSecret = crypto.randomBytes(32).toString('hex');

  const files: Array<[string, string]> = [
    [
      '.env',
      `SERVER_PORT=3000
DB_DIALECT=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=local_lite
DB_POOL_SIZE=5
AUTO_MIGRATE=true
SERVER_API_KEY=${apiKey}
APP_SECRET=${appSecret}
APP_NAME=local-lite-server
ADMIN_UI=true
CORS_ORIGINS=*
`,
    ],
    [
      'schema.ts',
      `export default {
  notes: {
    id: 'string',
    title: 'string',
    body: 'string | null',
    pinned: 'boolean',
    created_at: 'number',
  },
};
`,
    ],
    [
      path.join('functions', 'notes.ts'),
      `export const list = {
  __kind: 'query' as const,
  handler: ({ db }: any) => db.list('notes', { orderBy: 'updated_at', order: 'desc' }),
};

export const create = {
  __kind: 'mutation' as const,
  handler: ({ db }: any, args: { title: string; body?: string | null; pinned?: boolean }) => {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!title) throw Object.assign(new Error('title is required.'), { status: 400 });
    return db.insert('notes', { title, body: args.body ?? null, pinned: Boolean(args.pinned) });
  },
};
`,
    ],
  ];

  for (const [rel, content] of files) {
    const abs = path.join(cwd, rel);
    if (fs.existsSync(abs) && !force) {
      console.log(`skip  ${rel} (already exists)`);
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    console.log(`write ${relLabel ? path.join(relLabel, rel) : rel}`);
  }
  const cdStep = relLabel ? `  1. cd ${relLabel}\n` : '';
  const n = relLabel ? 2 : 1;
  console.log(
    `\nNext:\n${cdStep}  ${n}. Edit .env with your MySQL/Postgres credentials\n  ${n + 1}. Run: npx local-lite-server start`,
  );
}

if (cmd === 'init') {
  const dirArg = process.argv.slice(3).find((a) => !a.startsWith('-'));
  runInit(dirArg, process.argv.includes('--force'));
} else if (cmd === 'start') {
  await start();
} else if (cmd === 'migrate') {
  const settings = loadSettings();
  const schema = await loadSchema(settings);
  const db = createDatabase(settings);
  try {
    if (sub === 'status' || sub === 'diff') {
      console.log('core:', await coreMigrationStatus(db.executor));
      const plan = await planSchema(db.executor, schema).catch(() => null);
      if (!plan) console.log('schema: not initialised (run `migrate`)');
      else {
        console.log(`schema: ${plan.up.length} pending change(s)`);
        if (sub === 'diff') for (const s of plan.up) console.log(`\n${s}`);
        for (const w of plan.warnings) console.log('warning:', w);
      }
    } else {
      await migrate(settings, db, schema);
      console.log('Migrations up to date.');
    }
  } finally {
    await db.close();
  }
} else if (cmd === '-v' || cmd === '--version') {
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8'),
  );
  console.log(pkg.version);
} else {
  console.log(
    'Usage: local-lite-server <init [dir] [--force] | start | migrate [status|diff] | --version>',
  );
  process.exit(cmd === '-h' || cmd === '--help' || cmd === 'help' ? 0 : 1);
}
