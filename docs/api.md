# HTTP & SSE API Reference

All JSON endpoints accept and return `application/json` (max body size: `6 MB`).

## Authentication

Endpoints use one of three credentials:
- **Admin API Key:** `Authorization: Bearer <SERVER_API_KEY>` (full access, bypasses RLS).
- **User JWT** *(when `APP_SECRET` is set)*: `Authorization: Bearer <jwt>` (or `?token=<jwt>` for `EventSource` SSE routes). Subject to `src/rules.ts` RLS on `/sync`.
- **Admin Session Cookie:** `lls_admin_session` (HTTP-only cookie set by `POST /admin/login`).

---

## Health

### `GET /health`
Public health check (no auth required).

**Response `200`:**
```json
{ "ok": true, "dialect": "mysql" }
```

---

## Sync

### `GET /sync?tables=notes&since=0&limit=500`
Pull delta changes after `since` (monotonic cursor). `limit` is clamped to `1..2000`.  
**Auth:** Admin key or User JWT.

**Response `200`:**
```json
{
  "success": true,
  "changes": {
    "timestamp": 1732541000123,
    "changes": [
      {
        "tableName": "notes",
        "rowId": "n1",
        "operation": "UPDATE",
        "payload": { "title": "Hello", "deleted": false, "updated_at": 1732541000123 },
        "timestamp": 1732541000123
      }
    ]
  },
  "cursor": 1732541000123,
  "hasMore": false,
  "serverTime": 1732541000500
}
```

### `POST /sync`
Push up to `1000` operations atomically.  
**Auth:** Admin key or User JWT.

**Body:**
```json
{
  "operations": [
    {
      "id": "op-1",
      "tableName": "notes",
      "rowId": "n1",
      "operation": "INSERT",
      "payload": { "title": "Hello", "pinned": true },
      "timestamp": 1732541000000
    }
  ]
}
```
`operation` is `"INSERT" | "UPDATE" | "DELETE"`.

**Response `200`:**
```json
{
  "success": true,
  "processed": 1,
  "applied": 1,
  "successfulIds": ["op-1"],
  "serverTime": 1732541000500,
  "cursor": 1732541000123
}
```

### `GET /sync/events?token=<key_or_jwt>&scopeId=<scope>`
Server-Sent Events (SSE) stream emitting change notifications whenever tables are modified.  
**Auth:** Admin key or User JWT (header or `?token=`).

---

## Server Functions

### `GET /fn`
List all loaded functions from `src/functions/` (or `functions/`).  
**Auth:** Admin key, User JWT, or Admin cookie.

**Response `200`:**
```json
{
  "functions": [
    { "name": "notes/list", "kind": "query" },
    { "name": "notes/create", "kind": "mutation" }
  ]
}
```

### `POST /fn/:module/:name`
Invoke a `query`, `mutation`, or `action`.  
**Auth:** Admin key, User JWT, or Admin cookie.

**Body:** `{ "args": { ... } }` (or pass args at the top level).  
**Response `200`:**
```json
{ "success": true, "result": ... }
```

### `GET /subscribe/:module/:name?args={}&token=<key_or_jwt>`
Reactive SSE stream for a `query` function. Sends an initial `event: data` frame, then re-runs and pushes updated `event: data` frames whenever any table read by the query changes.  
**Auth:** Admin key, User JWT, or Admin cookie (`?token=` supported for `EventSource`).

---

## User Authentication (`/auth/*`)

Requires `APP_SECRET` to be set (otherwise returns `503`). Rate-limited to **20 requests / minute per IP**.

- **`POST /auth/signup`**: `{ "mode": "signup", "email", "password", "displayName"? }` → `200 { token, user }`
- **`POST /auth/signin`**: `{ "mode": "signin", "email", "password" }` → `200 { token, user }`
- **`POST /auth/refresh`**: `Authorization: Bearer <token>` → `200 { token }`
- **`POST /auth/forgot-password`**: `{ "email" }` → `200 { ok: true }` (sends 6-digit OTP via SMTP)
- **`POST /auth/reset-password`**: `{ "email", "otp", "newPassword" }` → `200 { success: true }`

---

## File Storage (`/storage/*` & `/public/files/*`)

Backed by `UPLOAD_DIR`, `_lls_storage_buckets`, and `_lls_storage_files`.

- **`POST /storage/upload`**: `multipart/form-data` with `bucket` and `file` → `200 { key, bucket, visibility, remoteUrl }`
- **`GET /storage/files/:bucket/:key`**: Download file (requires auth or valid signed `?token=` for private buckets)
- **`GET /public/files/:bucket/:key`**: Direct read for `public` buckets (no auth required)
- **`POST /storage/sign`**: `{ "key", "bucket"?, "expiresInMs"? }` → `200 { url, expiresAt }`
- **`DELETE /storage/files/:bucket/:key`**: Delete file
- **`GET / POST / DELETE /storage/buckets`**: List, create (`{ "name", "visibility": "public" | "private" }`), or delete empty buckets

---

## Admin Console API (`/admin/*`)

Protected by Admin session cookie (`lls_admin_session`) or `Authorization: Bearer <SERVER_API_KEY>` (except `/admin/login` and static UI assets).

| Endpoint | Methods | Purpose |
|---|---|---|
| `/admin/login` | `GET`, `POST` | Check session/bootstrap status; sign in or bootstrap first `super_admin` |
| `/admin/logout` | `POST` | Clear session cookie (`?all=1` revokes all sessions) |
| `/admin/overview` | `GET` | Health, table counts, account/backup counts, console role |
| `/admin/endpoints` | `GET` | Registered HTTP & function routes |
| `/admin/table` | `GET`, `POST`, `PATCH`, `DELETE` | Paginated row browser & CRUD |
| `/admin/users` | `GET`, `POST` | List accounts; unlock, revoke sessions, or set console role |
| `/admin/logs` | `GET` | Paginated `_server_changes` log |
| `/admin/env` | `GET`, `POST`, `DELETE` | DB-backed environment variables (including `action: "reveal"`) |
| `/admin/backups` | `GET`, `POST`, `DELETE` | List, download (`?file=`), create, or delete JSON backups |
| `/admin/storage` | `GET`, `POST`, `DELETE` | Admin storage browser & bucket management |
| `/admin/crons` | `GET`, `POST`, `DELETE` | Manage schedules, run jobs (`{ job_key }`), or prune orphans |
| `/admin/settings` | `GET`, `POST` | Runtime info, `test_health`, `apply_schema`, `test_email` |

---

## Standard Error Codes

| Status | Meaning |
|---|---|
| `400` | Invalid JSON, unknown table/column, or validation error |
| `401` | Missing or invalid token / session |
| `403` | Rejected by `src/rules.ts` RLS policy or invalid bootstrap secret |
| `404` | Unknown function, bucket, or file |
| `413` | Request body exceeds `6 MB` |
| `429` | Rate limit exceeded (`Retry-After` header included) |
| `503` | Database unavailable or `/auth` disabled (`APP_SECRET` unset) |
