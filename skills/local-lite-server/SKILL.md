---
name: local-lite-server
description: Self-hostable multi-project sync, auth, storage, and serverless functions backend for MySQL or Postgres (similar to Convex/Supabase, no Docker). Use when scaffolding a local-lite-server instance, creating or pushing remote projects via CLI, defining schemas/RLS rules, or connecting client apps to /p/<slug>/* endpoints.
---

# `local-lite-server`

Self-hostable multi-project backend for **MySQL** or **Postgres** with offline-first delta sync, end-user auth, file storage, server functions, schedules, and an Admin UI (`/admin`).

## Quick Start (Central Server)

```bash
npx local-lite-server init my-server
cd my-server
# Edit .env with DB_DIALECT (mysql|postgres), DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, SERVER_API_KEY, APP_SECRET
npm run start
```

Set `ALLOW_CONSOLE_SIGNUP=true` in `.env` to let developers self-register console `admin` accounts at `/admin` or via `local-lite-server login --signup`.

## Developer Workflow (Multi-Project CLI)

```bash
# 1. Authenticate in browser and return to CLI (or pass --email / --password)
npx local-lite-server login

# 2. List, create, or delete projects
npx local-lite-server projects list
npx local-lite-server projects create "My App" --slug my-app --schema schema.ts
npx local-lite-server projects delete my-app

# 3. Push local schema.ts & rules.ts to a remote project
npx local-lite-server push --project my-app --schema schema.ts --rules rules.ts

# 4. Generate typed TypeScript client SDK from a remote project
npx local-lite-server codegen --project my-app --out src/client.ts
```

## Schema & Rules (`schema.ts` / `rules.ts`)

Valid field types in `defineSchema({ ... })`:
- `string`, `string | null`
- `number`, `number | null`
- `boolean`, `boolean | null`
- `json`, `json | null`
- `string[]`, `string[] | null`

Every table automatically gets `id`, `updated_at`, and `deleted` columns. Project tables are physically isolated as `p_<shortId>_<table>`.

Valid rule presets in `defineRules({ ... })`:
- `'authenticated'` — any signed-in user or admin
- `'owner'` — `row.owner_id === ctx.userId` (or `row.user_id`)
- `'owner:<col>'` — custom owner column
- `'admin'` — admin / API key only
- `'none'` — deny all client reads/writes

## Project-Scoped HTTP Endpoints

When a project exists with slug `<slug>` (or when authenticating with a project-scoped API key on root `/sync` & `/storage`):

- **Sync:** `GET /p/<slug>/sync?tables=...&since=...`, `POST /p/<slug>/sync`, `GET /p/<slug>/sync/events` (SSE)
- **End-User Auth:** `POST /p/<slug>/auth/*` (isolated per project)
- **Storage:** `/p/<slug>/storage/*`, `GET /p/<slug>/public/files/*`
- **Functions:** `POST /p/<slug>/fn/<module>/<name>`, `GET /p/<slug>/subscribe/<module>/<name>` (SSE)
- **Management:** `GET/POST /projects`, `POST /projects/:id/schema`, `GET /projects/:id/export`, `DELETE /projects/:id`

## Role Model

- **`super_admin`**: Full access to `Default` (root) server, all projects, `/admin/settings`, and `set_console_role`.
- **`admin`**: Full access (`Data`, `Auth & Users`, `API Keys`, `Functions`, `Schedules`, `Backups`, `Storage`, `Sync Logs`, `Environment`) strictly scoped to projects where `owner_user_id === session.userId`.
