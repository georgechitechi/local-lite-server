import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/Card';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import {
  type EnvDrawerMode,
  EnvVarDrawer,
  type EnvVarItem,
} from '@/components/EnvVarDrawer';
import { PaginationBar } from '@/components/PaginationBar';
import type { ToastType } from '@/components/Toast';
import { adminFetch } from '@/lib/api';
import {
  inputStyle,
  primaryBtnStyle,
  secondaryBtnStyle,
} from '@/styles/adminStyles';

const PAGE_SIZE = 30;
type SourceFilter = 'all' | 'database' | 'env';

export function EnvVarsTab({
  onToast,
  refreshSignal = 0,
}: {
  onToast: (msg: string, type?: ToastType) => void;
  refreshSignal?: number;
}) {
  const [vars, setVars] = useState<EnvVarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
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
  }, [loadEnvVars, refreshSignal]);

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

  const filteredVars = useMemo(() => {
    const query = search.trim().toUpperCase();
    return vars.filter((v) => {
      if (filter !== 'all' && v.source !== filter) return false;
      if (!query) return true;
      return (
        v.key.includes(query) ||
        (v.description || '').toUpperCase().includes(query)
      );
    });
  }, [vars, filter, search]);

  const safeOffset = offset >= filteredVars.length ? 0 : offset;
  const pageRows = filteredVars.slice(safeOffset, safeOffset + PAGE_SIZE);
  const hasPrev = safeOffset > 0;
  const hasNext = safeOffset + pageRows.length < filteredVars.length;

  const columns: DataTableColumn<EnvVarItem>[] = [
    {
      header: 'Key',
      cellStyle: { fontFamily: 'monospace', fontWeight: 600 },
      render: (item) => item.key,
    },
    {
      header: 'Value',
      cellStyle: {
        fontFamily: 'monospace',
        color: 'var(--muted)',
        maxWidth: 260,
        wordBreak: 'break-all',
      },
      render: (item) =>
        revealedValues[item.key] !== undefined ? revealedValues[item.key] : item.maskedValue,
    },
    {
      header: 'Source',
      render: (item) => (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 7px',
            borderRadius: 999,
            background: item.source === 'database' ? 'var(--success-soft)' : 'var(--surface-alt)',
            color: item.source === 'database' ? 'var(--success)' : 'var(--muted)',
          }}
        >
          {item.source === 'database' ? 'Database' : '.env'}
        </span>
      ),
    },
    {
      header: 'Description',
      cellStyle: { color: 'var(--muted)' },
      render: (item) => item.description || '—',
    },
    {
      header: 'Actions',
      align: 'right',
      render: (item) => {
        const isRevealed = revealedValues[item.key] !== undefined;
        return (
          <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
            {item.revealable && (
              <button type="button" onClick={() => void handleToggleReveal(item)} style={secondaryBtnStyle}>
                {isRevealed ? 'Hide' : 'Reveal'}
              </button>
            )}
            {!item.readonly && (
              <button type="button" onClick={() => void handleEdit(item)} style={secondaryBtnStyle}>
                Edit
              </button>
            )}
            {item.source === 'database' && !item.readonly && (
              <button
                type="button"
                onClick={() => void handleDelete(item.key)}
                style={{ ...secondaryBtnStyle, color: 'var(--danger)' }}
              >
                Delete
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <Card
        title="Environment Variables"
        actions={
          <button type="button" onClick={() => setDrawer({ kind: 'create' })} style={primaryBtnStyle}>
            + Add Variable
          </button>
        }
        toolbar={
          <>
            <div style={{ display: 'flex', gap: 6 }}>
              {(
                [
                  ['all', 'All'],
                  ['database', 'Database'],
                  ['env', '.env'],
                ] as Array<[SourceFilter, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setFilter(key);
                    setOffset(0);
                  }}
                  style={{
                    ...secondaryBtnStyle,
                    background: filter === key ? 'var(--accent-soft)' : 'transparent',
                    color: filter === key ? 'var(--accent)' : 'var(--muted)',
                    borderColor: filter === key ? 'var(--accent)' : 'var(--border)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Search key or description..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
              style={{ ...inputStyle, maxWidth: 260, padding: '7px 12px' }}
            />
          </>
        }
      >
        {loading && vars.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
            Loading environment variables...
          </p>
        ) : (
          <DataTable
            columns={columns}
            rows={pageRows}
            getRowKey={(item) => item.key}
            emptyMessage="No environment variables found."
          />
        )}

        <PaginationBar
          total={filteredVars.length}
          offset={safeOffset}
          count={pageRows.length}
          unit="variable"
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrev={() => setOffset(Math.max(0, safeOffset - PAGE_SIZE))}
          onNext={() => setOffset(safeOffset + PAGE_SIZE)}
        />
      </Card>

      <EnvVarDrawer
        drawer={drawer}
        onClose={() => setDrawer({ kind: 'closed' })}
        onSaved={handleSaved}
        onToast={onToast}
      />
    </>
  );
}
