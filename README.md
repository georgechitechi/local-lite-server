# local-lite-server

Self-hostable, Convex-like sync & functions server powered by [`local-lite`](https://github.com/georgechitechi/local-lite).  
Runs on **MySQL** or **PostgreSQL**, deploys to **cPanel (Node.js App / Passenger)** or any VPS with **no Docker**, and includes a full React **Admin Console** at `/admin`.

---

## Features

- **Real SQL Tables from `schema.ts`:** Auto-generates MySQL/Postgres DDL on boot (`AUTO_MIGRATE=true`) or via CLI (`npm run migrate`).
- **Slim Change Log:** `_server_changes` stores only `(table_name, row_id, timestamp)` for fast delta sync and SSE notifications.
- **Convex-like Server Functions (`functions/`):** Define `query`, `mutation` (transactional), and `action` handlers. Invoke via `POST /fn/:module/:name` or subscribe to live updates via `GET /subscribe/:module/:name` (SSE).
- **Local Auth & Email OTP:** `/auth/signin`, `/auth/signup`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password` (enabled when `APP_SECRET` is set).
- **Full Admin Console (`/admin`):** Overview, Data Browser (with row editor drawer), Auth & Users, Server Functions runner + live SSE subscriber, Schedules, Backups, Storage, Sync Logs, Environment variables, and Settings.
- **Zero-Framework HTTP:** Built on `node:http` + Web `Request`/`Response` (no Express or Fastify overhead).

---

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   cd admin && npm install && npm run build && cd ..
   ```
2. **Configure `.env`:**
   ```bash
   cp .env.example .env
   # Set DB_DIALECT (mysql|postgres), DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, SERVER_API_KEY, APP_SECRET
   ```
3. **Create an empty database** (`CREATE DATABASE \`local-admin\` CHARACTER SET utf8mb4;` or Postgres `CREATE DATABASE ...`).
4. **Start the server:**
   ```bash
   npm run start
   ```
5. Open **http://localhost:3000/admin** and complete **First-Time Setup** using your `APP_SECRET` (or `SERVER_API_KEY`).

---

## Defining Tables (`schema.ts`)

```ts
export default {
  notes: {
    id: 'string',
    title: 'string',
    body: 'string | null',
    pinned: 'boolean',
    created_at: 'number',
  },
};
```
`id`, `deleted`, and `updated_at` are managed automatically.  
Run `npm run migrate -- diff` to preview pending SQL, or `npm run migrate` to apply manually.

---

## Writing Functions (`functions/`)

```ts
import type { MutationContext, QueryContext } from '../src/index.js';

export const list = {
  __kind: 'query' as const,
  handler: ({ db }: QueryContext) => db.list('notes', { orderBy: 'updated_at', order: 'desc' }),
};

export const create = {
  __kind: 'mutation' as const,
  handler: ({ db }: MutationContext, args: { title: string }) => db.insert('notes', args),
};
```

- Invoke: `POST /fn/notes/create` with `{ "args": { "title": "Hello" } }`
- Live Subscribe (SSE): `GET /subscribe/notes/list?token=<key_or_jwt>`

---

## Deploying to cPanel

```bash
npm run build:cpanel
```
This outputs a self-contained bundle in `dist/cpanel/` (`app.cjs`, `admin-ui/`, `schema.ts`, `functions/`, `.env.example`, `README-cpanel.md`).  
See [docs/cpanel.md](./docs/cpanel.md) for step-by-step Namecheap/cPanel instructions.
