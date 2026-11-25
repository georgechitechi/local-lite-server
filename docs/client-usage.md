# Client Usage & Authentication

## 1. Local-First Sync (`local-lite/self-hosted`)

Point `SelfHostedRemoteAdapter` at your server's `/sync` endpoint:

```ts
import { LocalFirstClient } from 'local-lite/core';
import { SelfHostedRemoteAdapter } from 'local-lite/self-hosted';

const remote = new SelfHostedRemoteAdapter({
  url: 'https://api.yourdomain.com/sync',
  token: userJwtOrApiKey,
  tables: ['notes'],
  pollIntervalMs: 5000,
});

const client = new LocalFirstClient({
  local: mySqliteAdapter,
  remote,
});

await client.initialize();
client.syncWorker.start();
```

### Realtime Sync Events (SSE)

Listen for change notifications on `/sync/events`:

```ts
const es = new EventSource(
  `https://api.yourdomain.com/sync/events?token=${encodeURIComponent(token)}`
);
es.onmessage = () => {
  void client.syncWorker.pullRemoteChanges();
};
```

## 2. User Accounts (`/auth/*`)

Set `APP_SECRET` in `.env` to enable user accounts (rate-limited to 20 requests/min per IP):

- **Sign Up:**
  ```http
  POST /auth/signup
  Content-Type: application/json

  { "mode": "signup", "email": "user@example.com", "password": "strongpassword", "displayName": "Alex" }
  ```
  Returns `{ token, user }`.
- **Sign In:**
  ```http
  POST /auth/signin
  Content-Type: application/json

  { "mode": "signin", "email": "user@example.com", "password": "strongpassword" }
  ```
- **Refresh Token:** `POST /auth/refresh` with `Authorization: Bearer <token>`
- **Password Reset (6-digit Email OTP, requires `SMTP_*`):**
  1. `POST /auth/forgot-password` with `{ "email": "user@example.com" }`
  2. `POST /auth/reset-password` with `{ "email": "user@example.com", "otp": "123456", "newPassword": "newpassword" }`

## 3. Typed Client SDK (`codegen`)

Generate a zero-dependency TypeScript client from your `schema.ts` and `functions/` directly into your frontend or mobile app:

```bash
npx local-lite-server codegen --out ../my-frontend/src/api.ts
```

Then import and use `createClient`:

```ts
import { createClient, type NotesRow } from './api';

const api = createClient({
  url: 'https://api.yourdomain.com',
  getToken: () => localStorage.getItem('token'),
});

// Query & mutation
const notes = await api.notes.list<NotesRow[]>();
await api.notes.create({ title: 'My Note', pinned: true });

// Live SSE subscription
const unsubscribe = api.notes.subscribeList<NotesRow[]>({}, (liveNotes) => {
  console.log('Notes updated:', liveNotes);
});
```

Or call `/fn/:module/:name` directly with `fetch`:

```ts
const res = await fetch('https://api.yourdomain.com/fn/notes/create', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ args: { title: 'My Note', pinned: true } }),
});
const { result } = await res.json();
```
