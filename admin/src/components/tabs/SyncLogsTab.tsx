import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/Card';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { PaginationBar } from '@/components/PaginationBar';
import { adminFetch } from '@/lib/api';
import { formatTime } from '@/lib/formatters';
import { inputStyle } from '@/styles/adminStyles';
import type { SyncChangeRow } from '@/types/admin';

const PAGE_SIZE = 30;

interface LogsResponse {
  total: number;
  limit: number;
  offset: number;
  rows: SyncChangeRow[];
}

export function SyncLogsTab({
  tables,
  refreshSignal = 0,
}: {
  tables: string[];
  refreshSignal?: number;
}) {
  const [logTableFilter, setLogTableFilter] = useState('ALL');
  const [data, setData] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadLogs = useCallback(async (table: string, offset = 0) => {
    setLoading(true);
    try {
      const res = await adminFetch(
        `/admin/logs?table=${encodeURIComponent(table)}&limit=${PAGE_SIZE}&offset=${offset}`,
        { cache: 'no-store' },
      );
      if (res.ok) {
        setData((await res.json()) as LogsResponse);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLogs(logTableFilter, 0);
  }, [logTableFilter, loadLogs, refreshSignal]);

  const hasPrev = Boolean(!loading && data && data.offset > 0);
  const hasNext = Boolean(
    !loading &&
    data &&
    data.rows.length > 0 &&
    data.offset + data.rows.length < data.total,
  );

  const columns: DataTableColumn<SyncChangeRow>[] = [
    { header: 'Table', render: (c) => c.tableName },
    {
      header: 'Operation',
      render: (c) => (
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: c.operation === 'DELETE' ? 'var(--danger)' : 'var(--accent)',
          }}
        >
          {c.operation}
        </span>
      ),
    },
    {
      header: 'Row ID',
      cellStyle: { fontFamily: 'monospace', fontSize: 12 },
      render: (c) => c.rowId,
    },
    {
      header: 'Business ID',
      cellStyle: { fontFamily: 'monospace', fontSize: 12 },
      render: (c) => c.businessId || '—',
    },
    {
      header: 'Updated At',
      cellStyle: { color: 'var(--muted)' },
      render: (c) => formatTime(c.updatedAt),
    },
  ];

  return (
    <Card
      title="Recent Sync Changes"
      actions={
        <select
          value={logTableFilter}
          onChange={(e) => setLogTableFilter(e.target.value)}
          style={{
            ...inputStyle,
            width: 'auto',
            minWidth: 140,
            maxWidth: 200,
            height: 36,
          }}
        >
          <option value="ALL">All tables</option>
          {tables.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      }
    >
      {loading && !data ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          Loading sync logs...
        </p>
      ) : (
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          getRowKey={(c, idx) =>
            `${c.tableName}-${c.rowId}-${c.updatedAt}-${idx}`
          }
          emptyMessage="No sync changes recorded yet."
        />
      )}

      {data && (
        <PaginationBar
          total={data.total}
          offset={data.offset}
          count={data.rows.length}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrev={() =>
            void loadLogs(logTableFilter, Math.max(0, data.offset - PAGE_SIZE))
          }
          onNext={() => void loadLogs(logTableFilter, data.offset + PAGE_SIZE)}
        />
      )}
    </Card>
  );
}
