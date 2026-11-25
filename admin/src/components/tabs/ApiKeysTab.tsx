import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiKeyDrawer } from '@/components/ApiKeyDrawer';
import { Card } from '@/components/Card';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { PaginationBar } from '@/components/PaginationBar';
import type { ToastType } from '@/components/Toast';
import { adminFetch } from '@/lib/api';
import { formatTime } from '@/lib/formatters';
import {
  inputStyle,
  primaryBtnStyle,
  secondaryBtnStyle,
} from '@/styles/adminStyles';
import type { ApiKeyItem } from '@/types/admin';

const PAGE_SIZE = 30;
type KeyFilter = 'all' | 'active' | 'revoked';

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
  const [filter, setFilter] = useState<KeyFilter>('all');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return keys.filter((item) => {
      const inactive = Boolean(item.revokedAt || (item.expiresAt && item.expiresAt <= Date.now()));
      if (filter === 'active' && inactive) return false;
      if (filter === 'revoked' && !inactive) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.keyPrefix.toLowerCase().includes(q) ||
        (item.userId || '').toLowerCase().includes(q)
      );
    });
  }, [keys, filter, search]);

  const safeOffset = offset >= filtered.length ? 0 : offset;
  const pageRows = filtered.slice(safeOffset, safeOffset + PAGE_SIZE);
  const hasPrev = safeOffset > 0;
  const hasNext = safeOffset + pageRows.length < filtered.length;

  const columns: DataTableColumn<ApiKeyItem>[] = [
    {
      header: 'Name',
      render: (item) => (
        <>
          <div style={{ fontWeight: 500 }}>{item.name}</div>
          {item.userId && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>userId: {item.userId}</div>
          )}
        </>
      ),
    },
    { header: 'Prefix', render: (item) => <code>{item.keyPrefix}</code> },
    {
      header: 'Role',
      render: (item) => (
        <span
          style={{
            fontSize: 11.5,
            padding: '2px 8px',
            borderRadius: 999,
            border: '1px solid var(--border)',
          }}
        >
          {item.role}
        </span>
      ),
    },
    {
      header: 'Status',
      render: (item) => {
        const st = keyStatus(item);
        return (
          <span
            style={{
              fontSize: 11.5,
              padding: '2px 8px',
              borderRadius: 999,
              color: st.color,
              background: st.bg,
              fontWeight: 600,
            }}
          >
            {st.label}
          </span>
        );
      },
    },
    {
      header: 'Last Used',
      cellStyle: { color: 'var(--muted)' },
      render: (item) => formatTime(item.lastUsedAt),
    },
    {
      header: 'Expires',
      cellStyle: { color: 'var(--muted)' },
      render: (item) => (item.expiresAt ? formatTime(item.expiresAt) : 'Never'),
    },
    {
      header: 'Actions',
      align: 'right',
      render: (item) => (
        <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
          {!item.revokedAt && (
            <button type="button" onClick={() => void handleRevoke(item)} style={secondaryBtnStyle}>
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
      ),
    },
  ];

  return (
    <>
      <Card
        title="API Keys"
        actions={
          <>
            <button type="button" onClick={() => void loadKeys()} disabled={loading} style={secondaryBtnStyle}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button type="button" onClick={() => setDrawerOpen(true)} style={primaryBtnStyle}>
              + Create API Key
            </button>
          </>
        }
        toolbar={
          <>
            <div style={{ display: 'flex', gap: 6 }}>
              {(
                [
                  ['all', 'All'],
                  ['active', 'Active'],
                  ['revoked', 'Revoked / Expired'],
                ] as Array<[KeyFilter, string]>
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
              placeholder="Search name or prefix..."
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
        <DataTable
          columns={columns}
          rows={pageRows}
          getRowKey={(item) => item.id}
          emptyMessage="No API keys match this filter."
        />

        <PaginationBar
          total={filtered.length}
          offset={safeOffset}
          count={pageRows.length}
          unit="key"
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrev={() => setOffset(Math.max(0, safeOffset - PAGE_SIZE))}
          onNext={() => setOffset(safeOffset + PAGE_SIZE)}
        />
      </Card>

      <ApiKeyDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={loadKeys}
        onToast={onToast}
      />
    </>
  );
}
