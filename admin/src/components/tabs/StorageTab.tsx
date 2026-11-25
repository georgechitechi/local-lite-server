import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/Card';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { PaginationBar } from '@/components/PaginationBar';
import { StorageBucketDrawer } from '@/components/StorageBucketDrawer';
import type { ToastType } from '@/components/Toast';
import { adminFetch, buildApiUrl } from '@/lib/api';
import { formatBytes, formatTime } from '@/lib/formatters';
import {
  primaryBtnStyle,
  secondaryBtnStyle,
} from '@/styles/adminStyles';

interface StorageFileRow {
  id: string;
  storage_key: string;
  user_id: string | null;
  business_id: string | null;
  name: string;
  mime_type: string;
  size_bytes: number;
  source: 'app' | 'public';
  bucket?: string;
  created_at: number;
}

interface StorageBucket {
  id: string;
  name: string;
  visibility: 'public' | 'private';
  createdAt: number;
  fileCount: number;
  totalBytes: number;
}

const PAGE_SIZE = 50;

export function StorageTab({
  onToast,
}: {
  onToast: (msg: string, type?: ToastType) => void;
}) {
  const [files, setFiles] = useState<StorageFileRow[]>([]);
  const [buckets, setBuckets] = useState<StorageBucket[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<string>('all');
  const [totalFiles, setTotalFiles] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pruning, setPruning] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showCreateBucket, setShowCreateBucket] = useState(false);

  const loadStorage = useCallback(
    async (nextOffset = offset, nextBucket = selectedBucket) => {
      setLoading(true);
      try {
        const bucketParam =
          nextBucket && nextBucket !== 'all'
            ? `&bucket=${encodeURIComponent(nextBucket)}`
            : '';
        const res = await adminFetch(
          `/admin/storage?limit=${PAGE_SIZE}&offset=${nextOffset}${bucketParam}`,
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          onToast(
            data?.error || `Failed to load storage (${res.status})`,
            'error',
          );
          return;
        }
        setFiles(Array.isArray(data.files) ? data.files : []);
        setBuckets(Array.isArray(data.buckets) ? data.buckets : []);
        setTotalFiles(Number(data.totalFiles ?? 0));
        setTotalBytes(Number(data.totalBytes ?? 0));
      } finally {
        setLoading(false);
      }
    },
    [offset, selectedBucket, onToast],
  );

  useEffect(() => {
    void loadStorage(offset, selectedBucket);
  }, [offset, selectedBucket, loadStorage]);

  const handleDeleteBucket = async (bucketName: string) => {
    if (!window.confirm(`Delete empty bucket "${bucketName}"?`)) return;
    setBusyKey(`bucket:${bucketName}`);
    try {
      const res = await adminFetch(
        `/admin/storage?bucket=${encodeURIComponent(bucketName)}`,
        { method: 'DELETE' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(data?.error || `Delete bucket failed (${res.status})`, 'error');
        return;
      }
      onToast(`Deleted bucket "${bucketName}".`, 'info');
      const nextBucket = selectedBucket === bucketName ? 'all' : selectedBucket;
      setSelectedBucket(nextBucket);
      setOffset(0);
      await loadStorage(0, nextBucket);
    } finally {
      setBusyKey(null);
    }
  };

  const handlePrune = async () => {
    setPruning(true);
    try {
      const res = await adminFetch('/admin/crons?job=storage_orphan_prune', {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(data?.error || `Prune failed (${res.status})`, 'error');
        return;
      }
      onToast(
        data.summary ||
          `Pruned ${data.removedDbRows ?? 0} DB row(s) and ${data.removedDiskFiles ?? 0} orphaned file(s).`,
        'info',
      );
      await loadStorage(offset);
    } finally {
      setPruning(false);
    }
  };

  const handleDelete = async (key: string) => {
    if (!window.confirm(`Delete "${key}" from server storage?`)) return;
    setBusyKey(key);
    try {
      const res = await adminFetch(
        `/admin/storage?key=${encodeURIComponent(key)}`,
        { method: 'DELETE' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(data?.error || `Delete failed (${res.status})`, 'error');
        return;
      }
      onToast(`Deleted ${key}`, 'info');
      await loadStorage(offset);
    } finally {
      setBusyKey(null);
    }
  };

  const getFileUrl = (row: StorageFileRow) => {
    if (row.source === 'public') {
      return buildApiUrl(`/public/files/${encodeURI(row.storage_key)}`);
    }
    const bucket = row.bucket?.trim();
    const keyPath =
      bucket && !row.storage_key.startsWith(`${bucket}/`)
        ? `${bucket}/${row.storage_key}`
        : row.storage_key;
    return buildApiUrl(`/storage/files/${encodeURI(keyPath)}`);
  };

  const hasPrev = offset > 0;
  const hasNext = offset + files.length < totalFiles;

  const columns: DataTableColumn<StorageFileRow>[] = [
    {
      header: 'Key',
      cellStyle: {
        fontFamily: 'monospace',
        maxWidth: 220,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      render: (row) => <span title={row.storage_key}>{row.storage_key}</span>,
    },
    { header: 'Bucket', render: (row) => row.bucket || 'public' },
    { header: 'Source', render: (row) => row.source },
    {
      header: 'Type',
      cellStyle: { color: 'var(--muted)' },
      render: (row) => row.mime_type,
    },
    { header: 'Size', render: (row) => formatBytes(row.size_bytes) },
    {
      header: 'Uploaded',
      cellStyle: { color: 'var(--muted)' },
      render: (row) => formatTime(row.created_at),
    },
    {
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
          <a
            href={getFileUrl(row)}
            target="_blank"
            rel="noreferrer"
            style={{
              ...secondaryBtnStyle,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            View
          </a>
          <button
            type="button"
            disabled={busyKey === row.storage_key}
            onClick={() => void handleDelete(row.storage_key)}
            style={{ ...secondaryBtnStyle, color: 'var(--danger)' }}
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <Card
      title="Server Storage"
      subtitle={
        <>
          {totalFiles} file{totalFiles === 1 ? '' : 's'} • {formatBytes(totalBytes)} total in{' '}
          <code>server/uploads/</code>
        </>
      }
      actions={
        <>
          <button
            type="button"
            onClick={() => setShowCreateBucket(true)}
            style={secondaryBtnStyle}
          >
            + Create Bucket
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadStorage(offset, selectedBucket)}
            style={secondaryBtnStyle}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button
            type="button"
            disabled={pruning}
            onClick={() => void handlePrune()}
            style={primaryBtnStyle}
          >
            {pruning ? 'Pruning...' : 'Prune Orphans'}
          </button>
        </>
      }
    >
      <StorageBucketDrawer
        open={showCreateBucket}
        onClose={() => setShowCreateBucket(false)}
        onCreated={async (createdName) => {
          setSelectedBucket(createdName);
          setOffset(0);
          await loadStorage(0, createdName);
        }}
        onToast={onToast}
      />

      {buckets.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 14,
          }}
        >
          <button
            type="button"
            onClick={() => {
              setSelectedBucket('all');
              setOffset(0);
            }}
            style={{
              ...secondaryBtnStyle,
              borderColor:
                selectedBucket === 'all' ? 'var(--accent)' : 'var(--border)',
              color: selectedBucket === 'all' ? 'var(--accent)' : 'var(--text)',
            }}
          >
            All Buckets
          </button>
          {buckets.map((b) => {
            const active = selectedBucket === b.name;
            const canDelete =
              b.name !== 'public' && b.name !== 'private' && b.fileCount === 0;
            return (
              <div
                key={b.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  borderRadius: 8,
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: 'var(--surface-alt)',
                  fontSize: 12.5,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBucket(b.name);
                    setOffset(0);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: active ? 'var(--accent)' : 'var(--text)',
                    fontWeight: active ? 600 : 500,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span>{b.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    ({b.visibility} • {b.fileCount})
                  </span>
                </button>
                {canDelete && (
                  <button
                    type="button"
                    title={`Delete empty bucket ${b.name}`}
                    disabled={busyKey === `bucket:${b.name}`}
                    onClick={() => void handleDeleteBucket(b.name)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '0 2px',
                      color: 'var(--danger)',
                      cursor: 'pointer',
                      fontSize: 13,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loading && files.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          Loading storage files...
        </p>
      ) : (
        <DataTable
          columns={columns}
          rows={files}
          getRowKey={(row) => row.id}
          emptyMessage="No stored files yet."
        />
      )}

      <PaginationBar
        offset={offset}
        count={files.length}
        total={totalFiles}
        unit="file"
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        onNext={() => setOffset(offset + PAGE_SIZE)}
      />
    </Card>
  );
}
