import { useCallback, useEffect, useState } from 'react';
import { PaginationBar } from '@/components/PaginationBar';
import { adminFetch } from '@/lib/api';
import { formatTime } from '@/lib/formatters';
import {
  cardStyle,
  inputStyle,
  sectionTitleStyle,
  tableStyle,
  tdStyle,
  thStyle,
} from '@/styles/adminStyles';
import type { SyncChangeRow } from '@/types/admin';

const PAGE_SIZE = 30;

interface LogsResponse {
  total: number;
  limit: number;
  offset: number;
  rows: SyncChangeRow[];
}

export function SyncLogsTab({ tables }: { tables: string[] }) {
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
  }, [logTableFilter, loadLogs]);

  const hasPrev = Boolean(!loading && data && data.offset > 0);
  const hasNext = Boolean(
    !loading &&
    data &&
    data.rows.length > 0 &&
    data.offset + data.rows.length < data.total,
  );

  return (
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
        <h2 style={{ ...sectionTitleStyle, margin: 0 }}>Recent Sync Changes</h2>
        <select
          value={logTableFilter}
          onChange={(e) => setLogTableFilter(e.target.value)}
          style={{ ...inputStyle, width: 180, height: 36 }}
        >
          <option value="ALL">All tables</option>
          {tables.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {loading && !data ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          Loading sync logs...
        </p>
      ) : data?.rows.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                <th style={thStyle}>Table</th>
                <th style={thStyle}>Operation</th>
                <th style={thStyle}>Row ID</th>
                <th style={thStyle}>Business ID</th>
                <th style={thStyle}>Updated At</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((c, idx) => (
                <tr
                  key={`${c.tableName}-${c.rowId}-${c.updatedAt}-${idx}`}
                  style={{ borderTop: '1px solid var(--border)' }}
                >
                  <td style={tdStyle}>{c.tableName}</td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        color:
                          c.operation === 'DELETE'
                            ? 'var(--danger)'
                            : 'var(--accent)',
                      }}
                    >
                      {c.operation}
                    </span>
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      fontFamily: 'monospace',
                      fontSize: 12,
                    }}
                  >
                    {c.rowId}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      fontFamily: 'monospace',
                      fontSize: 12,
                    }}
                  >
                    {c.businessId || '—'}
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--muted)' }}>
                    {formatTime(c.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          No sync changes recorded yet.
        </p>
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
    </section>
  );
}
