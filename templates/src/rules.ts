// Row-level security rules for synced tables (loaded automatically from src/rules.ts).
// Admin keys / console sessions bypass rules (`ctx.isAdmin === true`).
// Add `owner_id: 'string'` to any table in src/schema.ts to scope rows per user.

const canAccessRow = (
  ctx: { isAdmin: boolean; userId?: string },
  row: Record<string, any>,
) =>
  ctx.isAdmin ||
  (Boolean(ctx.userId) && (row.owner_id == null || row.owner_id === ctx.userId));

export default {
  notes: {
    read: canAccessRow,
    write: canAccessRow,
    delete: canAccessRow,
  },
};
