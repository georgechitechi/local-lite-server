import { defineLens, defineLenses } from 'local-lite-server';

export default defineLenses({
  notesByScope: defineLens<{ scopeId?: string }>({
    table: 'notes',
    where: (_ctx: unknown, args: { scopeId?: string }) =>
      args.scopeId ? { scope_id: args.scopeId } : {},
  }),
});
