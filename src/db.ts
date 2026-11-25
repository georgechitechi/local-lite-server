import mysql from 'mysql2/promise';
import pg from 'pg';
import { createSqlExecutor, type SqlExecutor } from 'local-lite/server';
import type { ServerSettings } from './config.js';

// Parse Postgres BIGINT as number to match mysql2 (epoch-ms timestamps).
pg.types.setTypeParser(20, (v: string) => Number(v));

export interface Database {
  executor: SqlExecutor;
  close(): Promise<void>;
}

export function createDatabase(settings: ServerSettings): Database {
  const { db, dialect } = settings;
  if (dialect === 'postgres') {
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
