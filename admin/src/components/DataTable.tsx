import type React from 'react';
import { EmptyState } from '@/components/EmptyState';
import { tableStyle, tdStyle, thStyle } from '@/styles/adminStyles';

export interface DataTableColumn<T> {
  header: string;
  align?: 'left' | 'right';
  cellStyle?: React.CSSProperties;
  render: (row: T, index: number) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  emptyMessage = 'No records found.',
  emptyDescription,
  emptyAction,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title={emptyMessage}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
            {columns.map((col) => (
              <th
                key={col.header}
                style={{
                  ...thStyle,
                  ...(col.align === 'right' ? { textAlign: 'right' } : null),
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={getRowKey(row, idx)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{
                borderTop: '1px solid var(--border)',
                cursor: onRowClick ? 'pointer' : undefined,
              }}
            >
              {columns.map((col) => (
                <td
                  key={col.header}
                  style={{
                    ...tdStyle,
                    ...(col.align === 'right' ? { textAlign: 'right' } : null),
                    ...col.cellStyle,
                  }}
                >
                  {col.render(row, idx)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
