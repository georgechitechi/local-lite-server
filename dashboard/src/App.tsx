import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Database,
  History,
  KeyRound,
  Layers,
  MailCheck,
  Menu,
  Pause,
  Play,
  RefreshCw,
  Settings as SettingsIcon,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import {
  apiFetch,
  getStoredToken,
  type StatsPayload,
} from './api';
import { AuthKeys } from './pages/AuthKeys';
import { ChangeLog } from './pages/ChangeLog';
import { Commands } from './pages/Commands';
import { DataBrowser } from './pages/DataBrowser';
import { Lenses } from './pages/Lenses';
import { Outbox } from './pages/Outbox';
import { Overview } from './pages/Overview';
import { Settings } from './pages/Settings';

type PageId =
  | 'overview'
  | 'data'
  | 'lenses'
  | 'commands'
  | 'outbox'
  | 'changelog'
  | 'auth'
  | 'settings';

const NAV: Array<{ id: PageId; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'data', label: 'Data Browser', icon: Database },
  { id: 'lenses', label: 'Sync Lenses & WS', icon: Layers },
  { id: 'commands', label: 'Commands', icon: Terminal },
  { id: 'outbox', label: 'Outbox Queue', icon: MailCheck },
  { id: 'changelog', label: 'Change Log', icon: History },
  { id: 'auth', label: 'Auth & API Keys', icon: KeyRound },
];

function readHashPage(): PageId {
  const h = window.location.hash.replace(/^#/, '') as PageId;
  if (h === 'settings') return 'settings';
  return NAV.some((n) => n.id === h) ? h : 'overview';
}

export function App() {
  const [page, setPage] = useState<PageId>(readHashPage);
  const [token, setToken] = useState<string>(getStoredToken);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [error, setError] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false);

  const loadStats = useCallback(
    async (force = false) => {
      try {
        const next = await apiFetch<StatsPayload>(
          force ? '/stats.json?force=1' : '/stats.json',
          token,
        );
        setStats(next);
        setError('');
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (e: any) {
        setStats(null);
        setError(
          `${e?.message || 'Unauthorized'} — configure SERVER_API_KEY in Settings.`,
        );
      }
    },
    [token],
  );

  useEffect(() => {
    void loadStats();
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadStats();
      }
    }, 15_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadStats();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadStats, autoRefresh]);

  useEffect(() => {
    const onHash = () => setPage(readHashPage());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (next: PageId) => {
    window.location.hash = `#${next}`;
    setPage(next);
    setMobileNavOpen(false);
  };

  const activeTitle =
    page === 'settings'
      ? 'Settings'
      : (NAV.find((n) => n.id === page)?.label ?? 'Dashboard');

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <button
            className="btn btn-sm mobile-menu-btn"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label="Toggle navigation"
          >
            {mobileNavOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
          <div className="brand-mark">
            <Zap size={16} />
          </div>
          <span className="brand-name">local-lite-server</span>
          <span className={`header-badge ${stats ? 'ok' : 'err'}`}>
            <span className={`status-dot ${stats ? '' : 'err'}`} />
            {stats ? stats.server.dialect : 'Disconnected'}
          </span>
        </div>

        <div className="header-right">
          <button
            className={`btn btn-sm ${autoRefresh ? 'btn-active' : ''}`}
            onClick={() => setAutoRefresh((v) => !v)}
            title="Toggle 15s auto-refresh"
          >
            {autoRefresh ? <Pause size={13} /> : <Play size={13} />}
            <span className="hide-xs">{autoRefresh ? 'Live' : 'Paused'}</span>
          </button>
          <button
            className="btn btn-sm"
            onClick={() => void loadStats(true)}
            title={lastUpdated ? `Last updated ${lastUpdated}` : 'Refresh now'}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </header>

      <div className="layout">
        {mobileNavOpen && (
          <div
            className="sidebar-backdrop"
            onClick={() => setMobileNavOpen(false)}
          />
        )}
        <aside className={`sidebar ${mobileNavOpen ? 'open' : ''}`}>
          <div className="sidebar-label">Engine</div>
          <div className="sidebar-nav">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`nav-item ${page === id ? 'active' : ''}`}
                onClick={() => navigate(id)}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>

          <div className="sidebar-footer">
            <button
              className={`nav-item ${page === 'settings' ? 'active' : ''}`}
              onClick={() => navigate('settings')}
            >
              <SettingsIcon size={16} />
              Settings
            </button>
          </div>
        </aside>

        <main className="main">
          <h1 className="page-heading">{activeTitle}</h1>
          {error && page !== 'settings' && (
            <div className="banner-err row" style={{ justifyContent: 'space-between' }}>
              <span>{error}</span>
              <button
                className="btn btn-sm"
                onClick={() => navigate('settings')}
              >
                <SettingsIcon size={13} /> Open Settings
              </button>
            </div>
          )}

          {page === 'settings' && (
            <Settings
              token={token}
              onSaveToken={setToken}
              autoRefresh={autoRefresh}
              onToggleAutoRefresh={setAutoRefresh}
              stats={stats}
            />
          )}

          {stats && page !== 'settings' && (
            <>
              {page === 'overview' && <Overview stats={stats} />}
              {page === 'data' && (
                <DataBrowser stats={stats} token={token} onError={setError} />
              )}
              {page === 'lenses' && <Lenses stats={stats} token={token} />}
              {page === 'commands' && <Commands stats={stats} token={token} />}
              {page === 'outbox' && (
                <Outbox token={token} onError={setError} />
              )}
              {page === 'changelog' && (
                <ChangeLog
                  stats={stats}
                  token={token}
                  onError={setError}
                  onRefreshStats={loadStats}
                />
              )}
              {page === 'auth' && (
                <AuthKeys token={token} onError={setError} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
