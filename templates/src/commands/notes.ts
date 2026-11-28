import { CommandRejection, defineCommand } from 'local-lite-server';

export const create = defineCommand<{ title: string; scope_id?: string }>({
  handler: async ({ db, emit }, args) => {
    const title = String(args.title ?? '').trim();
    if (!title) {
      throw new CommandRejection('TITLE_REQUIRED', 'Title cannot be empty.');
    }
    const row = await db.insert('notes', {
      title,
      scope_id: args.scope_id ?? 'default',
    });
    emit('note.created', { id: row.id, title: row.title });
    return row;
  },
});
