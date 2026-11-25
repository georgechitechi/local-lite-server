export const list = {
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
