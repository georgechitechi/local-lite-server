import { useCallback, useEffect, useState } from 'react';
import { ToggleSlider } from '@/components/ToggleSlider';
import type { ToastType } from '@/components/Toast';
import { adminFetch, getApiBaseUrl } from '@/lib/api';
import {
  cardStyle,
  primaryBtnStyle,
  inputStyle,
  secondaryBtnStyle,
  sectionTitleStyle,
} from '@/styles/adminStyles';

interface SettingsData {
  mode: string;
  dialect: string;
  dbHost: string | null;
  dbPort: string;
  dbName: string | null;
  poolSize: number;
  corsOrigins: string[];
  uploadDir: string;
  backupDir: string;
  nodeVersion: string;
  uptimeSeconds: number;
  memoryMb: number;
  pendingSql: string[];
  schemaWarnings: string[];
  integrations: {
    appSecret: boolean;
    smtp: boolean;
    autoMigrate: boolean;
    internalCrons: boolean;
    multiInstance: boolean;
    googleOAuth: boolean;
    githubOAuth: boolean;
  };
}

function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function SettingsTab({
  onToast,
  onLogout,
  showDeletedRows = false,
  onToggleShowDeletedRows,
}: {
  onToast: (msg: string, type?: ToastType) => void;
  onLogout: (allSessions?: boolean) => void;
  showDeletedRows?: boolean;
  onToggleShowDeletedRows?: (next: boolean) => void;
}) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [applyingSchema, setApplyingSchema] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);

  const loadSettings = useCallback(async () => {
    const res = await adminFetch('/admin/settings', { cache: 'no-store' });
    if (res.ok) {
      setSettings((await res.json()) as SettingsData);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleTestHealth = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await adminFetch('/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test_health' }),
      });
      const data = await res.json().catch(() => ({}));
      setTestResult(
        data.ok
          ? `Connected (HTTP ${data.status}, ${data.latencyMs}ms)`
          : `Failed (${data.error || `HTTP ${data.status}`}, ${data.latencyMs}ms)`,
      );
    } finally {
      setTesting(false);
    }
  };

  const handleApplySchema = async () => {
    setApplyingSchema(true);
    try {
      const res = await adminFetch('/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply_schema' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(data?.error || 'Migration failed.', 'error');
        return;
      }
      onToast(`Applied ${data.applied ?? 0} schema statement(s).`, 'info');
      await loadSettings();
    } finally {
      setApplyingSchema(false);
    }
  };

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendingEmail(true);
    try {
      const res = await adminFetch('/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test_email', to: testEmailTo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        onToast(data?.error || 'Failed to send test email.', 'error');
        return;
      }
      onToast(`Test email sent to ${testEmailTo}.`, 'info');
      setTestEmailTo('');
    } finally {
      setSendingEmail(false);
    }
  };

  const integrationList: Array<{ label: string; enabled: boolean }> = settings
    ? [
      { label: 'APP_SECRET', enabled: settings.integrations.appSecret },
      { label: 'SMTP Email', enabled: settings.integrations.smtp },
      { label: 'Auto-Migrate', enabled: settings.integrations.autoMigrate },
      { label: 'Internal Crons', enabled: settings.integrations.internalCrons },
      { label: 'Multi-Instance', enabled: settings.integrations.multiInstance },
      { label: 'Google OAuth', enabled: settings.integrations.googleOAuth },
      { label: 'GitHub OAuth', enabled: settings.integrations.githubOAuth },
    ]
    : [];

  const pendingCount = settings?.pendingSql?.length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h2 style={{ ...sectionTitleStyle, margin: 0 }}>
              Server Connection &amp; Runtime
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
              Active database, runtime memory, and directory configuration.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => void loadSettings()} style={secondaryBtnStyle}>
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void handleTestHealth()}
              disabled={testing}
              style={secondaryBtnStyle}
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
          </div>
        </div>

        {testResult && (
          <div
            style={{
              marginBottom: 12,
              padding: '9px 12px',
              borderRadius: 8,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              fontSize: 13,
            }}
          >
            {testResult}
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 10,
            fontSize: 13,
          }}
        >
          <div style={infoTileStyle}>
            <span style={{ color: 'var(--muted)' }}>API Base</span>
            <strong style={{ fontFamily: 'monospace', fontSize: 12 }}>
              {getApiBaseUrl() || window.location.origin}
            </strong>
          </div>
          <div style={infoTileStyle}>
            <span style={{ color: 'var(--muted)' }}>Database ({settings?.dialect || '—'})</span>
            <strong style={{ fontFamily: 'monospace', fontSize: 12 }}>
              {settings?.dbName
                ? `${settings.dbName} (${settings.dbHost}:${settings.dbPort}, pool ${settings.poolSize})`
                : '—'}
            </strong>
          </div>
          <div style={infoTileStyle}>
            <span style={{ color: 'var(--muted)' }}>Node.js &amp; Memory</span>
            <strong>
              {settings ? `${settings.nodeVersion} • ${settings.memoryMb} MB` : '—'}
            </strong>
          </div>
          <div style={infoTileStyle}>
            <span style={{ color: 'var(--muted)' }}>Uptime</span>
            <strong>{settings ? formatUptime(settings.uptimeSeconds) : '—'}</strong>
          </div>
          <div style={infoTileStyle}>
            <span style={{ color: 'var(--muted)' }}>Uploads / Backups</span>
            <strong style={{ fontFamily: 'monospace', fontSize: 12 }}>
              {settings ? `${settings.uploadDir} • ${settings.backupDir}` : '—'}
            </strong>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h2 style={{ ...sectionTitleStyle, margin: 0 }}>Schema &amp; Migrations</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
              {pendingCount === 0
                ? 'Database schema matches schema.ts.'
                : `${pendingCount} pending SQL statement(s) detected in schema.ts.`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {pendingCount > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowSql((v) => !v)}
                  style={secondaryBtnStyle}
                >
                  {showSql ? 'Hide SQL' : 'Preview SQL'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleApplySchema()}
                  disabled={applyingSchema}
                  style={primaryBtnStyle}
                >
                  {applyingSchema ? 'Applying...' : 'Apply Migrations'}
                </button>
              </>
            ) : (
              <span
                style={{
                  padding: '6px 11px',
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 600,
                  background: 'var(--success-soft)',
                  color: 'var(--success)',
                }}
              >
                Up to date
              </span>
            )}
          </div>
        </div>

        {showSql && pendingCount > 0 && (
          <pre
            style={{
              margin: '12px 0 0',
              padding: 12,
              borderRadius: 8,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              fontSize: 12,
              overflowX: 'auto',
            }}
          >
            {settings?.pendingSql.join('\n\n')}
          </pre>
        )}

        {(settings?.schemaWarnings?.length ?? 0) > 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: '#fcd34d' }}>
            {settings!.schemaWarnings.map((w, i) => (
              <div key={i}>Warning: {w}</div>
            ))}
          </div>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>Features &amp; Integrations</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {integrationList.map((item) => (
            <span
              key={item.label}
              style={{
                padding: '6px 11px',
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 600,
                background: item.enabled ? 'var(--success-soft)' : 'var(--surface-alt)',
                color: item.enabled ? 'var(--success)' : 'var(--muted)',
              }}
            >
              {item.label}: {item.enabled ? 'Enabled' : 'Off'}
            </span>
          ))}
        </div>

        {settings?.integrations.smtp && (
          <form
            onSubmit={handleSendTestEmail}
            style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}
          >
            <input
              type="email"
              required
              value={testEmailTo}
              onChange={(e) => setTestEmailTo(e.target.value)}
              placeholder="Send test email to..."
              style={{ ...inputStyle, maxWidth: 280, height: 36 }}
            />
            <button type="submit" disabled={sendingEmail} style={secondaryBtnStyle}>
              {sendingEmail ? 'Sending...' : 'Send Test Email'}
            </button>
          </form>
        )}
      </section>

      <section style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h2 style={{ ...sectionTitleStyle, margin: 0 }}>Table Browser Visibility</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
              Show or hide soft-deleted rows (<code>deleted = 1</code>) in the Data tab.
            </p>
          </div>
          <ToggleSlider
            checked={showDeletedRows}
            onChange={(next) => {
              onToggleShowDeletedRows?.(next);
              onToast(
                next
                  ? 'Soft-deleted rows will be shown in Data.'
                  : 'Soft-deleted rows are now hidden in Data.',
                'info',
              );
            }}
            label="Show soft-deleted items"
          />
        </div>
      </section>

      <section style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h2 style={{ ...sectionTitleStyle, margin: 0 }}>Admin Session</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
              Sign out of this browser&apos;s admin console session.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => onLogout(false)} style={secondaryBtnStyle}>
              Sign Out
            </button>
            <button
              type="button"
              onClick={() => onLogout(true)}
              style={{ ...secondaryBtnStyle, color: 'var(--danger)' }}
            >
              Sign Out All Devices
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

const infoTileStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
