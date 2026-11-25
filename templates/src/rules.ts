// Row-level security rules for synced tables (loaded automatically from src/rules.ts).
// Presets: 'authenticated' | 'owner' | 'owner:<col>' | 'admin' | 'none'
// Or pass a custom function: (ctx, row) => ctx.userId === row.owner_id
// Shorthand: `notes: 'owner'` applies the same preset to read, write, and delete.

export default {
  notes: {
    read: 'authenticated',
    write: 'authenticated',
    delete: 'authenticated',
  },
};
