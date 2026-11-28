# {{PKG_NAME}}

Local-first sync & command backend powered by `local-lite-server`.

## Structure

- `src/schema.ts` — SQL table definitions (auto-migrated on boot)
- `src/rules.ts` — Declarative row-level security rules
- `src/commands/` — Transactional domain commands (`defineCommand`)
- `src/types.ts` — Shared TypeScript interfaces
- `src/lib/` — Reusable validators and helpers
- `tests/` — Unit tests (`node --test`)
- `.env` — Database, auth, and server configuration (ignored by git)

## Commands

```bash
npm run start           # Start HTTP + SSE + /ws server
npm run test            # Run unit tests
npm run migrate         # Apply pending schema migrations
npm run migrate:diff    # Preview pending SQL changes
npm run migrate:status  # Check migration status
npm run codegen         # Generate typed client SDK
```
