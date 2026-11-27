import { useMemo } from 'react';
import {
  cardStyle,
  labelStyle,
  primaryBtnStyle,
  secondaryBtnStyle,
  sectionTitleStyle,
  subLabelStyle,
} from '@/styles/adminStyles';
import type { OverviewData, ProjectItem } from '@/types/admin';

export function OverviewTab({
  overview,
  activeProject,
  onOpenTable,
  onOpenDataTab,
  onOpenProjects,
}: {
  overview: OverviewData | null;
  activeProject: ProjectItem | null;
  onOpenTable: (table: string) => void;
  onOpenDataTab: () => void;
  onOpenProjects: () => void;
}) {
  const totalRows = useMemo(
    () => (overview?.tableCounts ?? []).reduce((sum, t) => sum + t.count, 0),
    [overview],
  );
  const needsFirstProject = overview?.consoleRole !== 'super_admin' && !activeProject;

  return (
    <>
      {needsFirstProject && (
        <section
          style={{
            ...cardStyle,
            marginBottom: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h2 style={{ ...sectionTitleStyle, margin: '0 0 4px' }}>
              Create Your First Project
            </h2>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Each project gets isolated SQL tables, sync endpoint, auth users, file storage, and API keys.
            </div>
          </div>
          <button type="button" onClick={onOpenProjects} style={primaryBtnStyle}>
            + New Project
          </button>
        </section>
      )}

      {activeProject && (
        <section style={{ ...cardStyle, marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ ...sectionTitleStyle, margin: 0 }}>
              Quick Connect — {activeProject.name}
            </h2>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>slug: <code>{activeProject.slug}</code></span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, fontSize: 12.5 }}>
            <div style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={labelStyle}>Sync Endpoint</div>
              <code>/p/{activeProject.slug}/sync</code>
            </div>
            <div style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={labelStyle}>Auth Endpoint</div>
              <code>/p/{activeProject.slug}/auth</code>
            </div>
            <div style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={labelStyle}>Storage Endpoint</div>
              <code>/p/{activeProject.slug}/storage</code>
            </div>
          </div>
        </section>
      )}
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
