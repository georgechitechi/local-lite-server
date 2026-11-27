import type { SqlExecutor, SyncEventBroker } from 'local-lite/server';
import type { ServerSettings } from '../config.js';
import type { SchemaDictionary } from '../db/schema.js';
import type { FunctionRuntime } from '../functions/index.js';
import { createAdminData } from './console.js';
import { createBackupsHandler } from './handlers/backups.js';
import { createCronsHandler } from './handlers/crons.js';
import { createEnvHandler } from './handlers/env.js';
import { createSettingsHandler } from './handlers/settings.js';
import { createStorageAdminHandler } from './handlers/storage.js';
import { createAdminSession } from './session.js';

export function createAdminConsole(opts: {
  settings: ServerSettings;
  db: SqlExecutor;
  schema: SchemaDictionary;
  broker?: SyncEventBroker;
  fnRuntime?: FunctionRuntime;
}) {
  return {
    ...createAdminSession(opts.settings, opts.db),
    ...createAdminData(opts),
    handleEnv: createEnvHandler(opts.db),
    handleBackups: createBackupsHandler(opts.settings, opts.db, opts.schema),
    handleStorage: createStorageAdminHandler(opts.settings, opts.db),
    handleCrons: createCronsHandler(opts.settings, opts.db, opts.fnRuntime),
    handleSettings: createSettingsHandler(opts.settings, opts.db, opts.schema),
  };
}
