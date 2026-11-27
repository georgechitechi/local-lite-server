import type { SqlExecutor } from 'local-lite/server';
import type { ServerSettings } from '../../config.js';
import { sendSmtpMail } from '../../core/mailer.js';
import { applySchema, planSchema, type SchemaDictionary } from '../../db/schema.js';

export function createSettingsHandler(settings: ServerSettings, db: SqlExecutor, schema: SchemaDictionary) {
  return async (request: Request) => {
    if (request.method.toUpperCase() === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { action?: string; to?: string };
      if (body.action === 'apply_schema') {
        const plan = await applySchema(db, schema);
        return Response.json({ ok: true, applied: plan.up.length, warnings: plan.warnings });
      }
      if (body.action === 'test_email') {
        if (!settings.smtp) return Response.json({ ok: false, error: 'SMTP is not configured.' }, { status: 400 });
        const to = String(body.to ?? '').trim();
        if (!to || !to.includes('@')) return Response.json({ ok: false, error: 'Valid recipient email is required.' }, { status: 400 });
        await sendSmtpMail(
          settings.smtp,
          to,
          `${settings.appName} SMTP Test`,
          `SMTP is working on ${settings.appName} (${new Date().toISOString()}).`,
        );
        return Response.json({ ok: true });
      }
      const t0 = Date.now();
      try {
        await db.query('SELECT 1');
        return Response.json({ ok: true, status: 200, latencyMs: Date.now() - t0 });
      } catch (err) {
        return Response.json({ ok: false, status: 503, latencyMs: Date.now() - t0, error: String(err) });
      }
    }

    const plan = await planSchema(db, schema).catch(() => null);
    return Response.json({
      mode: 'self-hosted',
      dialect: settings.dialect,
      dbHost: settings.db.host,
      dbPort: String(settings.db.port),
      dbName: settings.db.database,
      poolSize: settings.db.poolSize,
      corsOrigins: settings.corsOrigins,
      uploadDir: settings.uploadDir,
      backupDir: settings.backupDir,
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      pendingSql: plan?.up ?? [],
      schemaWarnings: plan?.warnings ?? [],
      integrations: {
        appSecret: Boolean(settings.appSecret),
        smtp: Boolean(settings.smtp),
        autoMigrate: settings.autoMigrate,
        internalCrons: settings.internalCrons,
        multiInstance: settings.multiInstance,
        googleOAuth: Boolean(process.env.GOOGLE_CLIENT_SECRET),
        githubOAuth: Boolean(process.env.GITHUB_CLIENT_SECRET),
      },
    });
  };
}
