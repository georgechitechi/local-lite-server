import type { MutationContext, QueryContext } from '../src/index.js';

function badRequest(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

export const list = {
  __kind: 'query' as const,
  handler: ({ db }: QueryContext) => db.list('notes', { orderBy: 'updated_at', order: 'desc' }),
};

export const create = {
  __kind: 'mutation' as const,
  args: (raw: Record<string, unknown>) => {
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title) throw badRequest('title is required.');
    return {
      title,
      body: typeof raw.body === 'string' ? raw.body : null,
      pinned: Boolean(raw.pinned),
    };
  },
  handler: ({ db }: MutationContext, args: { title: string; body: string | null; pinned: boolean }) =>
    db.insert('notes', args),
};

export const togglePin = {
  __kind: 'mutation' as const,
  args: (raw: Record<string, unknown>) => {
    if (typeof raw.id !== 'string' || !raw.id) throw badRequest('id is required.');
    return { id: raw.id };
  },
  handler: async ({ db }: MutationContext, { id }: { id: string }) => {
    const note = await db.get('notes', id);
    if (!note) throw badRequest('Note not found.', 404);
    return db.patch('notes', id, { pinned: !note.pinned });
  },
};
