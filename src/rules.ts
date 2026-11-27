import { defineRules } from './db/rules.js';

/**
 * Default row-level security rules for synced tables (loaded automatically from `src/rules.ts`).
 * Presets: 'authenticated' | 'owner' | 'owner:<col>' | 'admin' | 'none'
 * Or pass a custom predicate: (ctx, row) => ctx.userId === row.owner_id
 */
export default defineRules({});
