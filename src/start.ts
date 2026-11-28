import { loadSettings, type ServerSettings } from './config.js';
import { createDatabase, pgClientConfig, type Database } from './db/client.js';
import { runMigrations } from './db/migrations.js';
import {
  applySchema,
  loadSchemaFile,
  planSchema,
  resolveSchemaFile,
} from './db/schema.js';
import type { SchemaDictionary } from './db/schema.js';
import {
  loadRulesFile,
  resolveRulesFile,
  type RulesDictionary,
} from './db/rules.js';
import {
  loadLensesFile,
  resolveLensesFile,
  type LensRegistry,
} from './db/lenses.js';
import {
  loadProjectionsFile,
  resolveProjectionsFile,
  type ProjectionRegistry,
} from './db/projections.js';
import { loadRoutesFile, resolveRoutesFile } from './services/routes.js';
import {
  createOutboxWorker,
  loadOutboxHandlers,
  resolveOutboxFile,
} from './services/outbox.js';
import { loadCommandsDir, watchCommandsDir } from './commands/index.js';
import { createClusterBroker } from './core/broker.js';
import { createApp, createHttpServer } from './server.js';

async function tryCreateDatabase(s: ServerSettings): Promise<boolean> {
  try {
    if (s.dialect === 'postgres') {
      const pg = (await import('pg')).default;
      const client = new pg.Client(pgClientConfig(s, 'postgres'));
      await client.connect();
      try {
        await client.query(
          `CREATE DATABASE "${s.db.database.replace(/"/g, '')}"`,
        );
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
        `CREATE DATABASE IF NOT EXISTS \`${s.db.database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`,
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
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('Unknown authenticationOk message type')) {
    return new Error(
      `PostgreSQL driver received a non-Postgres handshake on ${s.db.host}:${s.db.port}. Check DB_PORT (5432 for Postgres, 3306 for MySQL).`,
    );
  }
  if (code === 'ER_BAD_DB_ERROR' || code === '3D000') {
    return new Error(
      `Database "${s.db.database}" does not exist. Create it first ` +
        (s.dialect === 'mysql'
          ? `(CREATE DATABASE \`${s.db.database}\` CHARACTER SET utf8mb4;)`
          : `(CREATE DATABASE "${s.db.database}";)`) +
        ' and grant your user access.',
    );
  }
  return err;
}

export async function loadSchema(s: ServerSettings): Promise<SchemaDictionary> {
  let file: string | null = null;
  try {
    file = resolveSchemaFile(s.schemaPath);
  } catch (err) {
    if (s.schemaPath) throw err;
  }
  return file ? loadSchemaFile(file) : {};
}

/** Core + schema migrations. Returns a human-readable log. */
export async function migrate(
  s: ServerSettings,
  db: Database,
  schema: SchemaDictionary,
): Promise<void> {
  const applyAll = async () => {
    const core = await runMigrations(db.executor);
    if (core.applied.length)
      console.log(
        '[local-lite-server] core migrations:',
        core.applied.join(', '),
      );
    if (Object.keys(schema).length > 0) {
      const plan = await applySchema(db.executor, schema);
      if (plan.up.length)
        console.log(
          `[local-lite-server] schema: applied ${plan.up.length} change(s)`,
        );
      for (const w of plan.warnings)
        console.warn('[local-lite-server] schema warning:', w);
    }
  };
  try {
    await applyAll();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (
      (code === 'ER_BAD_DB_ERROR' || code === '3D000') &&
      (await tryCreateDatabase(s))
    ) {
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
  const rules: RulesDictionary = rulesFile
    ? await loadRulesFile(rulesFile)
    : {};
  if (Object.keys(schema).length > 0 && settings.appSecret && !rulesFile) {
    console.warn(
      '[local-lite-server] APP_SECRET is set without src/rules.ts; authenticated users can sync all tables.',
    );
  }
  const commands = await loadCommandsDir(settings.commandsDir);
  const lensesFile = resolveLensesFile();
  const lenses: LensRegistry = lensesFile
    ? await loadLensesFile(lensesFile)
    : new Map();
  const projectionsFile = resolveProjectionsFile();
  const projections: ProjectionRegistry = projectionsFile
    ? await loadProjectionsFile(projectionsFile)
    : new Map();
  const routesFile = resolveRoutesFile();
  const customRoutes = routesFile
    ? await loadRoutesFile(routesFile)
    : undefined;
  const database = await createDatabase(settings);

  try {
    if (settings.autoMigrate) {
      await migrate(settings, database, schema);
    } else {
      const plan = await planSchema(database.executor, schema).catch(
        () => null,
      );
      if (!plan || plan.up.length) {
        console.warn(
          '[local-lite-server] AUTO_MIGRATE=false and migrations are pending. Run: npm run migrate',
        );
      }
    }
  } catch (err) {
    await database.close().catch(() => {});
    throw friendlyDbError(err, settings);
  }

  const broker = await createClusterBroker(settings, database.executor);
  const app = createApp(
    settings,
    database.executor,
    schema,
    commands,
    rules,
    broker,
    customRoutes,
    lenses,
    projections,
  );
  const server = createHttpServer(app);
  const host = process.env.SERVER_HOST || '127.0.0.1';
  let activePort = settings.port;
  let attempts = 0;

  const listen = (onListening?: () => void) =>
    typeof activePort === 'number'
      ? server.listen(activePort, host, onListening)
      : server.listen(activePort, onListening);

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (
      err.code === 'EADDRINUSE' &&
      typeof activePort === 'number' &&
      !process.env.PORT &&
      attempts < 20
    ) {
      const nextPort = activePort + 1;
      console.warn(
        `[local-lite-server] port ${activePort} is in use, trying ${nextPort}...`,
      );
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
  const outboxFile = resolveOutboxFile();
  const outboxHandlers = outboxFile
    ? await loadOutboxHandlers(outboxFile)
    : {};
  const outboxWorker = createOutboxWorker({
    db: database.executor,
    handlers: outboxHandlers,
    onError: (err, rec) =>
      console.error(`[local-lite-server] outbox "${rec.topic}" failed:`, err),
  });
  const stopOutbox = outboxWorker.start();

  listen(() => {
    const addr =
      typeof activePort === 'number'
        ? `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${activePort}`
        : activePort;
    if (settings.dashboard && typeof activePort === 'number') {
      console.log(`\x1b[32m[local-lite-server] dashboard: ${addr}\x1b[0m`);
    }
  });
  const stopWatch =
    process.env.NODE_ENV === 'production'
      ? () => {}
      : watchCommandsDir(settings.commandsDir, commands);
  const shutdown = () => {
    stopOutbox();
    stopWatch();
    server.close();
    void broker
      .close()
      .finally(() => void database.close().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}
