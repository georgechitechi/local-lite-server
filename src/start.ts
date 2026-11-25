import { loadSettings, type ServerSettings } from './config.js';
import { createDatabase, type Database } from './db.js';
import { runMigrations } from './migrations.js';
import { applySchema, loadSchemaFile, planSchema, resolveSchemaFile } from './schema.js';
import type { SchemaDictionary } from './schema.js';
import { loadFunctionsDir } from './functions.js';
import { createApp, createHttpServer } from './server.js';

function friendlyDbError(err: unknown, s: ServerSettings): unknown {
  const code = (err as { code?: string }).code;
  if (code === 'ER_BAD_DB_ERROR' || code === '3D000') {
    return new Error(
      `Database "${s.db.database}" does not exist. Create it first ` +
        (s.dialect === 'mysql'
          ? `(CREATE DATABASE \`${s.db.database}\` CHARACTER SET utf8mb4;)`
          : `(CREATE DATABASE "${s.db.database}";)`) +
        ', or on cPanel create it in "MySQL Databases" and grant your user access.',
    );
  }
  return err;
}

export async function loadSchema(s: ServerSettings): Promise<SchemaDictionary> {
  return loadSchemaFile(resolveSchemaFile(s.schemaPath));
}

/** Core + schema migrations. Returns a human-readable log. */
export async function migrate(
  s: ServerSettings,
  db: Database,
  schema: SchemaDictionary,
): Promise<void> {
  try {
    const core = await runMigrations(db.executor);
    if (core.applied.length) console.log('[local-lite-server] core migrations:', core.applied.join(', '));
    const plan = await applySchema(db.executor, schema);
    if (plan.up.length) console.log(`[local-lite-server] schema: applied ${plan.up.length} change(s)`);
    for (const w of plan.warnings) console.warn('[local-lite-server] schema warning:', w);
  } catch (err) {
    throw friendlyDbError(err, s);
  }
}

/** Shared boot used by the CLI and the cPanel entry point. */
export async function start() {
  const settings = loadSettings();
  const schema = await loadSchema(settings);
  const functions = await loadFunctionsDir(settings.functionsDir);
  const database = createDatabase(settings);

  try {
    if (settings.autoMigrate) {
      await migrate(settings, database, schema);
    } else {
      const plan = await planSchema(database.executor, schema).catch(() => null);
      if (!plan || plan.up.length) {
        console.warn('[local-lite-server] AUTO_MIGRATE=false and migrations are pending. Run: npm run migrate');
      }
    }
  } catch (err) {
    await database.close().catch(() => {});
    throw friendlyDbError(err, settings);
  }

  const server = createHttpServer(createApp(settings, database.executor, schema, functions));
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[local-lite-server] port ${settings.port} is already in use. Stop the other process or change SERVER_PORT in .env.`,
      );
    } else {
      console.error('[local-lite-server] server error:', err);
    }
    void database.close().finally(() => process.exit(1));
  });
  server.listen(settings.port, () => {
    const addr = typeof settings.port === 'number' ? `http://localhost:${settings.port}` : settings.port;
    console.log(
      `[local-lite-server] listening on ${addr} (${settings.dialect}); tables: ${Object.keys(schema).join(', ') || '(none)'}; functions: ${functions.size}`,
    );
    if (settings.adminUi && typeof settings.port === 'number') {
      console.log(`[local-lite-server] admin console: ${addr}/admin`);
    }
  });
  const shutdown = () => {
    server.close();
    void database.close().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}
