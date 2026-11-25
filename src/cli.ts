#!/usr/bin/env node
import { loadSettings } from './config.js';
import { createDatabase } from './db.js';
import { coreMigrationStatus } from './migrations.js';
import { planSchema } from './schema.js';
import { loadSchema, migrate, start } from './start.js';

const cmd = process.argv[2] ?? 'start';
const sub = process.argv[3];

if (cmd === 'start') {
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
} else {
  console.log('Usage: local-lite-server <start | migrate [status|diff]>');
  process.exit(1);
}
