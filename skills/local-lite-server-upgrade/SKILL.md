---
name: local-lite-server-upgrade
description: Upgrade guide and breaking-changes checklist for migrating local-lite-server from 0.1.x single-server setups to the multi-project architecture. Use when upgrading an existing deployment, fixing breaking changes, or migrating an older database schema.
---

# `local-lite-server` Upgrade Guide

Use this checklist when upgrading from `0.1.x` single-server builds to the multi-project release.

## 1. Breaking Changes to Check First

1. **`X-Project-Id` Header Only on `/admin/*`**
   - Admin endpoints no longer accept `?projectId=` query-parameter fallbacks. Send `X-Project-Id: <projectId>` in request headers.
2. **Strict `admin` vs `super_admin` Isolation**
   - Console `admin` users (including self-signups via `ALLOW_CONSOLE_SIGNUP=true`) are scoped exclusively to projects they own (`owner_user_id === session.userId`).
   - `Default` (root) server resources, `/admin/settings`, and `set_console_role` return `403 Forbidden` for non-`super_admin` users.
3. **`verifyKey()` Return Shape**
   - `verifyKey()` omits `projectId` on root (non-project) API keys instead of returning `projectId: null`. Update any strict equality checks expecting `projectId: null`.
4. **Public Exports Only**
   - Internal files were reorganized into `src/db/`, `src/auth/`, `src/services/`, `src/core/`, `src/http/`, and `src/admin/handlers/`. Import from the package root (`local-lite-server`), not internal `dist/*` paths.
5. **Project Deletion Purges All Data**
   - `DELETE /projects/:id` drops all `p_<shortId>_*` tables and deletes project-scoped rows in `_local_auth_accounts`, `_local_auth_reset_otps`, `_lls_api_keys`, `_lls_storage_*`, `_lls_env_vars`, `_lls_backups`, `_lls_crons`, `_server_changes`, plus `uploads/projects/<id>`.

## 2. Database Upgrade Steps

- **Fresh Database (Recommended):** Run `npm run migrate` (or boot with `AUTO_MIGRATE=true`) to apply `20261127081945_core_schema`.
- **Existing Database:**
  1. Back up your database first.
  2. Boot with `AUTO_MIGRATE=true` or run `npx local-lite-server migrate` — `runMigrations()` automatically runs `ensureColumn(..., 'project_id', 'VARCHAR(64) NULL')` across all framework tables (`_server_changes`, `_local_auth_accounts`, `_local_auth_reset_otps`, `_lls_storage_buckets`, `_lls_storage_files`, `_lls_env_vars`, `_lls_backups`, `_lls_crons`, `_lls_api_keys`).
  3. If `_local_auth_accounts` still has a legacy single-column `UNIQUE` constraint on `email` and multiple projects need the same end-user email, drop that legacy unique index (`DROP INDEX email ON _local_auth_accounts` on MySQL, or `ALTER TABLE _local_auth_accounts DROP CONSTRAINT IF EXISTS _local_auth_accounts_email_key` on Postgres).

## 3. Environment & Client Updates

- Add `ALLOW_CONSOLE_SIGNUP=false` (or `true` for developer self-signup) and `MAX_PROJECTS_PER_USER=20` to `.env`.
- Rebuild the Admin UI if building from source: `npm --prefix admin run build`.
- Switch multi-tenant client apps to `/p/<slug>/sync`, `/p/<slug>/auth/*`, `/p/<slug>/storage/*`, and `/p/<slug>/fn/*` (or use project-scoped API keys on `/sync` and `/storage/*`).
