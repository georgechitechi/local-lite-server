---
name: local-lite-server-functions
description: Guide for writing server functions (defineQuery, defineMutation, defineAction), RLS rules (defineRules), and custom HTTP routes in local-lite-server, including project-scoped /p/<slug>/fn/* execution.
---

# `local-lite-server` Functions, Rules & Routes

## Server Functions (`functions/*.ts`)

Export named functions using `defineQuery`, `defineMutation`, or `defineAction`:

```ts
import { defineQuery, defineMutation, FunctionError } from 'local-lite-server';

export const listNotes = defineQuery({
  args: (raw) => ({ limit: Number(raw.limit ?? 20) }),
  handler: async ({ db, auth }, args) => {
    if (!auth.isAdmin && !auth.userId) throw new FunctionError('Unauthorized', 401);
    return db.list('notes', { limit: args.limit, orderBy: 'updated_at', order: 'desc' });
  },
});

export const createNote = defineMutation({
  handler: async ({ db, auth }, args: { title: string }) => {
    return db.insert('notes', { title: args.title, owner_id: auth.userId ?? 'admin' });
  },
});
```

- **Root server:** `POST /fn/<module>/<name>` and `GET /subscribe/<module>/<name>`
- **Project-scoped:** `POST /p/<slug>/fn/<module>/<name>` and `GET /p/<slug>/subscribe/<module>/<name>` — `db` automatically maps logical table names to `p_<shortId>_<table>` and publishes realtime events on the project's isolated SSE broker.

## Row-Level Security (`rules.ts`)

```ts
import { defineRules } from 'local-lite-server';

export default defineRules({
  notes: {
    read: 'owner',        // row.owner_id === ctx.userId || row.user_id === ctx.userId
    write: 'owner',
    delete: 'admin',
  },
});
```

Presets: `'authenticated'`, `'owner'`, `'owner:<column>'`, `'admin'`, `'none'`, or a custom predicate `(ctx, row) => boolean`.
Projects can also configure per-table rule presets directly in the Admin UI **Projects → Schema** drawer or via `POST /projects/:id/schema` (`{ schema, rules }`).

## Custom HTTP Routes (`routes.ts`)

Export a `CustomRoutesMap` or factory `(ctx) => CustomRoutesMap` from `routes.ts` (`ROUTES_PATH`) to mount custom endpoints alongside `/sync`, `/auth`, and `/projects`.
