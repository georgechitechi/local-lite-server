import { useEffect, useState } from 'react';
import { Card } from '@/components/Card';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { PaginationBar } from '@/components/PaginationBar';
import type { ToastType } from '@/components/Toast';
import { adminFetch } from '@/lib/api';
import { formatBytes, formatTime } from '@/lib/formatters';
import { primaryBtnStyle, secondaryBtnStyle } from '@/styles/adminStyles';
import type { BackupArchiveRow } from '@/types/admin';

const PAGE_SIZE = 30;

export function BackupsTab({
  backups,
  onRefresh,
  onToast,
}: {
  backups: BackupArchiveRow[];
  onRefresh: () => Promise<void>;
  onToast: (msg: string, type?: ToastType) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    fileName: string;
    jsonText: string;
  } | null>(null);

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preview]);

  const safeOffset = offset >= backups.length ? 0 : offset;
  const pageRows = backups.slice(safeOffset, safeOffset + PAGE_SIZE);
  const hasPrev = safeOffset > 0;
  const hasNext = safeOffset + pageRows.length < backups.length;

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await adminFetch('/admin/backups', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(data?.error || `Backup failed (${res.status})`, 'error');
        return;
      }
      onToast(
        data?.summary ||
          `Created backup ${data.backup?.fileName || ''} (${data.backup?.recordCount ?? 0} records).`,
        'info',
      );
      await onRefresh();
    } finally {
      setCreating(false);
    }
  };

  const handleView = async (fileName: string) => {
    setBusyFile(fileName);
    try {
      const res = await adminFetch(
        `/admin/backups?file=${encodeURIComponent(fileName)}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        onToast(data?.error || `Preview failed (${res.status})`, 'error');
        return;
      }
      const raw = await res.text();
      let formatted = raw;
      try {
        formatted = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        // Keep raw text if already formatted or non-JSON
      }
      setPreview({ fileName, jsonText: formatted });
    } finally {
      setBusyFile(null);
    }
  };

  const handleDownload = async (fileName: string) => {
    setBusyFile(fileName);
    try {
      const res = await adminFetch(
        `/admin/backups?file=${encodeURIComponent(fileName)}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        onToast(data?.error || `Download failed (${res.status})`, 'error');
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } finally {
      setBusyFile(null);
    }
  };

  const handleDelete = async (fileName: string) => {
    if (!window.confirm(`Delete backup ${fileName}?`)) return;
    setBusyFile(fileName);
    try {
      const res = await adminFetch(
        `/admin/backups?file=${encodeURIComponent(fileName)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        onToast(data?.error || `Delete failed (${res.status})`, 'error');
        return;
      }
      onToast(`Deleted ${fileName}.`, 'info');
      await onRefresh();
    } finally {
      setBusyFile(null);
    }
  };

  const columns: DataTableColumn<BackupArchiveRow>[] = [
    {
      header: 'File',
      cellStyle: { fontFamily: 'monospace' },
      render: (b) => b.fileName,
    },
    {
      header: 'Status',
      cellStyle: { color: 'var(--success)' },
      render: (b) => b.status,
    },
    {
      header: 'Size',
      render: (b) => formatBytes(b.sizeBytes),
    },
    {
      header: 'Modified',
      cellStyle: { color: 'var(--muted)' },
      render: (b) => formatTime(b.createdAt),
    },
    {
      header: 'Actions',
      align: 'right',
      render: (b) => (
        <div
          style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}
        >
          <button
            type="button"
            disabled={busyFile === b.fileName}
            onClick={() => void handleView(b.fileName)}
            style={secondaryBtnStyle}
          >
            View
          </button>
          <button
            type="button"
            disabled={busyFile === b.fileName}
            onClick={() => void handleDownload(b.fileName)}
            style={secondaryBtnStyle}
          >
            Download
          </button>
          <button
            type="button"
            disabled={busyFile === b.fileName}
            onClick={() => void handleDelete(b.fileName)}
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
      title="Server Backup Archives"
      actions={
        <button
          type="button"
          disabled={creating}
          onClick={() => void handleCreate()}
          style={primaryBtnStyle}
        >
          {creating ? 'Creating Backup...' : '+ Create Backup'}
        </button>
      }
    >
      <DataTable
        columns={columns}
        rows={pageRows}
        getRowKey={(b) => b.id}
        emptyMessage="No backup files stored in the server backups directory yet."
      />

      <PaginationBar
        total={backups.length}
        offset={safeOffset}
        count={pageRows.length}
        unit="archive"
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={() => setOffset(Math.max(0, safeOffset - PAGE_SIZE))}
        onNext={() => setOffset(safeOffset + PAGE_SIZE)}
      />

      {preview && (
        <div
          onClick={() => setPreview(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            zIndex: 55,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 640,
              height: '100%',
              background: 'var(--surface)',
              borderLeft: '1px solid var(--border)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.45)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--border)',
                paddingBottom: 12,
                gap: 8,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <h3
                  style={{
                    margin: 0,
                    fontSize: 16,
                    fontWeight: 700,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {preview.fileName}
                </h3>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(preview.jsonText);
                    onToast('Copied backup JSON.', 'info');
                  }}
                  style={secondaryBtnStyle}
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  style={secondaryBtnStyle}
                >
                  Close
                </button>
              </div>
            </div>

            <pre
              style={{
                margin: 0,
                flex: 1,
                overflow: 'auto',
                padding: 14,
                borderRadius: 8,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                fontFamily: 'monospace',
                fontSize: 12,
                lineHeight: 1.5,
                color: 'var(--text)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {preview.jsonText}
            </pre>
          </aside>
        </div>
      )}
    </Card>
  );
}
