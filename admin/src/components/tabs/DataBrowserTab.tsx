import { useCallback, useEffect, useMemo, useState } from 'react';
import { PaginationBar } from '@/components/PaginationBar';
import {
  TableRowDrawer,
  type TableRowDrawerMode,
} from '@/components/TableRowDrawer';
import type { ToastType } from '@/components/Toast';
import { adminFetch } from '@/lib/api';
import {
  cardStyle,
  compactPrimaryBtnStyle,
  inputStyle,
  secondaryBtnStyle,
  tableStyle,
  tdStyle,
  thStyle,
} from '@/styles/adminStyles';
import type { TableBrowserData } from '@/types/admin';

const PAGE_SIZE = 30;

export function DataBrowserTab({
  tableCounts,
  selectedTable,
  showDeleted = false,
  onSelectTable,
  onRefreshOverview,
  onToast,
}: {
  tableCounts: Array<{ table: string; count: number }>;
  selectedTable: string;
  showDeleted?: boolean;
  onSelectTable: (table: string) => void;
  onRefreshOverview: () => Promise<void>;
  onToast: (msg: string, type?: ToastType) => void;
}) {
  const [tableFilter, setTableFilter] = useState('');
  const [tableData, setTableData] = useState<TableBrowserData | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState<Record<string, any> | null>(
    null,
  );
  const [rowDrawer, setRowDrawer] = useState<TableRowDrawerMode>({
    kind: 'closed',
  });

  const loadTable = useCallback(
    async (table: string, offset = 0) => {
      if (!table) return;
      setTableLoading(true);
      setSelectedRow(null);
      try {
        const res = await adminFetch(
          `/admin/table?table=${encodeURIComponent(table)}&limit=${PAGE_SIZE}&offset=${offset}&includeDeleted=${showDeleted ? '1' : '0'}`,
          { cache: 'no-store' },
        );
        if (res.ok) {
          setTableData((await res.json()) as TableBrowserData);
        }
      } finally {
        setTableLoading(false);
      }
    },
    [showDeleted],
  );

  useEffect(() => {
    if (selectedTable) {
      void loadTable(selectedTable, 0);
    }
  }, [selectedTable, loadTable]);

  const filteredTables = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    return tableCounts.filter((t) => t.table.toLowerCase().includes(q));
  }, [tableCounts, tableFilter]);

  const hasPrev = Boolean(!tableLoading && tableData && tableData.offset > 0);
  const hasNext = Boolean(
    !tableLoading &&
    tableData &&
    tableData.rows.length > 0 &&
    tableData.offset + tableData.rows.length < tableData.total,
  );

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '230px 1fr',
        gap: 16,
        alignItems: 'start',
      }}
    >
      <div style={cardStyle}>
        <input
          placeholder="Filter tables..."
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value)}
          style={{ ...inputStyle, height: 36, marginBottom: 10 }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filteredTables.map((t) => (
            <button
              key={t.table}
              type="button"
              onClick={() => onSelectTable(t.table)}
              style={{
                padding: '8px 10px',
                borderRadius: 7,
                border: 'none',
                background:
                  selectedTable === t.table
                    ? 'var(--accent-soft)'
                    : 'transparent',
                color:
                  selectedTable === t.table ? 'var(--text)' : 'var(--muted)',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span>{t.table}</span>
              <span>{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ ...cardStyle, minWidth: 0 }}>
        <div
          style={{
            marginBottom: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <strong style={{ fontSize: 15 }}>{selectedTable}</strong>
          {tableData && (
            <button
              type="button"
              onClick={() =>
                setRowDrawer({
                  kind: 'create',
                  table: selectedTable,
                  columns: tableData.columns,
                })
              }
              style={compactPrimaryBtnStyle}
            >
              + New Row
            </button>
          )}
        </div>

        {tableLoading ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading rows...</p>
        ) : tableData?.rows.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                  {tableData.columns.slice(0, 7).map((col) => (
                    <th key={col} style={thStyle}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableData.rows.map((row, idx) => (
                  <tr
                    key={String(row.id || idx)}
                    onClick={() => setSelectedRow(row)}
                    style={{
                      borderTop: '1px solid var(--border)',
                      cursor: 'pointer',
                      background:
                        selectedRow === row
                          ? 'var(--surface-alt)'
                          : 'transparent',
                    }}
                  >
                    {tableData.columns.slice(0, 7).map((col) => {
                      const val = row[col];
                      const display =
                        val == null
                          ? 'null'
                          : typeof val === 'object'
                            ? JSON.stringify(val)
                            : String(val);
                      return (
                        <td
                          key={col}
                          style={{
                            ...tdStyle,
                            maxWidth: 200,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontFamily: 'monospace',
                            fontSize: 12,
                          }}
                        >
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            No rows in {selectedTable}.
          </p>
        )}

        {selectedRow && (
          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 10,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
                fontSize: 12.5,
                color: 'var(--muted)',
                gap: 8,
              }}
            >
              <span>Row JSON Inspector</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {tableData && (
                  <button
                    type="button"
                    onClick={() =>
                      setRowDrawer({
                        kind: 'edit',
                        table: selectedTable,
                        columns: tableData.columns,
                        row: selectedRow,
                      })
                    }
                    style={secondaryBtnStyle}
                  >
                    Edit Row
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedRow(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: 12,
                overflowX: 'auto',
                lineHeight: 1.5,
              }}
            >
              {JSON.stringify(selectedRow, null, 2)}
            </pre>
          </div>
        )}

        {tableData && (
          <PaginationBar
            total={tableData.total}
            offset={tableData.offset}
            count={tableData.rows.length}
            hasPrev={hasPrev}
            hasNext={hasNext}
            onPrev={() =>
              void loadTable(
                selectedTable,
                Math.max(0, tableData.offset - PAGE_SIZE),
              )
            }
            onNext={() =>
              void loadTable(selectedTable, tableData.offset + PAGE_SIZE)
            }
          />
        )}
      </div>

      <TableRowDrawer
        drawer={rowDrawer}
        onClose={() => setRowDrawer({ kind: 'closed' })}
        onSaved={async () => {
          setSelectedRow(null);
          await Promise.all([
            loadTable(selectedTable, tableData?.offset ?? 0),
            onRefreshOverview(),
          ]);
        }}
        onToast={onToast}
      />
    </div>
  );
}
