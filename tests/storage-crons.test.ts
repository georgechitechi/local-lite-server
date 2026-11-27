import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSettings } from '../src/config.js';
import { matchesCron, runCronAction } from '../src/services/crons.js';
import { normalizeSchema } from '../src/db/schema.js';
import { createApp } from '../src/server.js';

describe('Cron matcher & actions', () => {
  it('matches 5-field cron expressions with timezone', () => {
    const d = new Date('2026-11-25T15:30:00Z');
    expect(matchesCron('30 15 * * *', d, 'UTC')).toBe(true);
    expect(matchesCron('*/15 * * * *', d, 'UTC')).toBe(true);
    expect(matchesCron('0 12 * * *', d, 'UTC')).toBe(false);
  });

  it('executes trim_old_logs and storage_orphan_prune', async () => {
    const executed: string[] = [];
    const db: any = {
      dialect: 'mysql',
      query: async () => [{ id: 'f1', storage_key: 'avatars/missing.png' }],
      execute: async (sql: string) => {
        executed.push(sql);
        return { affectedRows: 3 };
      },
    };
    const settings = loadSettings({
      DB_DIALECT: 'mysql',
      DB_HOST: 'h',
      DB_USER: 'u',
      DB_NAME: 'n',
      SERVER_API_KEY: 'secret',
      UPLOAD_DIR: os.tmpdir(),
    });
    const trim = await runCronAction(
      'trim_old_logs',
      JSON.stringify({ keepDays: 7 }),
      { settings, db },
    );
    expect(trim).toContain('3 log row');

    const prune = await runCronAction('storage_orphan_prune', null, {
      settings,
      db,
    });
    expect(prune).toContain('1 missing file');
    expect(
      executed.some((s) => s.includes('DELETE FROM _lls_storage_files')),
    ).toBe(true);
  });
});

describe('Storage endpoint (/storage/*)', () => {
  it('uploads to a bucket and serves the file back', async () => {
    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lls-storage-'));
    const buckets = new Map<string, any>([
      ['docs', { name: 'docs', visibility: 'public', created_at: 1 }],
    ]);
    const files = new Map<string, any>();
    const db: any = {
      dialect: 'mysql',
      query: async (sql: string, p: any[] = []) => {
        if (sql.includes('FROM _lls_storage_buckets WHERE name')) {
          const b = buckets.get(p[0]);
          return b ? [b] : [];
        }
        if (sql.includes('FROM _lls_storage_files WHERE storage_key')) {
          const f = files.get(p[0]);
          return f ? [f] : [];
        }
        return [];
      },
      execute: async (sql: string, p: any[] = []) => {
        if (sql.includes('_lls_storage_files')) {
          files.set(p[1], {
            id: p[0],
            storage_key: p[1],
            bucket: p[2],
            name: p[3],
            mime_type: p[4],
            size_bytes: p[5],
            created_at: p[6],
          });
        }
        return { affectedRows: 1 };
      },
    };

    const settings = loadSettings({
      DB_DIALECT: 'mysql',
      DB_HOST: 'h',
      DB_USER: 'u',
      DB_NAME: 'n',
      SERVER_API_KEY: 'secret',
      UPLOAD_DIR: uploadDir,
    });
    const app = createApp(
      settings,
      db,
      normalizeSchema({ notes: { title: 'string' } }),
    );
    const form = new FormData();
    form.append('bucket', 'docs');
    form.append(
      'file',
      new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
        type: 'image/png',
      }),
      'test.png',
    );

    const up = await app.fetch(
      new Request('http://x/storage/upload', {
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
        body: form,
      }),
    );
    expect(up.status).toBe(200);
    const { key, remoteUrl } = (await up.json()) as {
      key: string;
      remoteUrl: string;
    };
    expect(key).toBeTruthy();

    const dl = await app.fetch(new Request(`http://x${remoteUrl}`));
    expect(dl.status).toBe(200);
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });
});
