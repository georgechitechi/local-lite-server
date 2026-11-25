import { useCallback, useEffect, useState } from 'react';
import type { ToastType } from '@/components/Toast';
import { adminFetch } from '@/lib/api';
import {
  cardStyle,
  inputStyle,
  labelStyle,
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
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('admin');
  const [userId, setUserId] = useState('');
  const [expiresInDays, setExpiresInDays] = useState<string>('0');

  const [revealedKey, setRevealedKey] = useState<string | null>(null);

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      onToast('Enter a name for the API key', 'error');
      return;
    }
    setCreating(true);
    try {
      const res = await adminFetch('/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          role,
          userId: role === 'user' && userId.trim() ? userId.trim() : undefined,
          expiresInDays: Number(expiresInDays) || 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(data?.error || 'Failed to create API key', 'error');
        return;
      }
      setRevealedKey(data.key);
      setName('');
      setUserId('');
      onToast('API key created — copy it now, it will not be shown again', 'info');
      await loadKeys();
    } finally {
      setCreating(false);
    }
  };

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

  const copyText = async (text: string, label = 'Copied to clipboard') => {
    try {
      await navigator.clipboard.writeText(text);
      onToast(label, 'info');
    } catch {
      onToast('Copy failed — please copy manually', 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <h2 style={{ ...sectionTitleStyle, margin: 0 }}>Create API Key</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
              Authenticate requests to <code>/sync</code>, <code>/fn/*</code>, <code>/storage/*</code>, and{' '}
              <code>/subscribe/*</code> using <code>Authorization: Bearer &lt;key&gt;</code> or{' '}
              <code>X-API-Key: &lt;key&gt;</code>.
            </p>
          </div>
          <button type="button" onClick={() => void loadKeys()} disabled={loading} style={secondaryBtnStyle}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <form
          onSubmit={handleCreate}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            alignItems: 'end',
          }}
        >
          <div>
            <label style={labelStyle}>Key Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mobile Client"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Access Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value === 'user' ? 'user' : 'admin')}
              style={inputStyle}
            >
              <option value="admin">Admin (full access)</option>
              <option value="user">User (RLS-scoped)</option>
            </select>
          </div>

          {role === 'user' && (
            <div>
              <label style={labelStyle}>User ID (optional)</label>
              <input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="Defaults to api_key:<id>"
                style={inputStyle}
              />
            </div>
          )}

          <div>
            <label style={labelStyle}>Expiration</label>
            <select
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              style={inputStyle}
            >
              <option value="0">Never expires</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </select>
          </div>

          <div>
            <button type="submit" disabled={creating} style={{ ...primaryBtnStyle, width: '100%' }}>
              {creating ? 'Creating...' : 'Create API Key'}
            </button>
          </div>
        </form>

        {revealedKey && (
          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 8,
              border: '1px solid var(--accent)',
              background: 'rgba(59, 130, 246, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <strong style={{ fontSize: 13 }}>Save your new API key (shown once)</strong>
              <button type="button" onClick={() => setRevealedKey(null)} style={secondaryBtnStyle}>
                Dismiss
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <code
                style={{
                  flex: 1,
                  minWidth: 240,
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  fontSize: 13,
                  wordBreak: 'break-all',
                }}
              >
                {revealedKey}
              </code>
              <button
                type="button"
                onClick={() => void copyText(revealedKey, 'API key copied')}
                style={primaryBtnStyle}
              >
                Copy Key
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Example: <code>curl -H &quot;Authorization: Bearer {revealedKey}&quot; /sync?tables=notes</code>
            </div>
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <h2 style={sectionTitleStyle}>API Keys ({keys.length})</h2>
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
                        <code>{item.keyPrefix}…</code>
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
    </div>
  );
}
