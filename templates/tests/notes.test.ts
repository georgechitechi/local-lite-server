import assert from 'node:assert/strict';
import test from 'node:test';
import { create } from '../src/commands/notes.ts';

test('notes.create inserts a row and emits note.created', async () => {
  const inserted: any[] = [];
  const emitted: any[] = [];
  const fakeDb = {
    insert: async (table: string, data: Record<string, unknown>) => {
      const row = { id: 'n1', ...data };
      inserted.push({ table, row });
      return row;
    },
  };

  const res = await create.handler(
    {
      db: fakeDb as any,
      auth: { isAdmin: true },
      emit: (topic: string, payload: unknown) => emitted.push({ topic, payload }),
    },
    { title: '  Hello  ' },
  );
  assert.equal(res.title, 'Hello');
  assert.equal(inserted.length, 1);
  assert.equal(emitted[0]?.topic, 'note.created');
});
