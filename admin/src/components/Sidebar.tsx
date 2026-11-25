import { pillCountStyle } from '@/styles/adminStyles';
import { NAV_ITEMS, type NavTab, type OverviewData } from '@/types/admin';

export function Sidebar({
  activeTab,
  overview,
  onSelectTab,
}: {
  activeTab: NavTab;
  overview: OverviewData | null;
  onSelectTab: (tab: NavTab) => void;
}) {
  return (
    <aside className="sidebar">
      <div>
        <div style={{ padding: '4px 10px 16px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.2 }}>
            local-lite-server
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 4,
              fontSize: 12,
              color: 'var(--muted)',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: overview?.dbConnected
                  ? 'var(--success)'
                  : 'var(--danger)',
              }}
            />
            <span>self-hosted • {overview?.health?.dialect || 'sql'}</span>
          </div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {NAV_ITEMS.filter(
            (item) =>
              !item.superAdminOnly || overview?.consoleRole === 'super_admin',
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => onSelectTab(item.id)}
            >
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.id === 'auth' && overview && (
                <span style={pillCountStyle}>
                  {overview.localAccounts.length}
                </span>
              )}
              {item.id === 'data' && overview && (
                <span style={pillCountStyle}>
                  {overview.tableCounts.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border)',
          paddingTop: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <button
          type="button"
          className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => onSelectTab('settings')}
        >
          Settings
        </button>
      </div>
    </aside>
  );
}
