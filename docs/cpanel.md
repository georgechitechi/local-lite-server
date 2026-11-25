# Deploying on cPanel

No Docker, and no `npm install` on the server: `app.cjs` is a self-contained bundle.

## 1. Create the database
cPanel → **MySQL® Databases**
1. Create a database and a user, then add the user to the database with **ALL PRIVILEGES**.
2. Note the full names (cPanel prefixes them, e.g. `acct_mydb`, `acct_user`).

## 2. Upload
Upload everything in this folder to a directory **outside** `public_html`, e.g. `~/local-lite-server/`:
`app.cjs`, `schema.ts`, `.env.example`.

## 3. Create the Node.js app
cPanel → **Setup Node.js App** → **Create Application**
| Field | Value |
|---|---|
| Node.js version | **24** or newer |
| Application mode | Production |
| Application root | `local-lite-server` |
| Application URL | e.g. `api.yourdomain.com` |
| Application startup file | `app.cjs` |

## 4. Environment variables
Add these in the same screen (**Environment variables**):

| Name | Value |
|---|---|
| `DB_DIALECT` | `mysql` |
| `DB_HOST` | `localhost` |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | from step 1 |
| `SERVER_API_KEY` | long random string |
| `APP_SECRET` | another long random string (enables accounts) |
| `AUTO_MIGRATE` | `true` |
| `CORS_ORIGINS` | your app's origin(s), or `*` |

Optional: `SMTP_*` for password-reset emails, `ADMIN_UI=false` to hide `/admin`.
You can alternatively upload a `.env` file; do not put it in a web-served directory.

## 5. Your tables
Edit `schema.ts` (see the example), upload it, and **Restart** the app.
With `AUTO_MIGRATE=true`, new tables and columns are created on boot. Nothing is ever dropped.

## 6. Verify
- `https://api.yourdomain.com/health` → `{"ok":true,...}`
- `https://api.yourdomain.com/admin` → enter `SERVER_API_KEY` to see status and rows.

## Notes
- **Realtime:** `/sync/events` (SSE) works, but shared hosts may close idle connections. Clients should keep polling as a fallback.
- **Logs:** cPanel shows stderr in the app's log file (`stderr.log` in the app root).
- **Limits:** keep `DB_POOL_SIZE` small (default 5) on shared hosting.
- **Updating:** upload the new `app.cjs`, then Restart.

## Using it from a client
```ts
import { SelfHostedRemoteAdapter } from 'local-lite/self-hosted';
const remote = new SelfHostedRemoteAdapter({
  url: 'https://api.yourdomain.com/sync',
  token: userToken, // from POST /auth/signin, or SERVER_API_KEY for trusted servers
  tables: ['notes'],
});
```
Account endpoints (POST JSON): `/auth/signin` and `/auth/signup` (with `{ "mode": "signup", "email", "password" }`), `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`.
