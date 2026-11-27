import assert from 'node:assert/strict';
import test from 'node:test';
import { create, togglePin } from '../src/functions/notes.ts';

test('notes.create validates title and inserts row', async () => {
  const inserted: any[] = [];
  const fakeDb = {
    insert: async (table: string, data: Record<string, unknown>) => {
      const row = { id: 'n1', ...data };
      inserted.push({ table, row });
      return row;
    },
  };

  const args = create.args({ title: '  Hello  ', pinned: true });
  const res = await create.handler({ db: fakeDb } as any, args);
  assert.equal(res.title, 'Hello');
  assert.equal(inserted.length, 1);
});

test('notes.togglePin throws 404 when missing', async () => {
  const fakeDb = { get: async () => null };
  await assert.rejects(
    () => togglePin.handler({ db: fakeDb } as any, { id: 'missing' }),
    {
      status: 404,
    },
  );
});
