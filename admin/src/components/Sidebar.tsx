import { pillCountStyle } from '@/styles/adminStyles';
import { NAV_ITEMS, type NavTab, type OverviewData } from '@/types/admin';

export function Sidebar({
  activeTab,
  overview,
  mobileOpen = false,
  onCloseMobile,
  onLogout,
  onSelectTab,
}: {
  activeTab: NavTab;
  overview: OverviewData | null;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  onLogout: () => void;
  onSelectTab: (tab: NavTab) => void;
}) {
  const isSuperAdmin = overview?.consoleRole === 'super_admin';

  return (
    <>
      <div
        className={`sidebar-backdrop ${mobileOpen ? 'open' : ''}`}
        onClick={() => onCloseMobile?.()}
      />
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
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
              (item) => !item.superAdminOnly || isSuperAdmin,
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                onClick={() => {
                  onSelectTab(item.id);
                  onCloseMobile?.();
                }}
              >
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.id === 'auth' && overview && (
                  <span style={pillCountStyle}>
                    {overview.accountsCount ?? 0}
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
          {isSuperAdmin ? (
            <button
              type="button"
              className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => {
                onSelectTab('settings');
                onCloseMobile?.();
              }}
            >
              Settings
            </button>
          ) : (
            <button
              type="button"
              className="nav-item"
              onClick={() => {
                onCloseMobile?.();
                onLogout();
              }}
            >
              Sign Out
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
