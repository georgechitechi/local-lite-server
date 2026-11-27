import { useCallback, useState } from 'react';
import type { ToastType } from '@/components/Toast';
import {
  adminFetch,
  getActiveProjectId,
  setActiveProjectId as persistActiveProjectId,
} from '@/lib/api';
import type { ProjectItem } from '@/types/admin';

export function useProjects(opts: {
  showToast: (message: string, type?: ToastType) => void;
  onProjectChange: () => void;
}) {
  const { showToast, onProjectChange } = opts;
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(() =>
    getActiveProjectId(),
  );

  const selectProject = useCallback(
    (id: string | null) => {
      persistActiveProjectId(id);
      setActiveProjectIdState(id);
      onProjectChange();
    },
    [onProjectChange],
  );

  const loadProjects = useCallback(
    async (role?: string | null) => {
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
    },
    [selectProject],
  );

  const createProject = async (
    input: {
      name: string;
      slug?: string;
      schema: Record<string, Record<string, string>>;
      rules?: Record<string, any>;
    },
    role?: string | null,
  ): Promise<{ ok: boolean; suggestions?: string[] }> => {
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
    await loadProjects(role);
    selectProject(data.project.id);
    return { ok: true };
  };

  const applyProjectSchema = async (
    projectId: string,
    schema: Record<string, Record<string, string>>,
    rules?: Record<string, any>,
    role?: string | null,
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
    await loadProjects(role);
    onProjectChange();
    return true;
  };

  const exportProject = (project: ProjectItem) => {
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

  const deleteProject = async (projectId: string, role?: string | null): Promise<boolean> => {
    const res = await adminFetch(`/projects/${projectId}`, { method: 'DELETE' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showToast(d?.error || 'Failed to delete project.', 'error');
      return false;
    }
    if (activeProjectId === projectId) selectProject(null);
    showToast('Project deleted.', 'info');
    await loadProjects(role);
    return true;
  };

  return {
    projects,
    activeProjectId,
    setActiveProjectIdState,
    selectProject,
    loadProjects,
    createProject,
    applyProjectSchema,
    exportProject,
    deleteProject,
  };
}
