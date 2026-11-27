import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRulesFile } from '../src/db/rules.js';
import { buildCpanelBundle } from '../src/services/cpanel.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('cPanel bundle & user module resolution', () => {
  it('bundles schema, rules, routes, and functions into self-contained .mjs files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lls-cpanel-'));
    tempDirs.push(dir);
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.symlinkSync(
      process.cwd(),
      path.join(dir, 'node_modules/local-lite-server'),
      'junction',
    );

    fs.writeFileSync(
      path.join(dir, 'schema.ts'),
      `import { defineSchema } from 'local-lite-server';\nexport default defineSchema({ items: { name: 'string' } });\n`,
    );
    fs.writeFileSync(
      path.join(dir, 'rules.ts'),
      `import { defineRules } from 'local-lite-server';\nexport default defineRules({ items: 'authenticated' });\n`,
    );
    fs.writeFileSync(
      path.join(dir, 'routes.ts'),
      `export default { '/ping': { GET: () => new Response('pong') } };\n`,
    );
    fs.mkdirSync(path.join(dir, 'functions'));
    fs.writeFileSync(
      path.join(dir, 'functions/_shared.ts'),
      `export const greeting = 'hello';\n`,
    );
    fs.writeFileSync(
      path.join(dir, 'functions/greet.ts'),
      `import { defineQuery } from 'local-lite-server';\nimport { greeting } from './_shared.js';\nexport const hello = defineQuery({ handler: () => ({ msg: greeting }) });\n`,
    );

    await buildCpanelBundle(dir, 'dist/cpanel');

    const out = path.join(dir, 'dist/cpanel');
    expect(fs.existsSync(path.join(out, 'app.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'schema.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'rules.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'routes.mjs'))).toBe(true);

    const bundledFn = path.join(out, 'functions/greet.mjs');
    expect(fs.existsSync(bundledFn)).toBe(true);
    expect(fs.existsSync(path.join(out, 'functions/_shared.ts'))).toBe(false);

    const fnCode = fs.readFileSync(bundledFn, 'utf8');
    expect(fnCode).not.toContain("from'local-lite-server'");
    expect(fnCode).not.toContain('from "local-lite-server"');
  });

  it('gives an actionable hint when loading unbundled rules.ts without node_modules', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lls-unbundled-'));
    tempDirs.push(dir);

    const rulesFile = path.join(dir, 'rules.ts');
    fs.writeFileSync(
      rulesFile,
      `import { defineRules } from 'local-lite-server';\nexport default defineRules({ items: 'authenticated' });\n`,
    );

    await expect(loadRulesFile(rulesFile)).rejects.toThrow(
      /build:cpanel|dist\/cpanel/i,
    );
  });
});
