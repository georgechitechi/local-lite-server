# local-lite-server

Self-hostable reactive sync & server functions backend powered by [`local-lite`](https://github.com/georgechitechi/local-lite).  
Runs on **MySQL** or **PostgreSQL**, deploys to **cPanel (Node.js App / Passenger)** or any **VPS** with **no Docker**, and includes a built-in React **Admin Console** at `/admin`.

---

## Key Capabilities

- **Real SQL Tables from `schema.ts`:** Generates and applies MySQL or PostgreSQL DDL automatically on boot (`AUTO_MIGRATE=true`) or via CLI.
- **Slim Change Log:** `_server_changes` stores only `(table_name, row_id, timestamp)` for fast delta sync and live SSE invalidation.
- **Server Functions (`functions/`):** Write `query`, `mutation` (transactional), and `action` handlers in TypeScript with live SSE subscriptions (`GET /subscribe/:module/:name`).
- **Authentication & Email OTP:** `/auth/signin`, `/auth/signup`, `/auth/refresh`, `/auth/forgot-password`, and `/auth/reset-password` backed by SQL + SMTP.
- **Admin Console (`/admin`):** Overview, Data Browser (row editor drawer), Auth & Users, Server Functions runner & live SSE subscriber, Schedules, Backups, Storage, Sync Logs, Environment variables, and Settings.
- **Zero-Framework HTTP:** Built on `node:http` + Web `Request`/`Response` (no Express or Fastify).

---

## Quick Start

### On a Fresh PC (`npx`)

```bash
npx local-lite-server init my-backend   # or run `npx local-lite-server init` inside an existing folder
cd my-backend
# Edit .env with your MySQL or Postgres database credentials, then:
npx local-lite-server start
```

### From This Repo (Development)

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
   - Postgres: `CREATE DATABASE "local-admin";`
4. **Start in dev mode (auto-rebuild + function hot-reload):**
   ```bash
   npm run dev
   ```
5. Open **http://localhost:3000/admin** and complete **First-Time Setup** using your `APP_SECRET` (or `SERVER_API_KEY`).

---

## Documentation

- [HTTP & SSE API Reference](./docs/api.md) — `/sync`, `/fn`, `/subscribe`, `/auth`, `/storage`, and `/admin` endpoints
- [Schema & Migrations](./docs/schema-and-migrations.md) — `schema.ts`, supported types, `AUTO_MIGRATE`, and CLI commands
- [Server Functions & Reactive Queries](./docs/functions.md) — `query`, `mutation`, `action`, and SSE `/subscribe`
- [Client Usage & Auth](./docs/client-usage.md) — `SelfHostedRemoteAdapter`, `/auth/*`, and calling functions from apps
- [Deploying on cPanel (Namecheap, etc.)](./docs/cpanel.md) — single-file `app.cjs` bundle for Setup Node.js App
- [Deploying on a VPS (systemd / PM2 / Nginx)](./docs/vps.md) — production Linux deployment without Docker

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
| `DB_POOL_SIZE` | No | `5` | Max connection pool size |
| `SERVER_PORT` / `PORT` | No | `3000` | HTTP port or Passenger socket path |
| `SERVER_API_KEY` | Yes | — | Master Bearer key for `/sync`, `/fn`, and `/admin` |
| `APP_SECRET` | No | — | Enables `/auth/*` user accounts and signs JWTs + admin cookies |
| `APP_NAME` | No | `local-lite-server` | Display name in emails and admin console |
| `AUTO_MIGRATE` | No | `true` | Apply core & `schema.ts` migrations on boot |
| `SCHEMA_PATH` | No | `./schema.ts` | Path to schema file (`.ts`, `.mjs`, `.js`, or `.json`) |
| `FUNCTIONS_DIR` | No | `./functions` | Directory containing server function modules |
| `UPLOAD_DIR` | No | `./uploads` | Directory for Admin Storage files |
| `ADMIN_UI` | No | `true` | Set `false` to disable `/admin` routes |
| `CORS_ORIGINS` | No | `*` | Comma-separated allowed origins, or `*` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | No | — | SMTP settings for password-reset OTP emails |

---

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Watch & rebuild `src/` + restart server + hot-reload `functions/` |
| `npm run dev:admin` | Vite HMR dev server for `admin/` on `http://localhost:5173/admin/` |
| `npm run start` | Build `dist/` and run production server |
| `npm run migrate` | Apply core + `schema.ts` migrations (`status` / `diff` subcommands supported) |
| `npm run build:cpanel` | Build self-contained `dist/cpanel/` bundle for cPanel |
| `npm test` | Run Vitest suite |
