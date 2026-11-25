import { useCallback, useEffect, useState } from 'react';
import { LoginGate } from '@/components/LoginGate';
import { Sidebar } from '@/components/Sidebar';
import {
  ToastContainer,
  type ToastItem,
  type ToastType,
} from '@/components/Toast';
import { ApiKeysTab } from '@/components/tabs/ApiKeysTab';
import { AuthUsersTab } from '@/components/tabs/AuthUsersTab';
import { BackupsTab } from '@/components/tabs/BackupsTab';
import { StorageTab } from '@/components/tabs/StorageTab';
import { DataBrowserTab } from '@/components/tabs/DataBrowserTab';
import { EnvVarsTab } from '@/components/tabs/EnvVarsTab';
import { FunctionsTab } from '@/components/tabs/FunctionsTab';
import { OverviewTab } from '@/components/tabs/OverviewTab';
import { SchedulesTab } from '@/components/tabs/SchedulesTab';
import { SettingsTab } from '@/components/tabs/SettingsTab';
import { SyncLogsTab } from '@/components/tabs/SyncLogsTab';
import { adminFetch } from '@/lib/api';
import { secondaryBtnStyle } from '@/styles/adminStyles';
import {
  NAV_ITEMS,
  type BackupArchiveRow,
  type EndpointItem,
  type LocalAuthAccount,
  type NavTab,
  type OverviewData,
} from '@/types/admin';

export function AdminDashboard() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [localAccounts, setLocalAccounts] = useState<LocalAuthAccount[]>([]);
  const [backups, setBackups] = useState<BackupArchiveRow[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointItem[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [showDeletedRows, setShowDeletedRows] = useState<boolean>(() => {
    try {
      return localStorage.getItem('lls_show_deleted_rows') === '1';
    } catch {
      return false;
    }
  });

  const handleToggleShowDeletedRows = useCallback((next: boolean) => {
    setShowDeletedRows(next);
    try {
      localStorage.setItem('lls_show_deleted_rows', next ? '1' : '0');
    } catch {}
  }, []);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-3), { id, message, type }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setAuthenticated(false);
      setOverview(null);
    };
    window.addEventListener('lls:unauthorized', onUnauthorized);
    return () => window.removeEventListener('lls:unauthorized', onUnauthorized);
  }, []);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch('/admin/overview', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as OverviewData;
        setOverview(data);
        setAuthenticated(true);
        setSelectedTable((prev) =>
          data.tableCounts.length > 0 && !data.tableCounts.some((t) => t.table === prev)
            ? data.tableCounts[0].table
            : prev,
        );
      } else if (res.status === 401) {
        setAuthenticated(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTabDetails = useCallback(async (tab: NavTab) => {
    if (tab === 'auth') {
      const res = await adminFetch('/admin/users', { cache: 'no-store' });
      if (res.ok) {
        const d = (await res.json()) as { localAccounts?: LocalAuthAccount[] };
        setLocalAccounts(d.localAccounts ?? []);
      }
    } else if (tab === 'backups') {
      const res = await adminFetch('/admin/backups', { cache: 'no-store' });
      if (res.ok) {
        const d = (await res.json()) as { backups?: BackupArchiveRow[] };
        setBackups(d.backups ?? []);
      }
    } else if (tab === 'functions') {
      const res = await adminFetch('/admin/endpoints', { cache: 'no-store' });
      if (res.ok) {
        const d = (await res.json()) as { endpoints?: EndpointItem[] };
        setEndpoints(d.endpoints ?? []);
      }
    }
  }, []);

  useEffect(() => {
    if (authenticated) {
      void loadTabDetails(activeTab);
    }
  }, [authenticated, activeTab, loadTabDetails]);

  useEffect(() => {
    if (authenticated === null) {
      void (async () => {
        try {
          const res = await adminFetch('/admin/login', { cache: 'no-store' });
          const data = (await res.json().catch(() => ({}))) as {
            authenticated?: boolean;
          };
          setAuthenticated(Boolean(res.ok && data.authenticated));
        } catch {
          setAuthenticated(false);
        }
      })();
      return;
    }
    if (authenticated) {
      void loadOverview();
    }
  }, [authenticated, loadOverview]);

  const handleLogout = async (allSessions = false) => {
    try {
      await adminFetch('/admin/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allSessions }),
      });
    } catch {
      // Clear local session regardless of network state
    }
    setAuthenticated(false);
    setOverview(null);
  };

  const runAdminAction = async (
    path: string,
    payload: Record<string, any>,
    successMsg: string,
  ): Promise<boolean> => {
    const res = await adminFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      showToast(successMsg, 'info');
      await Promise.all([loadOverview(), loadTabDetails(activeTab)]);
      return true;
    }
    showToast(data?.error || `Action failed (${res.status})`, 'error');
    return false;
  };

  useEffect(() => {
    if (
      activeTab === 'env' &&
      overview &&
      overview.consoleRole !== 'super_admin'
    ) {
      setActiveTab('overview');
    }
  }, [activeTab, overview]);

  if (authenticated === null) {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--muted)',
          fontSize: 13.5,
        }}
      >
        Checking session...
      </main>
    );
  }

  if (!authenticated) {
    return <LoginGate onSuccess={() => setAuthenticated(true)} />;
  }

  const isApiHealthy =
    overview?.health?.status === 'ok' || Boolean(overview?.health?.ok);

  return (
    <div className="app-shell">
      <Sidebar
        activeTab={activeTab}
        overview={overview}
        onSelectTab={setActiveTab}
      />

      <div className="main-area">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              {activeTab === 'settings'
                ? 'Settings'
                : NAV_ITEMS.find((i) => i.id === activeTab)?.label}
            </h1>
            <span
              style={{
                fontSize: 12,
                padding: '3px 8px',
                borderRadius: 999,
                background: isApiHealthy
                  ? 'var(--success-soft)'
                  : 'var(--danger-soft)',
                color: isApiHealthy ? 'var(--success)' : 'var(--danger)',
                fontWeight: 600,
              }}
            >
              {isApiHealthy ? 'API Healthy' : 'API Offline'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              void loadOverview();
              setRefreshTick((n) => n + 1);
            }}
            disabled={loading}
            style={secondaryBtnStyle}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </header>

        <div className="content-body">
          {activeTab === 'overview' && (
            <OverviewTab
              overview={overview}
              onOpenDataTab={() => setActiveTab('data')}
              onOpenTable={(table) => {
                setSelectedTable(table);
                setActiveTab('data');
              }}
            />
          )}

          {activeTab === 'api_keys' && (
            <ApiKeysTab onToast={showToast} refreshSignal={refreshTick} />
          )}

          {activeTab === 'data' && (
            <DataBrowserTab
              tableCounts={overview?.tableCounts ?? []}
              selectedTable={selectedTable}
              showDeleted={showDeletedRows}
              refreshSignal={refreshTick}
              onSelectTable={setSelectedTable}
              onRefreshOverview={loadOverview}
              onToast={showToast}
            />
          )}

          {activeTab === 'auth' && (
            <AuthUsersTab
              accounts={localAccounts}
              onAction={(payload, successMsg) =>
                runAdminAction('/admin/users', payload, successMsg)
              }
            />
          )}

          {activeTab === 'functions' && <FunctionsTab endpoints={endpoints} />}

          {activeTab === 'schedules' && (
            <SchedulesTab onToast={showToast} refreshSignal={refreshTick} />
          )}

          {activeTab === 'backups' && (
            <BackupsTab
              backups={backups}
              onRefresh={async () => {
                await Promise.all([loadOverview(), loadTabDetails('backups')]);
              }}
              onToast={showToast}
            />
          )}

          {activeTab === 'storage' && (
            <StorageTab onToast={showToast} refreshSignal={refreshTick} />
          )}

          {activeTab === 'logs' && (
            <SyncLogsTab
              tables={(overview?.tableCounts ?? []).map((t) => t.table)}
              refreshSignal={refreshTick}
            />
          )}

          {activeTab === 'env' && overview?.consoleRole === 'super_admin' && (
            <EnvVarsTab onToast={showToast} refreshSignal={refreshTick} />
          )}

          {activeTab === 'settings' && (
            <SettingsTab
              onToast={showToast}
              onLogout={handleLogout}
              showDeletedRows={showDeletedRows}
              onToggleShowDeletedRows={handleToggleShowDeletedRows}
            />
          )}
        </div>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
