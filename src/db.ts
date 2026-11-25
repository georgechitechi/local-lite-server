import { createSqlExecutor, type SqlExecutor } from 'local-lite/server';
import type { ServerSettings } from './config.js';

export interface Database {
  executor: SqlExecutor;
  close(): Promise<void>;
}

export async function createDatabase(settings: ServerSettings): Promise<Database> {
  const { db, dialect } = settings;
  if (dialect === 'postgres') {
    const pg = (await import('pg')).default;
    // Parse Postgres BIGINT as number to match mysql2 (epoch-ms timestamps).
    pg.types.setTypeParser(20, (v: string) => Number(v));
    const pool = new pg.Pool({
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      database: db.database,
      ssl: db.ssl ? { rejectUnauthorized: false } : undefined,
      max: db.poolSize,
    });
    return {
      executor: createSqlExecutor(pool, 'postgres'),
      close: () => pool.end(),
    };
  }
  const mysql = (await import('mysql2/promise')).default;
  const pool = mysql.createPool({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.database,
    waitForConnections: true,
    connectionLimit: db.poolSize,
    queueLimit: 0,
  });
  return {
    executor: createSqlExecutor(pool, 'mysql'),
    close: () => pool.end(),
  };
}
