# local-lite-server

Self-hostable **Local-First Sync & Command Engine** for **MySQL** and **PostgreSQL**, powered by [`local-lite`](https://github.com/georgechitechi/local-lite).  
Zero Docker, zero external brokers—just Node.js (`>= 24.0.0`) + your SQL database.

---

## Key Capabilities

- **Real SQL Tables (`schema.ts`):** Generates and applies MySQL or PostgreSQL DDL with advisory-locked migrations (`AUTO_MIGRATE=true` or `npm run migrate`).
- **Sync Lenses with RLS SQL Pushdown (`defineLens`):** Declarative, scoped table slices streamed over SSE (`GET /sync/lens/:name/events`) or multiplexed WebSocket (`WS /ws`), compiling `rules.ts` presets directly into SQL `WHERE` clauses.
- **Snapshot-First Bootstrap & Compaction:** Consistent `REPEATABLE READ` NDJSON/JSON snapshots (`GET /sync/snapshot/:name`) plus `compactChangeLog` with `resyncRequired` cursor floors.
- **Transactional Domain Commands (`commands/`):** `defineCommand` handlers with `Idempotency-Key` deduplication, optional `isolation: 'serializable'` OCC retries, and structured `CommandRejection` (`409`) responses for client outbox rollback.
- **Incremental SQL Projections (`defineProjection`):** Update summary/analytics tables inside the same command transaction so materialized views sync like normal tables.
- **Transactional Event Outbox (`_server_outbox` + `createOutboxWorker`):** Atomic `ctx.emit(topic, payload)` inside commands with background delivery, exponential backoff, and `dead_letter` handling.
- **Multiplexed WebSocket & Ephemeral Presence (`WS /ws`):** Zero-dependency RFC 6455 WebSocket multiplexing lens subscriptions, command calls, and in-memory presence/broadcast rooms.
- **Authentication & API Keys:** `/auth/signup`, `/auth/signin`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/google-token`, `/auth/github-token`, and scoped API keys.
- **DB-Native Multi-Instance Pub/Sub:** `MULTI_INSTANCE=true` uses compact Postgres `LISTEN/NOTIFY` or MySQL `_server_changes` tailing—no Redis required.

---

## Quick Start

### 1. Create a New Project
```bash
npx local-lite-server init my-backend
cd my-backend
npm install
```
Edit `.env` with your MySQL or PostgreSQL credentials, `SERVER_API_KEY`, and `APP_SECRET`, then start:
```bash
npm run start
```

### 2. Run From This Repo
```bash
npm install
cp .env.example .env
# Create an empty MySQL or Postgres database matching DB_NAME
npm run dev
```

---

## CLI Commands

| Command | Description |
|---|---|
| `init [dir] [--force]` | Scaffold a new backend project (`.env`, `src/schema.ts`, `src/rules.ts`, `src/commands/`) |
| `start` | Start the HTTP / SSE / WebSocket server |
| `migrate` | Apply core + `schema.ts` migrations (advisory-locked) |
| `migrate status` | Show core migration status and pending schema changes |
| `migrate diff` | Print SQL statements for pending schema changes |
| `codegen [--out file]` | Generate a typed client SDK (commands, lens pulls, snapshots, SSE) |
| `--version` / `-v` | Print installed package version |

---

## Endpoints

- `GET /health` — Database connectivity check
- `POST /auth/*`, `POST /auth/google-token`, `POST /auth/github-token` — User accounts & OAuth
- `GET / POST /sync`, `GET /sync/events` — Table-level delta sync & SSE
- `GET /sync/lens/:name`, `GET /sync/lens/:name/events` — Scoped Sync Lens delta pull & SSE
- `GET /sync/snapshot/:name` — Consistent NDJSON (or `?format=json`) lens snapshot
- `GET /cmd`, `POST /cmd/:module/:name` — List & execute transactional commands
- `WS /ws` — Multiplexed WebSocket (`subscribeLens`, `call`, `presence.join` / `presence.broadcast`, `ping`)
