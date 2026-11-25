import { loadSettings, type ServerSettings } from './config.js';
import { createDatabase, type Database } from './db.js';
import { runMigrations } from './migrations.js';
import { applySchema, loadSchemaFile, planSchema, resolveSchemaFile } from './schema.js';
import type { SchemaDictionary } from './schema.js';
import { loadRulesFile, resolveRulesFile, type RulesDictionary } from './rules.js';
import { loadRoutesFile, resolveRoutesFile } from './routes.js';
import { loadFunctionsDir, watchFunctionsDir } from './functions/index.js';
import { createClusterBroker } from './core/broker.js';
import { startCronScheduler } from './crons.js';
import { createApp, createHttpServer } from './server.js';

async function tryCreateDatabase(s: ServerSettings): Promise<boolean> {
  try {
    if (s.dialect === 'postgres') {
      const pg = (await import('pg')).default;
      const client = new pg.Client({
        host: s.db.host,
        port: s.db.port,
        user: s.db.user,
        password: s.db.password,
        database: 'postgres',
        ssl: s.db.ssl ? { rejectUnauthorized: false } : undefined,
      });
      await client.connect();
      try {
        await client.query(`CREATE DATABASE "${s.db.database.replace(/"/g, '')}"`);
      } finally {
        await client.end();
      }
      return true;
    }
    const mysql = (await import('mysql2/promise')).default;
    const conn = await mysql.createConnection({
      host: s.db.host,
      port: s.db.port,
      user: s.db.user,
      password: s.db.password,
    });
    try {
      await conn.query(
        `CREATE DATABASE IF NOT EXISTS \`${s.db.database.replace(/`/g, '')}\` CHARACTER SET utf8mb4`,
      );
    } finally {
      await conn.end();
    }
    return true;
  } catch {
    return false;
  }
}

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
  const applyAll = async () => {
    const core = await runMigrations(db.executor);
    if (core.applied.length) console.log('[local-lite-server] core migrations:', core.applied.join(', '));
    const plan = await applySchema(db.executor, schema);
    if (plan.up.length) console.log(`[local-lite-server] schema: applied ${plan.up.length} change(s)`);
    for (const w of plan.warnings) console.warn('[local-lite-server] schema warning:', w);
  };
  try {
    await applyAll();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if ((code === 'ER_BAD_DB_ERROR' || code === '3D000') && (await tryCreateDatabase(s))) {
      console.log(`[local-lite-server] created database "${s.db.database}"`);
      await applyAll();
      return;
    }
    throw friendlyDbError(err, s);
  }
}

/** Shared boot used by the CLI and the cPanel entry point. */
export async function start() {
  const settings = loadSettings();
  const schema = await loadSchema(settings);
  const rulesFile = resolveRulesFile(settings.rulesPath);
  const rules: RulesDictionary = rulesFile ? await loadRulesFile(rulesFile) : {};
  if (settings.appSecret && !rulesFile) {
    console.warn('[local-lite-server] APP_SECRET is set without src/rules.ts; authenticated users can sync all tables.');
  }
  const functions = await loadFunctionsDir(settings.functionsDir);
  const routesFile = resolveRoutesFile();
  const customRoutes = routesFile ? await loadRoutesFile(routesFile) : undefined;
  const database = await createDatabase(settings);

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

  const broker = await createClusterBroker(settings, database.executor);
  const app = createApp(settings, database.executor, schema, functions, rules, broker, customRoutes);
  const server = createHttpServer(app);
  const host = process.env.SERVER_HOST || '127.0.0.1';
  let activePort = settings.port;
  let attempts = 0;

  const listen = (onListening?: () => void) =>
    typeof activePort === 'number'
      ? server.listen(activePort, host, onListening)
      : server.listen(activePort, onListening);

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && typeof activePort === 'number' && !process.env.PORT && attempts < 20) {
      const nextPort = activePort + 1;
      console.warn(`[local-lite-server] port ${activePort} is in use, trying ${nextPort}...`);
      activePort = nextPort;
      attempts += 1;
      listen();
      return;
    }
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[local-lite-server] port ${activePort} is already in use. Stop the other process or change SERVER_PORT in .env.`,
      );
    } else {
      console.error('[local-lite-server] server error:', err);
    }
    void database.close().finally(() => process.exit(1));
  });
  listen(() => {
    const addr = typeof activePort === 'number' ? `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${activePort}` : activePort;
    console.log(`[local-lite-server] listening on ${addr} (${settings.dialect})`);
    if (settings.adminUi && typeof activePort === 'number') {
      console.log(`[local-lite-server] admin console: ${addr}/admin`);
    }
  });
  const stopWatch =
    process.env.NODE_ENV === 'production'
      ? () => {}
      : watchFunctionsDir(settings.functionsDir, functions);
  const stopCrons = startCronScheduler({
    settings,
    db: database.executor,
    fnRuntime: app.fnRuntime,
  });
  const shutdown = () => {
    stopWatch();
    stopCrons();
    server.close();
    void broker.close().finally(() => void database.close().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}
