import type { SqlExecutor, SyncEventBroker } from 'local-lite/server';
import type { ServerSettings } from '../config.js';
import type { FunctionRuntime } from '../functions/index.js';
import type { SchemaDictionary } from '../db/schema.js';
import { createAdminData } from './console.js';
import { createAdminOps } from './ops.js';
import { createAdminSession } from './session.js';

export function createAdminConsole(opts: {
  settings: ServerSettings;
  db: SqlExecutor;
  schema: SchemaDictionary;
  broker?: SyncEventBroker;
  fnRuntime?: FunctionRuntime;
}) {
  const session = createAdminSession(opts.settings, opts.db);
  const data = createAdminData(opts);
  const ops = createAdminOps(opts.settings, opts.db, opts.schema, opts.fnRuntime);

  return {
    ...session,
    ...data,
    ...ops,
  };
}
