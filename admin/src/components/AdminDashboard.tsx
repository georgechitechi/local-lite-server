import { useCallback, useEffect, useState } from 'react';
import { LoginGate } from '@/components/LoginGate';
import { ProjectsDrawer } from '@/components/ProjectsDrawer';
import { Sidebar } from '@/components/Sidebar';
import { ToastContainer } from '@/components/Toast';
import { useToasts } from '@/hooks/useToasts';
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
import {
  adminFetch,
  getActiveProjectId,
  setActiveProjectId as persistActiveProjectId,
} from '@/lib/api';
import { secondaryBtnStyle } from '@/styles/adminStyles';
import {
  NAV_ITEMS,
  type BackupArchiveRow,
  type EndpointItem,
  type LocalAuthAccount,
  type NavTab,
  type OverviewData,
  type ProjectItem,
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
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(() =>
    getActiveProjectId(),
  );
  const [projectsDrawerOpen, setProjectsDrawerOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
  const { toasts, showToast, dismissToast } = useToasts();

  useEffect(() => {
    const onUnauthorized = () => {
      setAuthenticated(false);
      setOverview(null);
    };
    window.addEventListener('lls:unauthorized', onUnauthorized);
    return () => window.removeEventListener('lls:unauthorized', onUnauthorized);
  }, []);

  const selectProject = useCallback((id: string | null) => {
    persistActiveProjectId(id);
    setActiveProjectIdState(id);
    setSelectedTable('');
    setRefreshTick((n) => n + 1);
  }, []);

  const loadProjects = useCallback(async (role?: string | null) => {
    const res = await adminFetch('/projects', { cache: 'no-store' });
    if (!res.ok) return;
    const d = (await res.json()) as { projects?: ProjectItem[] };
    const list = d.projects ?? [];
    setProjects(list);
    const current = getActiveProjectId();
    const stillExists = current && list.some((p) => p.id === current);
    if (current && !stillExists) {
      selectProject(role !== 'super_admin' && list[0] ? list[0].id : null);
    } else if (!current && role !== 'super_admin' && list[0]) {
      selectProject(list[0].id);
    }
  }, [selectProject]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      let res = await adminFetch('/admin/overview', { cache: 'no-store' });
      if ((res.status === 403 || res.status === 404) && getActiveProjectId()) {
        persistActiveProjectId(null);
        setActiveProjectIdState(null);
        res = await adminFetch('/admin/overview', { cache: 'no-store' });
      }
      if (res.ok) {
        const data = (await res.json()) as OverviewData;
        setOverview(data);
        setAuthenticated(true);
        void loadProjects(data.consoleRole);
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
  }, [loadProjects]);

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
  }, [authenticated, activeTab, activeProjectId, refreshTick, loadTabDetails]);

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
      const params = new URLSearchParams(window.location.search);
      const cliRedirect = params.get('cli_redirect');
      const cliState = params.get('cli_state') ?? '';
      if (
        cliRedirect &&
        /^http:\/\/(127\.0\.0\.1|localhost):\d+\/callback$/.test(cliRedirect)
      ) {
        void (async () => {
          const res = await adminFetch('/admin/cli-token', { method: 'POST' });
          const d = (await res.json().catch(() => ({}))) as {
            token?: string;
            email?: string;
          };
          if (res.ok && d.token) {
            const target = new URL(cliRedirect);
            target.searchParams.set('token', d.token);
            if (d.email) target.searchParams.set('email', d.email);
            if (cliState) target.searchParams.set('state', cliState);
            window.location.replace(target.toString());
          }
        })();
        return;
      }
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
    persistActiveProjectId(null);
    setActiveProjectIdState(null);
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
    const isSuperOnly =
      activeTab === 'settings' ||
      NAV_ITEMS.some((i) => i.id === activeTab && i.superAdminOnly);
    if (isSuperOnly && overview && overview.consoleRole !== 'super_admin') {
      setActiveTab('overview');
    }
  }, [activeTab, overview]);

  const handleCreateProject = async (input: {
    name: string;
    slug?: string;
    schema: Record<string, Record<string, string>>;
    rules?: Record<string, any>;
  }): Promise<{ ok: boolean; suggestions?: string[] }> => {
    const res = await adminFetch('/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data?.error || 'Failed to create project.', 'error');
      return {
        ok: false,
        suggestions: Array.isArray(data?.suggestions) ? data.suggestions : undefined,
      };
    }
    showToast(`Project "${data.project.name}" created.`, 'info');
    await loadProjects(overview?.consoleRole);
    selectProject(data.project.id);
    void loadOverview();
    return { ok: true };
  };

  const handleApplyProjectSchema = async (
    projectId: string,
    schema: Record<string, Record<string, string>>,
    rules?: Record<string, any>,
  ): Promise<boolean> => {
    const res = await adminFetch(`/projects/${projectId}/schema`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema, rules }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data?.error || 'Failed to apply schema.', 'error');
      return false;
    }
    showToast('Project schema applied.', 'info');
    await Promise.all([loadProjects(overview?.consoleRole), loadOverview()]);
    setRefreshTick((n) => n + 1);
    return true;
  };

  const handleExportProject = (project: ProjectItem) => {
    void (async () => {
      const res = await adminFetch(`/projects/${project.id}/export`);
      if (!res.ok) {
        showToast('Failed to export project.', 'error');
        return;
      }
      const blob = new Blob([await res.text()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.slug}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
    })();
  };

  const handleDeleteProject = async (projectId: string): Promise<boolean> => {
    const res = await adminFetch(`/projects/${projectId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showToast(d?.error || 'Failed to delete project.', 'error');
      return false;
    }
    if (activeProjectId === projectId) selectProject(null);
    showToast('Project deleted.', 'info');
    await Promise.all([loadProjects(overview?.consoleRole), loadOverview()]);
    return true;
  };

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

  const isApiHealthy = Boolean(overview?.health?.ok);

  return (
    <div className="app-shell">
      <Sidebar
        activeTab={activeTab}
        overview={overview}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        onLogout={() => void handleLogout(false)}
        onSelectTab={setActiveTab}
      />

      <div className="main-area">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              aria-label="Open navigation"
              className="mobile-menu-btn"
              onClick={() => setMobileNavOpen(true)}
            >
              ☰
            </button>
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => setProjectsDrawerOpen(true)}
              style={secondaryBtnStyle}
            >
              Projects:{' '}
              {projects.find((p) => p.id === activeProjectId)?.name ??
                (overview?.consoleRole === 'super_admin'
                  ? 'Default'
                  : 'None')}
            </button>
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
          </div>
        </header>

        <div className="content-body">
          {activeTab === 'overview' && (
            <OverviewTab
              overview={overview}
              activeProject={projects.find((p) => p.id === activeProjectId) ?? null}
              onOpenDataTab={() => setActiveTab('data')}
              onOpenProjects={() => setProjectsDrawerOpen(true)}
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
              isSuperAdmin={overview?.consoleRole === 'super_admin'}
              onAction={(payload, successMsg) =>
                runAdminAction('/admin/users', payload, successMsg)
              }
            />
          )}

          {activeTab === 'functions' && (
            <FunctionsTab
              endpoints={endpoints}
              activeProjectSlug={projects.find((p) => p.id === activeProjectId)?.slug ?? null}
            />
          )}

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
            <StorageTab
              activeProjectSlug={projects.find((p) => p.id === activeProjectId)?.slug ?? null}
              onToast={showToast}
              refreshSignal={refreshTick}
            />
          )}

          {activeTab === 'logs' && (
            <SyncLogsTab
              tables={(overview?.tableCounts ?? []).map((t) => t.table)}
              refreshSignal={refreshTick}
            />
          )}

          {activeTab === 'env' && (
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

      <ProjectsDrawer
        open={projectsDrawerOpen}
        isSuperAdmin={overview?.consoleRole === 'super_admin'}
        projects={projects}
        activeProjectId={activeProjectId}
        onClose={() => setProjectsDrawerOpen(false)}
        onSelectProject={(id) => {
          selectProject(id);
          void loadOverview();
        }}
        onCreateProject={handleCreateProject}
        onApplySchema={handleApplyProjectSchema}
        onExportProject={handleExportProject}
        onDeleteProject={handleDeleteProject}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
