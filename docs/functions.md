# Server Functions & Reactive Queries

Place TypeScript or JavaScript modules in `functions/` (or set `FUNCTIONS_DIR`). Each exported function with `__kind: 'query' | 'mutation' | 'action'` is automatically registered as `<filename>/<exportName>`.

## Writing Functions

Using `import type` keeps functions compatible with both local development and the zero-`node_modules` cPanel bundle:

```ts
// functions/notes.ts
import type { ActionContext, MutationContext, QueryContext } from '../src/index.js';

function badRequest(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

export const list = {
  __kind: 'query' as const,
  handler: ({ db }: QueryContext) =>
    db.list('notes', {
      where: { pinned: true },
      orderBy: 'updated_at',
      order: 'desc',
      limit: 50,
    }),
};

export const create = {
  __kind: 'mutation' as const,
  args: (raw: Record<string, unknown>) => {
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title) throw badRequest('title is required.');
    return { title, body: typeof raw.body === 'string' ? raw.body : null, pinned: false };
  },
  handler: ({ db }: MutationContext, args: { title: string; body: string | null; pinned: boolean }) =>
    db.insert('notes', args),
};

export const summary = {
  __kind: 'action' as const,
  handler: async (ctx: ActionContext) => {
    const notes = await ctx.runQuery<any[]>('notes/list');
    return { count: notes.length };
  },
};
```

> **Note:** In `npm run dev`, edits to `functions/` hot-reload in place without dropping open SSE connections.

## Context API

- **`ctx.auth`**: `{ isAdmin: boolean; userId?: string }`
- **`ctx.db.get(table, id)`**: Fetch a single non-deleted row (tracks `table` for reactive subscriptions).
- **`ctx.db.list(table, { where?, orderBy?, order?, limit?, offset?, includeDeleted? })`**: Query rows (tracks `table`).
- **`ctx.db.sql(query, params?, touchesTables?)`**: Raw SQL escape hatch.
- **`ctx.db.insert(table, data)`** *(mutations only)*: Inserts row inside a transaction, updates `_server_sync_clock` & `_server_changes`, and notifies subscribers.
- **`ctx.db.patch(table, id, patch)`** *(mutations only)*: Updates fields inside a transaction and emits change events.
- **`ctx.db.remove(table, id)`** *(mutations only)*: Soft-deletes (`deleted = true/1`) inside a transaction and emits change events.

## HTTP & SSE Endpoints

All `/fn` and `/subscribe` endpoints accept `Authorization: Bearer <SERVER_API_KEY_or_user_JWT>` (or `?token=` for `EventSource`), plus Admin Console cookies.

- **List functions:** `GET /fn`
- **Invoke function:** `POST /fn/:module/:name` with body `{ "args": { ... } }`
- **Reactive query subscription (SSE):**
  ```js
  const es = new EventSource(
    'https://api.yourdomain.com/subscribe/notes/list?token=' + encodeURIComponent(token) + '&args=' + encodeURIComponent('{}')
  );
  es.addEventListener('data', (ev) => {
    const rows = JSON.parse(ev.data);
    console.log('Live update:', rows);
  });
  ```
  Whenever any mutation or `/sync` operation modifies a table that the query read, the server re-runs the query and pushes a new `event: data` frame if the JSON output changed.

> **Caveat:** Unlike Convex's deterministic V8 isolate, reactive invalidation here is **table-level** and backed by standard SQL transactions.
