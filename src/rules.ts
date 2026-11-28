import { defineRules } from './db/rules.js';

/**
 * Default row-level security rules for synced tables (loaded automatically from `src/rules.ts`).
 * `*` applies to any table without an explicit per-table rule (owner-only by default).
 * Presets: 'authenticated' | 'owner' | 'owner:<col>' | 'admin' | 'none'
 */
export default defineRules({
  '*': {
    read: 'owner',
    write: 'owner',
    delete: 'owner',
  },
});
