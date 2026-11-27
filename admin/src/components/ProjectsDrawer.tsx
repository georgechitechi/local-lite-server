import { useState } from 'react';
import {
  draftsToPayload,
  ProjectSchemaEditor,
  schemaToDrafts,
  type TableDraft,
} from '@/components/ProjectSchemaEditor';
import { SlideDrawer } from '@/components/SlideDrawer';
import {
  inputStyle,
  primaryBtnStyle,
  secondaryBtnStyle,
} from '@/styles/adminStyles';
import type { ProjectItem } from '@/types/admin';

export function ProjectsDrawer({
  open,
  isSuperAdmin,
  projects,
  activeProjectId,
  onClose,
  onSelectProject,
  onCreateProject,
  onApplySchema,
  onExportProject,
  onDeleteProject,
}: {
  open: boolean;
  isSuperAdmin: boolean;
  projects: ProjectItem[];
  activeProjectId: string | null;
  onClose: () => void;
  onSelectProject: (id: string | null) => void;
  onCreateProject: (input: {
    name: string;
    slug?: string;
    schema: Record<string, Record<string, string>>;
    rules?: Record<string, any>;
  }) => Promise<{ ok: boolean; suggestions?: string[] }>;
  onApplySchema: (
    projectId: string,
    schema: Record<string, Record<string, string>>,
    rules?: Record<string, any>,
  ) => Promise<boolean>;
  onExportProject: (project: ProjectItem) => void;
  onDeleteProject: (projectId: string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<'list' | 'new' | 'edit'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [drafts, setDrafts] = useState<TableDraft[]>(() => schemaToDrafts({}));
  const [rawMode, setRawMode] = useState(false);
  const [rawJson, setRawJson] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [slugSuggestions, setSlugSuggestions] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');

  const openNew = () => {
    setMode('new');
    setEditingId(null);
    setName('');
    setSlug('');
    const initial = schemaToDrafts({});
    setDrafts(initial);
    setRawJson(JSON.stringify(draftsToPayload(initial).schema, null, 2));
    setRawMode(false);
    setFormError('');
    setSlugSuggestions([]);
    setConfirmDelete(false);
    setDeleteInput('');
  };

  const openEdit = (p: ProjectItem) => {
    setMode('edit');
    setEditingId(p.id);
    setName(p.name);
    setSlug(p.slug);
    const initial = schemaToDrafts(p.schema ?? {}, p.rulesRaw ?? {});
    setDrafts(initial);
    setRawJson(JSON.stringify(p.schema ?? {}, null, 2));
    setRawMode(false);
    setFormError('');
    setSlugSuggestions([]);
    setConfirmDelete(false);
    setDeleteInput('');
  };

  const toggleRaw = () => {
    if (!rawMode) {
      setRawJson(JSON.stringify(draftsToPayload(drafts).schema, null, 2));
      setRawMode(true);
    } else {
      try {
        setDrafts(schemaToDrafts(JSON.parse(rawJson)));
        setRawMode(false);
        setFormError('');
      } catch {
        setFormError('Fix invalid JSON before switching to visual editor.');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    let schema: Record<string, Record<string, string>>;
    let rules: Record<string, string> | undefined;
    if (rawMode) {
      try {
        schema = JSON.parse(rawJson);
      } catch {
        setFormError('Invalid JSON syntax.');
        return;
      }
    } else {
      const built = draftsToPayload(drafts);
      schema = built.schema;
      rules = built.rules;
    }

    setSaving(true);
    setSlugSuggestions([]);
    try {
      let ok = false;
      if (mode === 'new') {
        const res = await onCreateProject({
          name: name.trim(),
          slug: slug.trim() || undefined,
          schema,
          rules,
        });
        ok = res.ok;
        if (!res.ok && res.suggestions?.length) {
          setSlugSuggestions(res.suggestions);
          setFormError('That slug is already taken. Choose an available option below:');
        }
      } else if (editingId) {
        ok = await onApplySchema(editingId, schema, rules);
      }
      if (ok) {
        setMode('list');
        if (mode === 'new') onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const editingProject = projects.find((p) => p.id === editingId) ?? null;

  return (
    <SlideDrawer
      open={open}
      title={mode === 'list' ? 'Projects' : mode === 'new' ? 'New Project' : `Schema: ${name}`}
      onClose={onClose}
      disabled={saving}
      maxWidth={480}
      zIndex={60}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {mode !== 'list' ? (
          <button
            type="button"
            onClick={() => setMode('list')}
            style={{ ...secondaryBtnStyle, padding: '5px 10px', fontSize: 12 }}
          >
            ← Back to Projects
          </button>
        ) : (
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {projects.length} {projects.length === 1 ? 'project' : 'projects'}
          </span>
        )}
        {mode === 'list' && (
          <button
            type="button"
            onClick={openNew}
            style={{ ...primaryBtnStyle, padding: '6px 12px', fontSize: 12.5 }}
          >
            + New Project
          </button>
        )}
      </div>

      {mode === 'list' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {isSuperAdmin && (
            <div
              onClick={() => {
                onSelectProject(null);
                onClose();
              }}
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                border: `1px solid ${!activeProjectId ? 'var(--accent)' : 'var(--border)'}`,
                background: !activeProjectId ? 'rgba(167,139,250,0.08)' : 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Default (Central Server)</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  Root server tables &amp; configuration
                </div>
              </div>
              {!activeProjectId && (
                <span style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>Active</span>
              )}
            </div>
          )}

          {projects.length === 0 ? (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                border: '1px dashed var(--border)',
                borderRadius: 10,
                color: 'var(--muted)',
                fontSize: 13,
              }}
            >
              No projects yet. Click <strong>+ New Project</strong> to create an isolated database workspace.
            </div>
          ) : (
            projects.map((p) => {
              const isActive = activeProjectId === p.id;
              const tableCount = Object.keys(p.schema ?? {}).length;
              return (
                <div
                  key={p.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                    background: isActive ? 'rgba(167,139,250,0.08)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <div
                    onClick={() => {
                      onSelectProject(p.id);
                      onClose();
                    }}
                    style={{ flex: 1, cursor: 'pointer', minWidth: 0 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</span>
                      {isActive && (
                        <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>Active</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      <code>/p/{p.slug}/sync</code> • {tableCount} {tableCount === 1 ? 'table' : 'tables'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    style={{ ...secondaryBtnStyle, padding: '5px 10px', fontSize: 12 }}
                  >
                    Schema
                  </button>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mode === 'new' && (
            <>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
                  Project Name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Task Tracker"
                  required
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
                  Slug (optional)
                </label>
                <input
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value);
                    if (slugSuggestions.length) setSlugSuggestions([]);
                  }}
                  minLength={3}
                  maxLength={49}
                  pattern="[a-z0-9][a-z0-9-]{2,48}"
                  placeholder="auto-generated from name (min 3 chars)"
                  style={inputStyle}
                />
                {slugSuggestions.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {slugSuggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          setSlug(s);
                          setSlugSuggestions([]);
                          setFormError('');
                        }}
                        style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 12 }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Tables, Columns &amp; Access Rules</span>
            <button
              type="button"
              onClick={toggleRaw}
              style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 11.5 }}
            >
              {rawMode ? 'Visual Editor' : 'Edit Raw JSON'}
            </button>
          </div>

          {rawMode ? (
            <textarea
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
              rows={12}
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
            />
          ) : (
            <ProjectSchemaEditor drafts={drafts} onChange={setDrafts} />
          )}

          {formError && <div style={{ color: 'var(--danger)', fontSize: 12.5 }}>{formError}</div>}

          {mode === 'edit' && editingProject && confirmDelete && (
            <div
              style={{
                border: '1px solid var(--danger)',
                borderRadius: 10,
                padding: 12,
                background: 'var(--danger-soft)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--danger)' }}>
                Confirm permanent deletion
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                This permanently drops all tables, files, users, keys, and logs for{' '}
                <strong>{editingProject.name}</strong>. Type{' '}
                <code>{editingProject.slug}</code> to confirm.
              </div>
              <input
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={editingProject.slug}
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(false);
                    setDeleteInput('');
                  }}
                  style={secondaryBtnStyle}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving || deleteInput.trim() !== editingProject.slug}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      const ok = await onDeleteProject(editingProject.id);
                      if (ok) {
                        setConfirmDelete(false);
                        setDeleteInput('');
                        setMode('list');
                      }
                    } finally {
                      setSaving(false);
                    }
                  }}
                  style={{
                    ...primaryBtnStyle,
                    background: 'var(--danger)',
                    opacity: deleteInput.trim() === editingProject.slug ? 1 : 0.5,
                  }}
                >
                  {saving ? 'Deleting...' : 'Delete Permanently'}
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
            {mode === 'edit' && editingProject && (
              <>
                <button
                  type="button"
                  onClick={() => onExportProject(editingProject)}
                  style={{ ...secondaryBtnStyle, fontSize: 12 }}
                >
                  Export JSON
                </button>
                {!confirmDelete && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setDeleteInput('');
                      setConfirmDelete(true);
                    }}
                    style={{ ...secondaryBtnStyle, color: 'var(--danger)', marginRight: 'auto' }}
                  >
                    Delete
                  </button>
                )}
              </>
            )}
            <button type="button" onClick={() => setMode('list')} style={secondaryBtnStyle}>
              Cancel
            </button>
            <button type="submit" disabled={saving} style={primaryBtnStyle}>
              {saving ? 'Saving...' : mode === 'new' ? 'Create Project' : 'Apply Schema'}
            </button>
          </div>
        </form>
      )}
    </SlideDrawer>
  );
}
