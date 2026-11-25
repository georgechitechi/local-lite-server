import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type EnvDrawerMode,
  EnvVarDrawer,
  type EnvVarItem,
} from '@/components/EnvVarDrawer';
import type { ToastType } from '@/components/Toast';
import { adminFetch } from '@/lib/api';
import {
  cardStyle,
  primaryBtnStyle,
  inputStyle,
  secondaryBtnStyle,
  sectionTitleStyle,
  tableStyle,
  tdStyle,
  thStyle,
} from '@/styles/adminStyles';

export function EnvVarsTab({
  onToast,
}: {
  onToast: (msg: string, type?: ToastType) => void;
}) {
  const [vars, setVars] = useState<EnvVarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>(
    {},
  );
  const [drawer, setDrawer] = useState<EnvDrawerMode>({ kind: 'closed' });
  const revealTimersRef = useRef<Record<string, number>>({});

  const clearRevealedKey = useCallback((key: string) => {
    const timerId = revealTimersRef.current[key];
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      delete revealTimersRef.current[key];
    }
    setRevealedValues((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      for (const timerId of Object.values(revealTimersRef.current)) {
        window.clearTimeout(timerId);
      }
      revealTimersRef.current = {};
    };
  }, []);

  const loadEnvVars = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch('/admin/env', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { vars?: EnvVarItem[] };
        setVars(data.vars || []);
      } else {
        const data = await res.json().catch(() => ({}));
        onToast(
          data?.error || `Failed to load environment variables (${res.status})`,
          'error',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadEnvVars();
  }, [loadEnvVars]);

  const handleToggleReveal = async (item: EnvVarItem) => {
    if (revealedValues[item.key] !== undefined) {
      clearRevealedKey(item.key);
      return;
    }
    const res = await adminFetch('/admin/env', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reveal', key: item.key }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      onToast(data?.error || 'Unable to reveal variable.', 'error');
      return;
    }
    setRevealedValues((prev) => ({ ...prev, [item.key]: data.value ?? '' }));
    const prevTimer = revealTimersRef.current[item.key];
    if (prevTimer !== undefined) {
      window.clearTimeout(prevTimer);
    }
    revealTimersRef.current[item.key] = window.setTimeout(() => {
      clearRevealedKey(item.key);
    }, 30_000);
  };

  const handleEdit = async (item: EnvVarItem) => {
    let initialValue = revealedValues[item.key];
    if (initialValue === undefined && item.revealable) {
      const res = await adminFetch('/admin/env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reveal', key: item.key }),
      });
      const data = await res.json().catch(() => ({}));
      initialValue = res.ok ? (data.value ?? '') : '';
    }
    setDrawer({
      kind: 'edit',
      item,
      initialValue: initialValue ?? '',
    });
  };

  const handleDelete = async (key: string) => {
    const res = await adminFetch(`/admin/env?key=${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      onToast(data?.error || 'Failed to delete environment variable.', 'error');
      return;
    }
    onToast(
      data.restoredFromEnv
        ? `Removed DB override for ${key} (restored .env fallback).`
        : `Deleted ${key}.`,
      'info',
    );
    clearRevealedKey(key);
    await loadEnvVars();
  };

  const handleSaved = (key: string) => {
    clearRevealedKey(key);
    void loadEnvVars();
  };

  const query = search.trim().toUpperCase();
  const filteredVars = query
    ? vars.filter(
        (v) =>
          v.key.includes(query) ||
          (v.description || '').toUpperCase().includes(query),
      )
    : vars;

  return (
    <>
      <section style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h2 style={{ ...sectionTitleStyle, margin: 0 }}>
              Environment Variables
            </h2>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              {vars.length} variable{vars.length === 1 ? '' : 's'} • encrypted
              in database and synced live
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Filter by key or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...inputStyle, width: 240, height: 34 }}
            />
            <button
              type="button"
              onClick={() => void loadEnvVars()}
              disabled={loading}
              style={secondaryBtnStyle}
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={() => setDrawer({ kind: 'create' })}
              style={primaryBtnStyle}
            >
              Add Variable
            </button>
          </div>
        </div>

        {filteredVars.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: 12 }}>
            {loading
              ? 'Loading environment variables...'
              : 'No environment variables found.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                  <th style={thStyle}>Key</th>
                  <th style={thStyle}>Value</th>
                  <th style={thStyle}>Source</th>
                  <th style={thStyle}>Description</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredVars.map((item) => {
                  const isRevealed = revealedValues[item.key] !== undefined;
                  const displayValue = isRevealed
                    ? revealedValues[item.key]
                    : item.maskedValue;
                  return (
                    <tr
                      key={item.key}
                      style={{ borderTop: '1px solid var(--border)' }}
                    >
                      <td
                        style={{
                          ...tdStyle,
                          fontFamily: 'monospace',
                          fontWeight: 600,
                        }}
                      >
                        {item.key}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          fontFamily: 'monospace',
                          color: 'var(--muted)',
                          maxWidth: 260,
                          wordBreak: 'break-all',
                        }}
                      >
                        {displayValue}
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 7px',
                            borderRadius: 999,
                            background:
                              item.source === 'database'
                                ? 'var(--success-soft)'
                                : 'var(--surface-alt)',
                            color:
                              item.source === 'database'
                                ? 'var(--success)'
                                : 'var(--muted)',
                          }}
                        >
                          {item.source === 'database' ? 'Database' : '.env'}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--muted)' }}>
                        {item.description || '—'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <div
                          style={{
                            display: 'inline-flex',
                            gap: 6,
                            justifyContent: 'flex-end',
                          }}
                        >
                          {item.revealable && (
                            <button
                              type="button"
                              onClick={() => void handleToggleReveal(item)}
                              style={secondaryBtnStyle}
                            >
                              {isRevealed ? 'Hide' : 'Reveal'}
                            </button>
                          )}
                          {!item.readonly && (
                            <button
                              type="button"
                              onClick={() => void handleEdit(item)}
                              style={secondaryBtnStyle}
                            >
                              Edit
                            </button>
                          )}
                          {item.source === 'database' && !item.readonly && (
                            <button
                              type="button"
                              onClick={() => void handleDelete(item.key)}
                              style={{
                                ...secondaryBtnStyle,
                                color: 'var(--danger)',
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <EnvVarDrawer
        drawer={drawer}
        onClose={() => setDrawer({ kind: 'closed' })}
        onSaved={handleSaved}
        onToast={onToast}
      />
    </>
  );
}
