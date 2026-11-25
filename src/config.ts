import type { SqlDialect } from 'local-lite/server';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export interface ServerSettings {
  /** Number, or a socket path when the host (Passenger/lsnode) provides one. */
  port: number | string;
  dialect: SqlDialect;
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl: boolean;
    poolSize: number;
  };
  autoMigrate: boolean;
  schemaPath?: string;
  apiKey: string;
  /** Signs user tokens. Enables /auth when set. */
  appSecret?: string;
  appName: string;
  adminUi: boolean;
  smtp?: SmtpSettings;
  corsOrigins: string[];
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): ServerSettings {
  const dialect = (env.DB_DIALECT ?? 'mysql').toLowerCase();
  if (dialect !== 'mysql' && dialect !== 'postgres') {
    throw new Error(`DB_DIALECT must be "mysql" or "postgres", got "${dialect}".`);
  }
  const missing = ['DB_HOST', 'DB_USER', 'DB_NAME', 'SERVER_API_KEY'].filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  const rawPort = env.PORT || env.SERVER_PORT || '3000';
  const smtpPort = Number(env.SMTP_PORT || 465);
  return {
    port: /^\d+$/.test(rawPort) ? Number(rawPort) : rawPort,
    dialect,
    db: {
      host: env.DB_HOST!,
      port: Number(env.DB_PORT || (dialect === 'postgres' ? 5432 : 3306)),
      user: env.DB_USER!,
      password: env.DB_PASSWORD ?? '',
      database: env.DB_NAME!,
      ssl: env.DB_SSL === 'true',
      poolSize: Number(env.DB_POOL_SIZE || 5),
    },
    autoMigrate: env.AUTO_MIGRATE !== 'false',
    schemaPath: env.SCHEMA_PATH || undefined,
    apiKey: env.SERVER_API_KEY!,
    appSecret: env.APP_SECRET?.trim() || undefined,
    appName: env.APP_NAME || 'local-lite-server',
    adminUi: env.ADMIN_UI !== 'false',
    smtp: env.SMTP_HOST
      ? {
          host: env.SMTP_HOST,
          port: smtpPort,
          secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : smtpPort === 465,
          user: env.SMTP_USER || undefined,
          pass: env.SMTP_PASS || undefined,
          from: env.SMTP_FROM || env.SMTP_USER || 'no-reply@localhost',
        }
      : undefined,
    corsOrigins: (env.CORS_ORIGINS ?? '*')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
