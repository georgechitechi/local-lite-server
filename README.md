# local-lite-server

Self-hostable reactive sync, SQL schema, auth, and server functions backend powered by [`local-lite`](https://github.com/georgechitechi/local-lite).  
Runs on **MySQL** or **PostgreSQL**, deploys to **cPanel (Setup Node.js App / Passenger)** or any **VPS** with **no Docker**, and includes a built-in React **Admin Console** at `/admin`.

---

## Requirements

- **Node.js `>= 24.0.0`**
- **MySQL** (8.x+) or **PostgreSQL** (14+)

---

## Key Capabilities

- **Real SQL Tables from `schema.ts`:** Generates and applies MySQL or PostgreSQL DDL automatically on boot (`AUTO_MIGRATE=true`) or via CLI (`migrate`).
- **Slim Change Log & Delta Sync:** `_server_changes` records `(table_name, row_id, timestamp)` with `_server_sync_clock` for fast incremental `/sync` pulls and live SSE updates.
- **Row-Level Security (`rules.ts`):** Declarative per-table `read`, `write`, and `delete` rules (`authenticated`, `owner`, `owner:<column>`, `admin`, `none`, or custom predicates).
- **Server Functions (`functions/`):** Write `query`, `mutation` (transactional), and `action` handlers in TypeScript with live SSE subscriptions (`GET /subscribe/:module/:name`).
- **Custom HTTP Routes (`routes.ts`):** Mount custom Web `Request`/`Response` endpoints alongside sync and auth routes.
- **Authentication, OAuth & API Keys:** `/auth/signup`, `/auth/signin`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/google-token`, `/auth/github-token`, and scoped API keys.
- **Multi-Project Mode:** Host multiple isolated projects on one server and deploy updates remotely with `login`, `projects`, and `push`.
- **Admin Console (`/admin`):** Overview, Data Browser, Auth & Users, Server Functions runner & SSE subscriber, Crons, Backups, Storage, Sync Logs, Environment Variables, and Settings.
- **Zero-Framework HTTP:** Built directly on `node:http` + Web `Request`/`Response` (no Express or Fastify).

---

## Quick Start

### 1. Create a New Project (`npx`)

```bash
npx local-lite-server init my-backend
cd my-backend
npm install
```

Edit `.env` with your MySQL or PostgreSQL credentials, then start the server:

```bash
npm run start
# or: npx local-lite-server start
```

Open **http://localhost:3000/admin** and complete **First-Time Setup** using your `APP_SECRET` (or `SERVER_API_KEY`).

### 2. Typical Project Layout

```text
my-backend/
├── .env              # Database, auth, and server configuration
├── schema.ts         # Table definitions (export default defineSchema(...))
├── rules.ts          # Optional row-level security rules (defineRules(...))
├── routes.ts         # Optional custom HTTP endpoints
└── functions/        # Optional server functions (query / mutation / action)
    └── notes.ts
```

### 3. Contributing / Running From This Repo

1. **Install dependencies & build the Admin UI:**
   ```bash
   npm install
   cd admin && npm install && npm run build && cd ..
   ```
2. **Configure `.env`:**
   ```bash
   cp .env.example .env
   ```
   Set `DB_DIALECT` (`mysql` or `postgres`), `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SERVER_API_KEY`, and `APP_SECRET`.
3. **Create an empty database:**
   - MySQL: `CREATE DATABASE \`local-admin\` CHARACTER SET utf8mb4;`
   - PostgreSQL: `CREATE DATABASE "local-admin";`
4. **Start in dev mode (auto-rebuild + function hot-reload):**
   ```bash
   npm run dev
   ```

---

## CLI Reference

Run via `npx local-lite-server <command>` (or `local-lite-server` if installed globally):

| Command | Description |
|---|---|
| `init [dir] [--force]` | Scaffold a new backend project (`.env`, `schema.ts`, `rules.ts`, `functions/`, `package.json`) |
| `start` | Start the HTTP/SSE server (also runs `AUTO_MIGRATE` if enabled) |
| `migrate` | Apply core internal tables and `schema.ts` migrations |
| `migrate status` | Show core migration status and pending schema changes |
| `migrate diff` | Print SQL statements for pending schema changes |
| `codegen [--out file] [--project slug]` | Generate a typed TypeScript client SDK (default: `src/client.ts`) |
| `build:cpanel [--out dir]` | Build a self-contained ESM bundle in `dist/cpanel/` (`app.mjs`, `chunks/`, `schema.mjs`, `rules.mjs`, `routes.mjs`, `functions/*.mjs`, `admin/`) |
| `login [--signup]` | Authenticate the CLI with a remote `local-lite-server` instance |
| `logout` | Clear saved CLI session credentials |
| `projects <list\|create\|delete>` | Manage projects on a remote `local-lite-server` instance |
| `push --project <slug>` | Push `schema.ts`, `rules.ts`, `routes.ts`, and `functions/` to a remote project |
| `install-skills [--dir path] [--global]` | Install bundled agent skills into `.agents/skills` |
| `--version` / `-v` | Print installed package version |

---

## Programmatic Usage

You can embed `local-lite-server` directly in your own Node.js entry point:

```ts
import {
  createApp,
  createHttpServer,
  defineRules,
  defineSchema,
  loadSettings,
} from 'local-lite-server';
```

Main exports from [src/index.ts](./src/index.ts):
- **Schema & Rules:** `defineSchema`, `normalizeSchema`, `defineRules`
- **Functions:** `defineQuery`, `defineMutation`, `defineAction`, `FunctionError`
- **Server & Routes:** `createApp`, `createHttpServer`, `loadRoutesFile`, `resolveRoutesFile`, `loadSettings`
- **Storage & Errors:** `TableSyncStorage`, `ClientError`, `ForbiddenError`

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DB_DIALECT` | Yes | `mysql` | `mysql` or `postgres` |
| `DB_HOST` | Yes | — | Database host |
| `DB_PORT` | No | `3306` / `5432` | Database port |
| `DB_USER` | Yes | — | Database username |
| `DB_PASSWORD` | No | `""` | Database password |
| `DB_NAME` | Yes | — | Database name |
| `DB_SSL` | No | `false` | Enable TLS for Postgres (`rejectUnauthorized: false`) |
| `DB_POOL_SIZE` | No | `5` | Max database connection pool size |
| `SERVER_HOST` | No | `127.0.0.1` | Bind host (`0.0.0.0` for LAN / mobile testing) |
| `SERVER_PORT` / `PORT` | No | `3000` | HTTP port or Passenger socket path |
| `SERVER_API_KEY` | Yes | — | Master Bearer key for `/sync`, `/fn`, and `/admin` |
| `APP_SECRET` | No | — | Enables `/auth/*` user accounts and signs JWTs + admin cookies |
| `APP_NAME` | No | `local-lite-server` | Display name in emails and Admin Console |
| `AUTO_MIGRATE` | No | `true` | Apply core & `schema.ts` migrations on boot |
| `SCHEMA_PATH` | No | auto | Path to schema file (`schema.mjs`, `src/schema.ts`, `schema.ts`) |
| `RULES_PATH` | No | auto | Path to RLS rules (`rules.mjs`, `src/rules.ts`, `rules.ts`) |
| `ROUTES_PATH` | No | auto | Path to custom routes (`routes.mjs`, `src/routes.ts`, `routes.ts`) |
| `FUNCTIONS_DIR` | No | auto | Directory containing server function modules (`src/functions` or `functions`) |
| `UPLOAD_DIR` | No | `./uploads` | Directory for uploaded storage files (`.env.example` uses `./data/uploads`) |
| `BACKUP_DIR` | No | `./backups` | Directory for JSON backup snapshots (`.env.example` uses `./data/backups`) |
| `ENABLE_INTERNAL_CRONS` | No | `false` | Run `_lls_crons` schedules inside Node every 60s |
| `MULTI_INSTANCE` | No | `false` | Enable DB-backed rate limits & cross-instance sync notifications |
| `ADMIN_UI` | No | `true` | Set `false` to disable `/admin` routes |
| `ALLOW_CONSOLE_SIGNUP` | No | `false` | Allow self-signup for project-scoped admin accounts |
| `MAX_PROJECTS_PER_USER` | No | `20` | Max projects per console user when multi-project is enabled |
| `GOOGLE_CLIENT_SECRET` | No | — | OAuth secret for `POST /auth/google-token` |
| `GITHUB_CLIENT_SECRET` | No | — | OAuth secret for `POST /auth/github-token` |
| `CORS_ORIGINS` | No | `*` | Comma-separated allowed origins, or `*` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | No | — | SMTP settings for password-reset OTP emails |

---

## Documentation

- [HTTP & SSE API Reference](./docs/api.md) — `/sync`, `/fn`, `/subscribe`, `/auth`, `/storage`, and `/admin` endpoints
- [Schema & Migrations](./docs/schema-and-migrations.md) — `schema.ts`, supported types, `AUTO_MIGRATE`, and CLI commands
- [Server Functions & Reactive Queries](./docs/functions.md) — `query`, `mutation`, `action`, and SSE `/subscribe`
- [Client Usage & Auth](./docs/client-usage.md) — `SelfHostedRemoteAdapter`, `/auth/*`, and calling functions from apps
- [Deploying on cPanel (Namecheap, etc.)](./docs/cpanel.md) — `dist/cpanel/` ESM bundle (`app.mjs`) for Setup Node.js App
- [Deploying on a VPS (systemd / PM2 / Nginx)](./docs/vps.md) — production Linux deployment without Docker
- [Breaking Changes](./docs/BREAKING_CHANGES.md) — upgrade notes across versions

---

## Package Scripts (Repo Development)

| Script | Purpose |
|---|---|
| `npm run build` | Compile TypeScript (`tsc -p tsconfig.json`) into `dist/` |
| `npm run dev` | Watch & rebuild `src/` + restart server + hot-reload `functions/` |
| `npm run dev:admin` | Vite HMR dev server for `admin/` on `http://localhost:5173/admin/` |
| `npm run start` | Build `dist/` and run production server |
| `npm run migrate` | Apply core + `schema.ts` migrations (`status` / `diff` subcommands supported) |
| `npm run build:cpanel` | Build self-contained `dist/cpanel/` bundle for cPanel |
| `npm test` | Run Vitest suite |
