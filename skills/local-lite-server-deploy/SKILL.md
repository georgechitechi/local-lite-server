---
name: local-lite-server-deploy
description: Production deployment guide for local-lite-server on VPS or cPanel/Passenger (no Docker), covering environment variables, TLS, multi-instance pub/sub, crons, and backups.
---

# `local-lite-server` Production Deployment

## 1. Required `.env` Settings

- `DB_DIALECT`: `mysql` or `postgres`
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_POOL_SIZE`
- `SERVER_API_KEY`: long random secret (`openssl rand -hex 32`)
- `APP_SECRET`: long random secret for signing user JWTs & admin session cookies
- `CORS_ORIGINS`: explicit comma-separated origins (avoid `*` in production)
- `ALLOW_CONSOLE_SIGNUP`: `true` if developers can self-register project accounts, `false` otherwise
- `MAX_PROJECTS_PER_USER`: cap projects per developer (default `20`)

## 2. Reverse Proxy & TLS

Run Node behind Nginx, Caddy, Cloudflare, or cPanel Passenger with HTTPS enabled (`X-Forwarded-Proto: https`) so `lls_admin_session` cookies receive `; Secure` and bearer tokens are encrypted in transit.

## 3. cPanel / Shared Hosting Bundle

```bash
npx local-lite-server build:cpanel --out dist/cpanel
```

Upload `dist/cpanel` as a cPanel Node.js Application (Node `>= 24.0.0`) with `AUTO_MIGRATE=true`.

## 4. Multi-Instance & Background Crons

- `ENABLE_INTERNAL_CRONS=true`: runs scheduled jobs from `_lls_crons` inside the server process.
- `MULTI_INSTANCE=true`: enables cluster sync pub/sub (Postgres `LISTEN/NOTIFY` on `lls_sync_events`, or MySQL `_server_changes` polling) and DB-backed rate limiting.
