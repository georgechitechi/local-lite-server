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
  if (!hasFiles || force) return { cwd: here };
  let name = 'local-lite-server';
  let n = 2;
  while (fs.existsSync(path.join(here, name))) name = `local-lite-server-${n++}`;
  console.log(`Current directory is not empty; creating ./${name}/`);
  return { cwd: path.join(here, name), relLabel: name };
}

function collectTemplates(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTemplates(abs, root));
    else out.push(path.relative(root, abs));
  }
  return out;
}

function runInit(targetDir: string | undefined, force: boolean) {
  const { cwd, relLabel } = resolveInitDir(targetDir, force);
  fs.mkdirSync(cwd, { recursive: true });
  const tplRoot = path.resolve(import.meta.dirname, '../templates');
  const vars: Record<string, string> = {
    PKG_NAME: path.basename(cwd).toLowerCase().replace(/[^a-z0-9-_]/g, '-') || 'my-local-lite-server',
    API_KEY: crypto.randomBytes(24).toString('hex'),
    APP_SECRET: crypto.randomBytes(32).toString('hex'),
  };

  for (const rel of collectTemplates(tplRoot)) {
    const outRel = rel === 'gitignore' ? '.gitignore' : rel;
    const dest = path.join(cwd, outRel);
    if (fs.existsSync(dest) && !force) {
      console.log(`skip  ${relLabel ? path.join(relLabel, outRel) : outRel} (already exists)`);
      continue;
    }
    let content = fs.readFileSync(path.join(tplRoot, rel), 'utf8');
    for (const [k, v] of Object.entries(vars)) content = content.replaceAll(`{{${k}}}`, v);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    console.log(`write ${relLabel ? path.join(relLabel, outRel) : outRel}`);
  }

  const cdStep = relLabel ? `  1. cd ${relLabel}\n` : '';
  const n = relLabel ? 2 : 1;
  console.log(
    `\nNext:\n${cdStep}  ${n}. Edit .env with your MySQL/Postgres credentials\n  ${n + 1}. Run: npm run start  (or npx local-lite-server start)`,
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
