import { badRequest, requireString } from '../lib/validators.ts';
import type { NoteRow } from '../types.ts';

export const list = {
  __kind: 'query' as const,
  handler: ({ db }: any): Promise<NoteRow[]> =>
    db.list('notes', { orderBy: 'updated_at', order: 'desc' }),
};

export const get = {
  __kind: 'query' as const,
  args: (raw: Record<string, unknown>) => ({ id: requireString(raw.id, 'id') }),
  handler: async ({ db }: any, { id }: { id: string }): Promise<NoteRow> => {
    const note = await db.get('notes', id);
    if (!note) throw badRequest('Note not found.', 404);
    return note;
  },
};

export const create = {
  __kind: 'mutation' as const,
  args: (raw: Record<string, unknown>) => ({
    title: requireString(raw.title, 'title'),
    body: typeof raw.body === 'string' ? raw.body : null,
    pinned: Boolean(raw.pinned),
  }),
  handler: (
    { db }: any,
    args: { title: string; body: string | null; pinned: boolean },
  ): Promise<NoteRow> => db.insert('notes', args),
};

export const togglePin = {
  __kind: 'mutation' as const,
  args: (raw: Record<string, unknown>) => ({ id: requireString(raw.id, 'id') }),
  handler: async ({ db }: any, { id }: { id: string }): Promise<NoteRow> => {
    const note = await db.get('notes', id);
    if (!note) throw badRequest('Note not found.', 404);
    return db.patch('notes', id, { pinned: !note.pinned });
  },
};

export const remove = {
  __kind: 'mutation' as const,
  args: (raw: Record<string, unknown>) => ({ id: requireString(raw.id, 'id') }),
  handler: ({ db }: any, { id }: { id: string }): Promise<boolean> => db.remove('notes', id),
};
