# {{PKG_NAME}}

Self-hosted backend powered by `local-lite-server`.

## Structure

- `src/schema.ts` — SQL table definitions (auto-migrated on boot)
- `src/types.ts` — shared TypeScript interfaces
- `src/lib/` — reusable validators and server helpers
- `src/functions/` — `query`, `mutation`, and `action` endpoints
- `data/` — runtime uploads (`data/uploads/`) and JSON backups (`data/backups/`)
- `tests/` — unit tests (run with Node's built-in test runner)
- `.env` — database, auth, and server configuration (ignored by git)

## Commands

```bash
npm run start           # Start server & open /admin
npm run test            # Run unit tests
npm run migrate         # Apply pending schema migrations
npm run migrate:diff    # Preview pending SQL changes
npm run migrate:status  # Check migration status
```
