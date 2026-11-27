import type { SqlExecutor } from 'local-lite/server';
import { ensureColumn } from '../core/sql.js';

interface Migration {
  id: string;
  mysql: string[];
  postgres: string[];
}

const MYSQL_OPTS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci';

/** Framework tables. App tables come from schema.ts or per-project schemas. */
export const MIGRATIONS: Migration[] = [
  {
    id: '20261127081945_core_schema',
    mysql: [
      `CREATE TABLE IF NOT EXISTS _server_sync_clock (
        id INT PRIMARY KEY,
        checkpoint BIGINT NOT NULL
      ) ${MYSQL_OPTS}`,
      `INSERT IGNORE INTO _server_sync_clock (id, checkpoint) VALUES (1, 0)`,
      `CREATE TABLE IF NOT EXISTS _server_changes (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        project_id VARCHAR(64) NULL,
        table_name VARCHAR(128) NOT NULL,
        row_id VARCHAR(128) NOT NULL,
        \`timestamp\` BIGINT NOT NULL,
        INDEX idx_changes_ts (\`timestamp\`),
        INDEX idx_changes_project_ts (project_id, \`timestamp\`),
        INDEX idx_changes_table_row (table_name, row_id)
      ) ${MYSQL_OPTS}`,
      `CREATE TABLE IF NOT EXISTS _lls_schema_state (
        id INT PRIMARY KEY,
        state LONGTEXT NOT NULL
      ) ${MYSQL_OPTS}`,
      `CREATE TABLE IF NOT EXISTS _lls_projects (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        slug VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(128) NOT NULL,
        owner_user_id VARCHAR(64) NULL,
        schema_json LONGTEXT NULL,
        schema_state_json LONGTEXT NULL,
        rules_json LONGTEXT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        INDEX idx_projects_owner (owner_user_id)
      ) ${MYSQL_OPTS}`,
      `CREATE TABLE IF NOT EXISTS _local_auth_accounts (
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
        console_active TINYINT(1) NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        INDEX idx_auth_project_email (project_id, email)
      ) ${MYSQL_OPTS}`,
      `CREATE TABLE IF NOT EXISTS _local_auth_reset_otps (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        project_id VARCHAR(64) NULL,
        user_id VARCHAR(64) NOT NULL,
        email VARCHAR(255) NOT NULL,
        otp_hash VARCHAR(128) NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        expires_at BIGINT NOT NULL,
        used_at BIGINT NULL,
        created_at BIGINT NOT NULL,
        INDEX idx_otp_project_email (project_id, email)
      ) ${MYSQL_OPTS}`,
      `CREATE TABLE IF NOT EXISTS _lls_storage_buckets (
        name VARCHAR(128) NOT NULL PRIMARY KEY,
        project_id VARCHAR(64) NULL,
        visibility VARCHAR(16) NOT NULL DEFAULT 'private',
        created_at BIGINT NOT NULL,
        INDEX idx_buckets_project (project_id)
      ) ${MYSQL_OPTS}`,
      `CREATE TABLE IF NOT EXISTS _lls_storage_files (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        project_id VARCHAR(64) NULL,
        storage_key VARCHAR(255) NOT NULL UNIQUE,
        bucket VARCHAR(128) NOT NULL,
        name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(128) NOT NULL,
        size_bytes BIGINT NOT NULL,
        created_at BIGINT NOT NULL,
        INDEX idx_files_bucket (bucket),
        INDEX idx_files_project (project_id)
      ) ${MYSQL_OPTS}`,
      `CREATE TABLE IF NOT EXISTS _lls_env_vars (
        var_key VARCHAR(128) NOT NULL PRIMARY KEY,
        project_id VARCHAR(64) NULL,
        var_value TEXT NOT NULL,
        is_secret TINYINT(1) NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL
      ) ${MYSQL_OPTS}`,
      `CREATE TABLE IF NOT EXISTS _lls_backups (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        project_id VARCHAR(64) NULL,
        user_id VARCHAR(64) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        status VARCHAR(32) NOT NULL,
        size_bytes BIGINT NOT NULL,
        record_count INT NOT NULL,
        created_at BIGINT NOT NULL,
        INDEX idx_backups_project (project_id)
      ) ${MYSQL_OPTS}`,
      `CREATE TABLE IF NOT EXISTS _lls_crons (
        job_key VARCHAR(128) NOT NULL PRIMARY KEY,
        project_id VARCHAR(64) NULL,
        label VARCHAR(255) NOT NULL,
        action_type VARCHAR(64) NOT NULL,
        cron_expr VARCHAR(64) NOT NULL,
        timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        config_json TEXT NULL,
        last_run_at BIGINT NULL,
        last_status VARCHAR(32) NULL,
        last_summary TEXT NULL
      ) ${MYSQL_OPTS}`,
      `CREATE TABLE IF NOT EXISTS _lls_rate_limits (
        rate_key VARCHAR(128) NOT NULL PRIMARY KEY,
        hits INT NOT NULL DEFAULT 0,
        reset_at BIGINT NOT NULL
      ) ${MYSQL_OPTS}`,
      `CREATE TABLE IF NOT EXISTS _lls_api_keys (
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
        created_at BIGINT NOT NULL,
        INDEX idx_api_keys_project (project_id)
      ) ${MYSQL_OPTS}`,
    ],
    postgres: [
      `CREATE TABLE IF NOT EXISTS _server_sync_clock (
        id INT PRIMARY KEY,
        checkpoint BIGINT NOT NULL
      )`,
      `INSERT INTO _server_sync_clock (id, checkpoint) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`,
      `CREATE TABLE IF NOT EXISTS _server_changes (
        id BIGSERIAL PRIMARY KEY,
        project_id VARCHAR(64) NULL,
        table_name VARCHAR(128) NOT NULL,
        row_id VARCHAR(128) NOT NULL,
        "timestamp" BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_changes_ts ON _server_changes ("timestamp")`,
      `CREATE INDEX IF NOT EXISTS idx_changes_project_ts ON _server_changes (project_id, "timestamp")`,
      `CREATE INDEX IF NOT EXISTS idx_changes_table_row ON _server_changes (table_name, row_id)`,
      `CREATE TABLE IF NOT EXISTS _lls_schema_state (
        id INT PRIMARY KEY,
        state TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS _lls_projects (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        slug VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(128) NOT NULL,
        owner_user_id VARCHAR(64) NULL,
        schema_json TEXT NULL,
        schema_state_json TEXT NULL,
        rules_json TEXT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_projects_owner ON _lls_projects (owner_user_id)`,
      `CREATE TABLE IF NOT EXISTS _local_auth_accounts (
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
        console_active BOOLEAN NOT NULL DEFAULT FALSE,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_auth_project_email ON _local_auth_accounts (project_id, email)`,
      `CREATE TABLE IF NOT EXISTS _local_auth_reset_otps (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        project_id VARCHAR(64) NULL,
        user_id VARCHAR(64) NOT NULL,
        email VARCHAR(255) NOT NULL,
        otp_hash VARCHAR(128) NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        expires_at BIGINT NOT NULL,
        used_at BIGINT NULL,
        created_at BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_otp_project_email ON _local_auth_reset_otps (project_id, email)`,
      `CREATE TABLE IF NOT EXISTS _lls_storage_buckets (
        name VARCHAR(128) NOT NULL PRIMARY KEY,
        project_id VARCHAR(64) NULL,
        visibility VARCHAR(16) NOT NULL DEFAULT 'private',
        created_at BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_buckets_project ON _lls_storage_buckets (project_id)`,
      `CREATE TABLE IF NOT EXISTS _lls_storage_files (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        project_id VARCHAR(64) NULL,
        storage_key VARCHAR(255) NOT NULL UNIQUE,
        bucket VARCHAR(128) NOT NULL,
        name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(128) NOT NULL,
        size_bytes BIGINT NOT NULL,
        created_at BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_files_bucket ON _lls_storage_files (bucket)`,
      `CREATE INDEX IF NOT EXISTS idx_files_project ON _lls_storage_files (project_id)`,
      `CREATE TABLE IF NOT EXISTS _lls_env_vars (
        var_key VARCHAR(128) NOT NULL PRIMARY KEY,
        project_id VARCHAR(64) NULL,
        var_value TEXT NOT NULL,
        is_secret BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at BIGINT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS _lls_backups (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        project_id VARCHAR(64) NULL,
        user_id VARCHAR(64) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        status VARCHAR(32) NOT NULL,
        size_bytes BIGINT NOT NULL,
        record_count INT NOT NULL,
        created_at BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_backups_project ON _lls_backups (project_id)`,
      `CREATE TABLE IF NOT EXISTS _lls_crons (
        job_key VARCHAR(128) NOT NULL PRIMARY KEY,
        project_id VARCHAR(64) NULL,
        label VARCHAR(255) NOT NULL,
        action_type VARCHAR(64) NOT NULL,
        cron_expr VARCHAR(64) NOT NULL,
        timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        config_json TEXT NULL,
        last_run_at BIGINT NULL,
        last_status VARCHAR(32) NULL,
        last_summary TEXT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS _lls_rate_limits (
        rate_key VARCHAR(128) NOT NULL PRIMARY KEY,
        hits INT NOT NULL DEFAULT 0,
        reset_at BIGINT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS _lls_api_keys (
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
      )`,
      `CREATE INDEX IF NOT EXISTS idx_api_keys_project ON _lls_api_keys (project_id)`,
    ],
  },
];

export async function runMigrations(db: SqlExecutor): Promise<{ applied: string[] }> {
  await db.execute(
    db.dialect === 'postgres'
      ? `CREATE TABLE IF NOT EXISTS _lls_migrations (id VARCHAR(128) PRIMARY KEY, applied_at BIGINT NOT NULL)`
      : `CREATE TABLE IF NOT EXISTS _lls_migrations (id VARCHAR(128) PRIMARY KEY, applied_at BIGINT NOT NULL) ${MYSQL_OPTS}`,
  );
  const done = new Set(
    (await db.query<{ id: string }>('SELECT id FROM _lls_migrations')).map((r) => r.id),
  );
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    for (const stmt of m[db.dialect]) await db.execute(stmt);
    await db.execute('INSERT INTO _lls_migrations (id, applied_at) VALUES (?, ?)', [m.id, Date.now()]);
    applied.push(m.id);
  }
  for (const t of [
    '_server_changes',
    '_local_auth_accounts',
    '_local_auth_reset_otps',
    '_lls_storage_buckets',
    '_lls_storage_files',
    '_lls_env_vars',
    '_lls_backups',
    '_lls_crons',
    '_lls_api_keys',
  ]) {
    await ensureColumn(db, t, 'project_id', 'VARCHAR(64) NULL');
  }
  return { applied };
}

export async function coreMigrationStatus(db: SqlExecutor) {
  try {
    const rows = await db.query<{ id: string }>('SELECT id FROM _lls_migrations');
    const done = new Set(rows.map((r) => r.id));
    return {
      applied: MIGRATIONS.filter((m) => done.has(m.id)).map((m) => m.id),
      pending: MIGRATIONS.filter((m) => !done.has(m.id)).map((m) => m.id),
    };
  } catch {
    return { applied: [], pending: MIGRATIONS.map((m) => m.id) };
  }
}
