import { useCallback, useEffect, useState } from 'react';
import { ApiKeyDrawer } from '@/components/ApiKeyDrawer';
import type { ToastType } from '@/components/Toast';
import { adminFetch } from '@/lib/api';
import {
  cardStyle,
  primaryBtnStyle,
  secondaryBtnStyle,
  sectionTitleStyle,
  tableStyle,
  tdStyle,
  thStyle,
} from '@/styles/adminStyles';
import type { ApiKeyItem } from '@/types/admin';

function formatDate(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

function keyStatus(item: ApiKeyItem): { label: string; color: string; bg: string } {
  if (item.revokedAt) {
    return { label: 'Revoked', color: 'var(--danger)', bg: 'var(--danger-soft)' };
  }
  if (item.expiresAt && item.expiresAt <= Date.now()) {
    return { label: 'Expired', color: 'var(--danger)', bg: 'var(--danger-soft)' };
  }
  return { label: 'Active', color: 'var(--success)', bg: 'var(--success-soft)' };
}

export function ApiKeysTab({
  onToast,
}: {
  onToast: (msg: string, type?: ToastType) => void;
}) {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch('/admin/api-keys', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { keys?: ApiKeyItem[] };
        setKeys(data.keys ?? []);
      } else {
        const data = await res.json().catch(() => ({}));
        onToast(data?.error || `Failed to load API keys (${res.status})`, 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const handleRevoke = async (item: ApiKeyItem) => {
    const res = await adminFetch('/admin/api-keys', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, action: 'revoke' }),
    });
    if (res.ok) {
      onToast(`Revoked "${item.name}"`, 'info');
      await loadKeys();
    } else {
      const data = await res.json().catch(() => ({}));
      onToast(data?.error || 'Failed to revoke key', 'error');
    }
  };

  const handleDelete = async (item: ApiKeyItem) => {
    const res = await adminFetch(`/admin/api-keys?id=${encodeURIComponent(item.id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      onToast(`Deleted "${item.name}"`, 'info');
      await loadKeys();
    } else {
      const data = await res.json().catch(() => ({}));
      onToast(data?.error || 'Failed to delete key', 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={cardStyle}>
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
            <h2 style={{ ...sectionTitleStyle, margin: 0 }}>API Keys ({keys.length})</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
              Authenticate requests to <code>/sync</code>, <code>/fn/*</code>, <code>/storage/*</code>, and{' '}
              <code>/subscribe/*</code> using <code>Authorization: Bearer &lt;key&gt;</code> or{' '}
              <code>X-API-Key: &lt;key&gt;</code>.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => void loadKeys()} disabled={loading} style={secondaryBtnStyle}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button type="button" onClick={() => setDrawerOpen(true)} style={primaryBtnStyle}>
              + Create API Key
            </button>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Prefix</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Last Used</th>
                <th style={thStyle}>Expires</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...tdStyle, color: 'var(--muted)', textAlign: 'center', padding: 24 }}>
                    No API keys created yet.
                  </td>
                </tr>
              ) : (
                keys.map((item) => {
                  const st = keyStatus(item);
                  return (
                    <tr key={item.id}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{item.name}</div>
                        {item.userId && (
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>userId: {item.userId}</div>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <code>{item.keyPrefix}</code>
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            fontSize: 12,
                            padding: '2px 8px',
                            borderRadius: 999,
                            border: '1px solid var(--border)',
                          }}
                        >
                          {item.role}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            fontSize: 12,
                            padding: '2px 8px',
                            borderRadius: 999,
                            color: st.color,
                            background: st.bg,
                            fontWeight: 600,
                          }}
                        >
                          {st.label}
                        </span>
                      </td>
                      <td style={tdStyle}>{formatDate(item.lastUsedAt)}</td>
                      <td style={tdStyle}>{item.expiresAt ? formatDate(item.expiresAt) : 'Never'}</td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {!item.revokedAt && (
                            <button
                              type="button"
                              onClick={() => void handleRevoke(item)}
                              style={secondaryBtnStyle}
                            >
                              Revoke
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleDelete(item)}
                            style={{ ...secondaryBtnStyle, color: 'var(--danger)' }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ApiKeyDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={loadKeys}
        onToast={onToast}
      />
    </div>
  );
}
