# Breaking Changes

## Multi-Tenant Central Server & Modular Revamp

1. **`X-Project-Id` Header Required on `/admin/*`**
   - `/admin/*` endpoints now read `X-Project-Id` exclusively and no longer accept the `?projectId=` query parameter fallback.

2. **Strict `admin` vs `super_admin` Isolation**
   - Console `admin` users (including self-registered accounts via `ALLOW_CONSOLE_SIGNUP=true`) are strictly scoped to projects they own (`owner_user_id === session.userId`).
   - `admin` users receive `403 Forbidden` on `Default` (root) server tables and on `super_admin`-only endpoints (`/admin/env`, `/admin/backups`, `/admin/crons`, `/admin/settings`, and `set_console_role`).

3. **Project-Scoped End-User Auth (`/p/:slug/auth/*`)**
   - `_local_auth_accounts` and `_local_auth_reset_otps` are now scoped by `project_id`, and migration `0005_drop_global_email_unique` drops the legacy single-column unique constraint on `email` so different projects can independently register the same user email.

4. **Project-Namespaced SSE Sync Events**
   - `SyncEventBroker` events are isolated per project via `scopeBroker()`. A write on Project A no longer wakes SSE subscribers on Project B or the root server.

5. **Permanent Purge on `DELETE /projects/:id`**
   - Deleting a project drops all physical `p_<shortId>_*` tables, removes project-scoped rows from `_local_auth_accounts`, `_local_auth_reset_otps`, `_lls_api_keys`, `_lls_storage_buckets`, `_lls_storage_files`, `_lls_env_vars`, `_lls_crons`, and `_server_changes`, and deletes `uploads/projects/<projectId>`.

6. **API Key `verifyKey()` Return Shape**
   - `verifyKey()` omits `projectId` on root (non-project) keys rather than returning `projectId: null`.

7. **Internal Module Reorganization**
   - HTTP routing and project runtime caching moved into `src/http/*`, `src/core/errors.ts`, and `src/core/sql.ts`. All public exports in `src/index.ts` remain preserved.
