import type { SqlExecutor } from 'local-lite/server';

interface Migration {
  id: string;
  mysql: string[];
  postgres: string[];
}

/** Framework tables only. Your own tables come from schema.ts (see schema.ts). */
export const MIGRATIONS: Migration[] = [
  {
    id: '0001_core',
    mysql: [
      `CREATE TABLE IF NOT EXISTS _server_sync_clock (
        id INT PRIMARY KEY,
        checkpoint BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `INSERT IGNORE INTO _server_sync_clock (id, checkpoint) VALUES (1, 0)`,
      `CREATE TABLE IF NOT EXISTS _server_changes (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        table_name VARCHAR(128) NOT NULL,
        row_id VARCHAR(128) NOT NULL,
        \`timestamp\` BIGINT NOT NULL,
        INDEX idx_changes_ts (\`timestamp\`),
        INDEX idx_changes_table_row (table_name, row_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS _lls_schema_state (
        id INT PRIMARY KEY,
        state LONGTEXT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ],
    postgres: [
      `CREATE TABLE IF NOT EXISTS _server_sync_clock (
        id INT PRIMARY KEY,
        checkpoint BIGINT NOT NULL
      )`,
      `INSERT INTO _server_sync_clock (id, checkpoint) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`,
      `CREATE TABLE IF NOT EXISTS _server_changes (
        id BIGSERIAL PRIMARY KEY,
        table_name VARCHAR(128) NOT NULL,
        row_id VARCHAR(128) NOT NULL,
        "timestamp" BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_changes_ts ON _server_changes ("timestamp")`,
      `CREATE INDEX IF NOT EXISTS idx_changes_table_row ON _server_changes (table_name, row_id)`,
      `CREATE TABLE IF NOT EXISTS _lls_schema_state (
        id INT PRIMARY KEY,
        state TEXT NOT NULL
      )`,
    ],
  },
  {
    id: '0002_auth',
    mysql: [
      `CREATE TABLE IF NOT EXISTS _local_auth_accounts (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        display_name VARCHAR(255) NULL,
        password_hash VARCHAR(255) NOT NULL,
        salt VARCHAR(128) NOT NULL,
        iterations INT NOT NULL,
        algorithm VARCHAR(64) NOT NULL,
        failed_login_attempts INT NOT NULL DEFAULT 0,
        locked_until BIGINT NULL,
        token_version INT NOT NULL DEFAULT 1,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS _local_auth_reset_otps (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        email VARCHAR(255) NOT NULL,
        otp_hash VARCHAR(128) NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        expires_at BIGINT NOT NULL,
        used_at BIGINT NULL,
        created_at BIGINT NOT NULL,
        INDEX idx_otps_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ],
    postgres: [
      `CREATE TABLE IF NOT EXISTS _local_auth_accounts (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        display_name VARCHAR(255) NULL,
        password_hash VARCHAR(255) NOT NULL,
        salt VARCHAR(128) NOT NULL,
        iterations INT NOT NULL,
        algorithm VARCHAR(64) NOT NULL,
        failed_login_attempts INT NOT NULL DEFAULT 0,
        locked_until BIGINT NULL,
        token_version INT NOT NULL DEFAULT 1,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS _local_auth_reset_otps (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        email VARCHAR(255) NOT NULL,
        otp_hash VARCHAR(128) NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        expires_at BIGINT NOT NULL,
        used_at BIGINT NULL,
        created_at BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_otps_email ON _local_auth_reset_otps (email)`,
    ],
  },
];

export async function runMigrations(
  db: SqlExecutor,
): Promise<{ applied: string[] }> {
  await db.execute(
    db.dialect === 'postgres'
      ? `CREATE TABLE IF NOT EXISTS _lls_migrations (id VARCHAR(128) PRIMARY KEY, applied_at BIGINT NOT NULL)`
      : `CREATE TABLE IF NOT EXISTS _lls_migrations (id VARCHAR(128) PRIMARY KEY, applied_at BIGINT NOT NULL) ENGINE=InnoDB`,
  );
  const done = new Set(
    (await db.query<{ id: string }>('SELECT id FROM _lls_migrations')).map((r) => r.id),
  );
  // Pre-release layout kept row payloads in _server_changes; replace it.
  if (done.has('0001_sync_core')) {
    await db.execute('DROP TABLE IF EXISTS _server_changes');
    await db.execute("DELETE FROM _lls_migrations WHERE id = '0001_sync_core'");
    done.delete('0001_sync_core');
  }
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    for (const stmt of m[db.dialect]) await db.execute(stmt);
    await db.execute('INSERT INTO _lls_migrations (id, applied_at) VALUES (?, ?)', [
      m.id,
      Date.now(),
    ]);
    applied.push(m.id);
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
