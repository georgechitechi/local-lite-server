import type { SqlDialect, SqlExecutor } from 'local-lite/server';
import { ensureColumn } from '../core/sql.js';

const MYSQL_OPTS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci';

interface TableDef {
  columns: string;
  indexes?: Record<string, string>;
}

const CORE_TABLES: Record<string, TableDef> = {
  _server_sync_clock: {
    columns: `
      id INT PRIMARY KEY,
      checkpoint BIGINT NOT NULL
    `,
  },
  _server_changes: {
    columns: `
      id {AUTO_ID},
      project_id VARCHAR(64) NULL,
      table_name VARCHAR(128) NOT NULL,
      row_id VARCHAR(128) NOT NULL,
      {TS} BIGINT NOT NULL
    `,
    indexes: {
      idx_changes_ts: '{TS}',
      idx_changes_project_ts: 'project_id, {TS}',
      idx_changes_table_row: 'table_name, row_id',
    },
  },
  _lls_schema_state: {
    columns: `
      id INT PRIMARY KEY,
      state {LONGTEXT} NOT NULL
    `,
  },
  _lls_projects: {
    columns: `
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      slug VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(128) NOT NULL,
      owner_user_id VARCHAR(64) NULL,
      schema_json {LONGTEXT} NULL,
      schema_state_json {LONGTEXT} NULL,
      rules_json {LONGTEXT} NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    `,
    indexes: { idx_projects_owner: 'owner_user_id' },
  },
  _local_auth_accounts: {
    columns: `
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      project_id VARCHAR(64) NULL,
      email VARCHAR(255) NOT NULL,
      display_name VARCHAR(255) NULL,
      password_hash VARCHAR(255) NOT NULL,
      salt VARCHAR(128) NOT NULL,
      iterations INT NOT NULL,
      algorithm VARCHAR(64) NOT NULL,
      failed_login_attempts INT NOT NULL DEFAULT 0,
      locked_until BIGINT NULL,
      token_version INT NOT NULL DEFAULT 1,
      console_role VARCHAR(32) NULL,
      console_active {BOOL_FALSE},
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    `,
    indexes: { idx_auth_project_email: 'project_id, email' },
  },
  _local_auth_reset_otps: {
    columns: `
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      project_id VARCHAR(64) NULL,
      user_id VARCHAR(64) NOT NULL,
      email VARCHAR(255) NOT NULL,
      otp_hash VARCHAR(128) NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      expires_at BIGINT NOT NULL,
      used_at BIGINT NULL,
      created_at BIGINT NOT NULL
    `,
    indexes: { idx_otp_project_email: 'project_id, email' },
  },
  _lls_storage_buckets: {
    columns: `
      name VARCHAR(128) NOT NULL PRIMARY KEY,
      project_id VARCHAR(64) NULL,
      visibility VARCHAR(16) NOT NULL DEFAULT 'private',
      created_at BIGINT NOT NULL
    `,
    indexes: { idx_buckets_project: 'project_id' },
  },
  _lls_storage_files: {
    columns: `
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      project_id VARCHAR(64) NULL,
      storage_key VARCHAR(255) NOT NULL UNIQUE,
      bucket VARCHAR(128) NOT NULL,
      name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(128) NOT NULL,
      size_bytes BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    `,
    indexes: {
      idx_files_bucket: 'bucket',
      idx_files_project: 'project_id',
    },
  },
  _lls_env_vars: {
    columns: `
      var_key VARCHAR(128) NOT NULL PRIMARY KEY,
      project_id VARCHAR(64) NULL,
      var_value TEXT NOT NULL,
      is_secret {BOOL_FALSE},
      updated_at BIGINT NOT NULL
    `,
  },
  _lls_backups: {
    columns: `
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      project_id VARCHAR(64) NULL,
      user_id VARCHAR(64) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      status VARCHAR(32) NOT NULL,
      size_bytes BIGINT NOT NULL,
      record_count INT NOT NULL,
      created_at BIGINT NOT NULL
    `,
    indexes: { idx_backups_project: 'project_id' },
  },
  _lls_crons: {
    columns: `
      job_key VARCHAR(128) NOT NULL PRIMARY KEY,
      project_id VARCHAR(64) NULL,
      label VARCHAR(255) NOT NULL,
      action_type VARCHAR(64) NOT NULL,
      cron_expr VARCHAR(64) NOT NULL,
      timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
      enabled {BOOL_TRUE},
      config_json TEXT NULL,
      last_run_at BIGINT NULL,
      last_status VARCHAR(32) NULL,
      last_summary TEXT NULL
    `,
  },
  _lls_rate_limits: {
    columns: `
      rate_key VARCHAR(128) NOT NULL PRIMARY KEY,
      hits INT NOT NULL DEFAULT 0,
      reset_at BIGINT NOT NULL
    `,
  },
  _lls_api_keys: {
    columns: `
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      project_id VARCHAR(64) NULL,
      name VARCHAR(128) NOT NULL,
      key_prefix VARCHAR(24) NOT NULL,
      key_hash VARCHAR(128) NOT NULL UNIQUE,
      role VARCHAR(16) NOT NULL DEFAULT 'admin',
      user_id VARCHAR(64) NULL,
      created_by VARCHAR(64) NULL,
      last_used_at BIGINT NULL,
      expires_at BIGINT NULL,
      revoked_at BIGINT NULL,
      created_at BIGINT NOT NULL
    `,
    indexes: { idx_api_keys_project: 'project_id' },
  },
};

function expandTokens(sql: string, dialect: SqlDialect): string {
  const pg = dialect === 'postgres';
  return sql
    .replaceAll('{AUTO_ID}', pg ? 'BIGSERIAL PRIMARY KEY' : 'BIGINT AUTO_INCREMENT PRIMARY KEY')
    .replaceAll('{LONGTEXT}', pg ? 'TEXT' : 'LONGTEXT')
    .replaceAll('{BOOL_FALSE}', pg ? 'BOOLEAN NOT NULL DEFAULT FALSE' : 'TINYINT(1) NOT NULL DEFAULT 0')
    .replaceAll('{BOOL_TRUE}', pg ? 'BOOLEAN NOT NULL DEFAULT TRUE' : 'TINYINT(1) NOT NULL DEFAULT 1')
    .replaceAll('{TS}', pg ? '"timestamp"' : '`timestamp`');
}

function buildCoreStatements(dialect: SqlDialect): string[] {
  const pg = dialect === 'postgres';
  const stmts: string[] = [];

  for (const [table, def] of Object.entries(CORE_TABLES)) {
    const cols = expandTokens(def.columns.trim(), dialect);
    const indexes = Object.entries(def.indexes ?? {});
    const inlineIdx = !pg
      ? indexes.map(([idx, expr]) => `,\n      INDEX ${idx} (${expandTokens(expr, dialect)})`).join('')
      : '';
    stmts.push(`CREATE TABLE IF NOT EXISTS ${table} (\n      ${cols}${inlineIdx}\n    )${pg ? '' : ` ${MYSQL_OPTS}`}`);
    if (pg) {
      for (const [idx, expr] of indexes) {
        stmts.push(`CREATE INDEX IF NOT EXISTS ${idx} ON ${table} (${expandTokens(expr, dialect)})`);
      }
    }
  }

  stmts.push(
    pg
      ? 'INSERT INTO _server_sync_clock (id, checkpoint) VALUES (1, 0) ON CONFLICT (id) DO NOTHING'
      : 'INSERT IGNORE INTO _server_sync_clock (id, checkpoint) VALUES (1, 0)',
  );
  return stmts;
}

export const MIGRATIONS = [{ id: '20261127081945_core_schema' }];

const PROJECT_SCOPED_TABLES = [
  '_server_changes',
  '_local_auth_accounts',
  '_local_auth_reset_otps',
  '_lls_storage_buckets',
  '_lls_storage_files',
  '_lls_env_vars',
  '_lls_backups',
  '_lls_crons',
  '_lls_api_keys',
];

export async function runMigrations(db: SqlExecutor): Promise<{ applied: string[] }> {
  await db.execute(
    db.dialect === 'postgres'
      ? 'CREATE TABLE IF NOT EXISTS _lls_migrations (id VARCHAR(128) PRIMARY KEY, applied_at BIGINT NOT NULL)'
      : `CREATE TABLE IF NOT EXISTS _lls_migrations (id VARCHAR(128) PRIMARY KEY, applied_at BIGINT NOT NULL) ${MYSQL_OPTS}`,
  );
  const done = new Set((await db.query<{ id: string }>('SELECT id FROM _lls_migrations')).map((r) => r.id));
  const applied: string[] = [];
  if (!done.has(MIGRATIONS[0].id)) {
    for (const stmt of buildCoreStatements(db.dialect)) await db.execute(stmt);
    await db.execute('INSERT INTO _lls_migrations (id, applied_at) VALUES (?, ?)', [MIGRATIONS[0].id, Date.now()]);
    applied.push(MIGRATIONS[0].id);
  }
  for (const t of PROJECT_SCOPED_TABLES) {
    await ensureColumn(db, t, 'project_id', 'VARCHAR(64) NULL');
  }
  return { applied };
}

export async function coreMigrationStatus(db: SqlExecutor) {
  try {
    const done = new Set((await db.query<{ id: string }>('SELECT id FROM _lls_migrations')).map((r) => r.id));
    return {
      applied: MIGRATIONS.filter((m) => done.has(m.id)).map((m) => m.id),
      pending: MIGRATIONS.filter((m) => !done.has(m.id)).map((m) => m.id),
    };
  } catch {
    return { applied: [], pending: MIGRATIONS.map((m) => m.id) };
  }
}
