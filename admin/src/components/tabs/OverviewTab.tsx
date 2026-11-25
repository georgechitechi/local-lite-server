import { useMemo } from 'react';
import {
  cardStyle,
  labelStyle,
  secondaryBtnStyle,
  sectionTitleStyle,
  subLabelStyle,
} from '@/styles/adminStyles';
import type { OverviewData } from '@/types/admin';

export function OverviewTab({
  overview,
  onOpenTable,
  onOpenDataTab,
}: {
  overview: OverviewData | null;
  onOpenTable: (table: string) => void;
  onOpenDataTab: () => void;
}) {
  const totalRows = useMemo(
    () => (overview?.tableCounts ?? []).reduce((sum, t) => sum + t.count, 0),
    [overview],
  );

  return (
    <>
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 14,
          marginBottom: 22,
        }}
      >
        <div style={cardStyle}>
          <div style={labelStyle}>Database</div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: overview?.dbConnected ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {overview?.dbConnected ? 'Connected' : 'Disconnected'}
          </div>
          {overview?.dbError && (
            <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>
              {overview.dbError}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>Total Synced Rows</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {totalRows.toLocaleString()}
          </div>
          <div style={subLabelStyle}>
            Across {overview?.tableCounts.length ?? 0} tables
          </div>
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>Local Auth Accounts</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {overview?.accountsCount ?? 0}
          </div>
          <div style={subLabelStyle}>PBKDF2-SHA256 + OTP</div>
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>Backup Archives</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {overview?.backupsCount ?? 0}
          </div>
          <div style={subLabelStyle}>Stored on server</div>
        </div>
      </section>

      <section style={{ ...cardStyle, marginBottom: 22 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          <h2 style={{ ...sectionTitleStyle, margin: 0 }}>Table Row Counts</h2>
          <button
            type="button"
            onClick={onOpenDataTab}
            style={secondaryBtnStyle}
          >
            Open Data Browser
          </button>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
            gap: 10,
          }}
        >
          {(overview?.tableCounts ?? []).map((item) => (
            <button
              key={item.table}
              type="button"
              onClick={() => onOpenTable(item.table)}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 13,
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              <span style={{ color: 'var(--muted)' }}>{item.table}</span>
              <strong>{item.count}</strong>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
