# Schema & Migrations

`local-lite-server` stores each synced table as a **real SQL table** in MySQL or PostgreSQL, generated from your `schema.ts` file.

## Defining `schema.ts`

Place `schema.ts` (or `.mjs`, `.js`, `.json`, or set `SCHEMA_PATH`) in your project root:

```ts
export default {
  notes: {
    id: 'string',
    title: 'string',
    body: 'string | null',
    pinned: 'boolean',
    tags: 'string[] | null',
    meta: 'json | null',
    created_at: 'number',
  },
};
```

### Supported Field Types

| Type | MySQL | PostgreSQL |
|---|---|---|
| `'string'` / `'string \| null'` | `VARCHAR(255)` or `TEXT`/`LONGTEXT` | `TEXT` |
| `'number'` / `'number \| null'` | `DOUBLE` / `BIGINT` (timestamps) | `DOUBLE PRECISION` / `BIGINT` |
| `'boolean'` / `'boolean \| null'` | `TINYINT(1)` | `BOOLEAN` |
| `'json'` / `'json \| null'` | `LONGTEXT` (JSON) | `JSONB` |
| `'string[]'` / `'string[] \| null'` | `LONGTEXT` (JSON) | `JSONB` |

Every table automatically includes:
- `id` (`VARCHAR(128) PRIMARY KEY`)
- `deleted` (`TINYINT(1)` / `BOOLEAN`, soft-delete flag)
- `updated_at` (`BIGINT`, monotonic server cursor)

## How `_server_changes` Works

Unlike schemaless JSON stores, `_server_changes` only records `(id, table_name, row_id, timestamp)` with **no payload**.  
When a client calls `GET /sync?tables=notes&since=1234`, the server:
1. Reads matching `(table_name, row_id)` pairs from `_server_changes` after `since`.
2. Fetches the latest row state directly from the real SQL table (`notes`).
3. Returns `UPDATE` (with typed payload) or `DELETE` (if `deleted = 1/true`).

## Applying Migrations

- **Automatic (default, recommended for cPanel):** Set `AUTO_MIGRATE=true`. On boot, the server diffs `schema.ts` against `_lls_schema_state` and runs `CREATE TABLE` / `ALTER TABLE ADD COLUMN` / `CREATE INDEX`. Existing columns and tables are **never dropped** automatically.
- **Manual:** Set `AUTO_MIGRATE=false` and run:
  ```bash
  npm run migrate -- status   # Check pending changes
  npm run migrate -- diff     # Preview SQL statements
  npm run migrate             # Apply migrations
  ```
