// Your synced tables. One real SQL table is created per entry.
// Types: 'string' | 'number' | 'boolean' | 'json' | 'string[]'  (add ' | null' for nullable).
// `id`, `deleted` and `updated_at` are managed for you.
// Edit this file and restart: with AUTO_MIGRATE=true new tables/columns are applied on boot.
export default {
  notes: {
    id: 'string',
    title: 'string',
    body: 'string | null',
    pinned: 'boolean',
    created_at: 'number',
  },
  actions: {
    id: 'string',
    title: 'string',
    body: 'string | null',
    pinned: 'boolean',
    created_at: 'number',
  },
};
