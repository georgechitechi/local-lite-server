import { useCallback, useEffect, useState } from 'react';
import { ToggleSlider } from '@/components/ToggleSlider';
import type { ToastType } from '@/components/Toast';
import { adminFetch, getApiBaseUrl } from '@/lib/api';
import {
  cardStyle,
  secondaryBtnStyle,
  sectionTitleStyle,
} from '@/styles/adminStyles';

interface SettingsData {
  mode: string;
  remoteServerUrl: string | null;
  dbHost: string | null;
  dbPort: string;
  dbName: string | null;
  nodeVersion: string;
  uptimeSeconds: number;
  integrations: {
    appSecret: boolean;
    smtp: boolean;
    googleOAuth: boolean;
    githubOAuth: boolean;
  };
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

  const integrationList: Array<{ label: string; enabled: boolean }> = settings
    ? [
        { label: 'APP_SECRET', enabled: settings.integrations.appSecret },
        { label: 'SMTP Email', enabled: settings.integrations.smtp },
        { label: 'Google OAuth', enabled: settings.integrations.googleOAuth },
        { label: 'GitHub OAuth', enabled: settings.integrations.githubOAuth },
      ]
    : [];

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
            <p
              style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}
            >
              Active server endpoint and runtime details.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleTestHealth()}
            disabled={testing}
            style={secondaryBtnStyle}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
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
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 10,
            fontSize: 13,
          }}
        >
          <div style={infoTileStyle}>
            <span style={{ color: 'var(--muted)' }}>API Base</span>
            <strong style={{ fontFamily: 'monospace', fontSize: 12 }}>
              {getApiBaseUrl() || settings?.remoteServerUrl || '—'}
            </strong>
          </div>
          <div style={infoTileStyle}>
            <span style={{ color: 'var(--muted)' }}>Database</span>
            <strong style={{ fontFamily: 'monospace', fontSize: 12 }}>
              {settings?.dbName
                ? `${settings.dbName} (${settings.dbHost}:${settings.dbPort})`
                : '—'}
            </strong>
          </div>
          <div style={infoTileStyle}>
            <span style={{ color: 'var(--muted)' }}>Node.js</span>
            <strong>{settings?.nodeVersion || '—'}</strong>
          </div>
          <div style={infoTileStyle}>
            <span style={{ color: 'var(--muted)' }}>Uptime</span>
            <strong>{settings ? `${settings.uptimeSeconds}s` : '—'}</strong>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>Configured Server Integrations</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {integrationList.map((item) => (
            <span
              key={item.label}
              style={{
                padding: '6px 11px',
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 600,
                background: item.enabled
                  ? 'var(--success-soft)'
                  : 'var(--surface-alt)',
                color: item.enabled ? 'var(--success)' : 'var(--muted)',
              }}
            >
              {item.label}: {item.enabled ? 'Configured' : 'Not set'}
            </span>
          ))}
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
            <p
              style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}
            >
              Sign out of this browser&apos;s admin console session.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => onLogout(false)}
              style={secondaryBtnStyle}
            >
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
            <h2 style={{ ...sectionTitleStyle, margin: 0 }}>
              Table Browser Visibility
            </h2>
            <p
              style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}
            >
              Show or hide soft-deleted rows (<code>deleted = 1</code>) in the
              Tables tab.
            </p>
          </div>
          <ToggleSlider
            checked={showDeletedRows}
            onChange={(next) => {
              onToggleShowDeletedRows?.(next);
              onToast(
                next
                  ? 'Soft-deleted rows will be shown in Tables.'
                  : 'Soft-deleted rows are now hidden in Tables.',
                'info',
              );
            }}
            label="Show soft-deleted items"
          />
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
