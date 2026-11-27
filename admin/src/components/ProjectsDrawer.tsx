import { useState } from 'react';
import {
  inputStyle,
  primaryBtnStyle,
  secondaryBtnStyle,
} from '@/styles/adminStyles';
import type { ProjectItem } from '@/types/admin';

const FIELD_TYPES = [
  'string',
  'string | null',
  'number',
  'number | null',
  'boolean',
  'boolean | null',
  'json',
  'json | null',
  'string[]',
  'string[] | null',
] as const;

type TableDraft = {
  name: string;
  fields: Array<{ name: string; type: string }>;
};

function schemaToDrafts(
  schema: Record<string, Record<string, string>>,
): TableDraft[] {
  const entries = Object.entries(schema);
  if (entries.length === 0) {
    return [
      {
        name: 'notes',
        fields: [
          { name: 'title', type: 'string' },
          { name: 'body', type: 'string | null' },
        ],
      },
    ];
  }
  return entries.map(([name, cols]) => ({
    name,
    fields: Object.entries(cols).map(([col, type]) => ({ name: col, type })),
  }));
}

function draftsToSchema(
  drafts: TableDraft[],
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const t of drafts) {
    const tableName = t.name.trim();
    if (!tableName) continue;
    const cols: Record<string, string> = {};
    for (const f of t.fields) {
      const colName = f.name.trim();
      if (colName) cols[colName] = f.type;
    }
    out[tableName] = cols;
  }
  return out;
}

export function ProjectsDrawer({
  open,
  isSuperAdmin,
  projects,
  activeProjectId,
  onClose,
  onSelectProject,
  onCreateProject,
  onApplySchema,
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
  }) => Promise<boolean>;
  onApplySchema: (
    projectId: string,
    schema: Record<string, Record<string, string>>,
  ) => Promise<boolean>;
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

  if (!open) return null;

  const openNew = () => {
    setMode('new');
    setEditingId(null);
    setName('');
    setSlug('');
    const initial = schemaToDrafts({});
    setDrafts(initial);
    setRawJson(JSON.stringify(draftsToSchema(initial), null, 2));
    setRawMode(false);
    setFormError('');
  };

  const openEdit = (p: ProjectItem) => {
    setMode('edit');
    setEditingId(p.id);
    setName(p.name);
    setSlug(p.slug);
    const initial = schemaToDrafts(p.schema ?? {});
    setDrafts(initial);
    setRawJson(JSON.stringify(p.schema ?? {}, null, 2));
    setRawMode(false);
    setFormError('');
  };

  const toggleRaw = () => {
    if (!rawMode) {
      setRawJson(JSON.stringify(draftsToSchema(drafts), null, 2));
      setRawMode(true);
    } else {
      try {
        const parsed = JSON.parse(rawJson);
        setDrafts(schemaToDrafts(parsed));
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
    if (rawMode) {
      try {
        schema = JSON.parse(rawJson);
      } catch {
        setFormError('Invalid JSON syntax.');
        return;
      }
    } else {
      schema = draftsToSchema(drafts);
    }

    setSaving(true);
    try {
      const ok =
        mode === 'new'
          ? await onCreateProject({
              name: name.trim(),
              slug: slug.trim() || undefined,
              schema,
            })
          : editingId
            ? await onApplySchema(editingId, schema)
            : false;
      if (ok) {
        setMode('list');
        if (mode === 'new') onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 60,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440,
          maxWidth: '100vw',
          height: '100%',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.35)',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {mode !== 'list' && (
              <button
                type="button"
                onClick={() => setMode('list')}
                style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 12 }}
              >
                Back
              </button>
            )}
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              {mode === 'list'
                ? 'Projects'
                : mode === 'new'
                  ? 'New Project'
                  : `Schema: ${name}`}
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {mode === 'list' && (
              <button
                type="button"
                onClick={openNew}
                style={{ ...primaryBtnStyle, padding: '6px 12px', fontSize: 12.5 }}
              >
                + New Project
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{ ...secondaryBtnStyle, padding: '6px 10px', fontSize: 12.5 }}
            >
              Close
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
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
                    background: !activeProjectId ? 'var(--accent-soft, rgba(167,139,250,0.08))' : 'transparent',
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
                    <span style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>
                      Active
                    </span>
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
                  No projects yet. Click <strong>+ New Project</strong> to create your first isolated database workspace.
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
                            <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>
                              Active
                            </span>
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
                      onChange={(e) => setSlug(e.target.value)}
                      placeholder="auto-generated from name"
                      style={inputStyle}
                    />
                  </div>
                </>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>Tables &amp; Columns</span>
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
                  style={{
                    ...inputStyle,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    resize: 'vertical',
                  }}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {drafts.map((tbl, ti) => (
                    <div
                      key={ti}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        padding: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          value={tbl.name}
                          onChange={(e) => {
                            const next = [...drafts];
                            next[ti] = { ...tbl, name: e.target.value };
                            setDrafts(next);
                          }}
                          placeholder="table_name"
                          style={{ ...inputStyle, flex: 1, fontWeight: 600 }}
                        />
                        <button
                          type="button"
                          onClick={() => setDrafts(drafts.filter((_, i) => i !== ti))}
                          style={{ ...secondaryBtnStyle, padding: '6px 10px', fontSize: 12, color: 'var(--danger)' }}
                        >
                          Remove
                        </button>
                      </div>

                      {tbl.fields.map((f, fi) => (
                        <div key={fi} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            value={f.name}
                            onChange={(e) => {
                              const next = [...drafts];
                              const fields = [...tbl.fields];
                              fields[fi] = { ...f, name: e.target.value };
                              next[ti] = { ...tbl, fields };
                              setDrafts(next);
                            }}
                            placeholder="column_name"
                            style={{ ...inputStyle, flex: 1 }}
                          />
                          <select
                            value={f.type}
                            onChange={(e) => {
                              const next = [...drafts];
                              const fields = [...tbl.fields];
                              fields[fi] = { ...f, type: e.target.value };
                              next[ti] = { ...tbl, fields };
                              setDrafts(next);
                            }}
                            style={{ ...inputStyle, width: 135 }}
                          >
                            {FIELD_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              const next = [...drafts];
                              next[ti] = {
                                ...tbl,
                                fields: tbl.fields.filter((_, i) => i !== fi),
                              };
                              setDrafts(next);
                            }}
                            style={{ ...secondaryBtnStyle, padding: '6px 9px', fontSize: 12 }}
                          >
                            ×
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() => {
                          const next = [...drafts];
                          next[ti] = {
                            ...tbl,
                            fields: [...tbl.fields, { name: '', type: 'string' }],
                          };
                          setDrafts(next);
                        }}
                        style={{ ...secondaryBtnStyle, alignSelf: 'flex-start', padding: '4px 10px', fontSize: 12 }}
                      >
                        + Add Column
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() =>
                      setDrafts([
                        ...drafts,
                        { name: '', fields: [{ name: 'title', type: 'string' }] },
                      ])
                    }
                    style={{ ...secondaryBtnStyle, alignSelf: 'flex-start', fontSize: 12.5 }}
                  >
                    + Add Table
                  </button>
                </div>
              )}

              {formError && (
                <div style={{ color: 'var(--danger)', fontSize: 12.5 }}>{formError}</div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                {mode === 'edit' && editingId && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      setSaving(true);
                      try {
                        const ok = await onDeleteProject(editingId);
                        if (ok) setMode('list');
                      } finally {
                        setSaving(false);
                      }
                    }}
                    style={{ ...secondaryBtnStyle, color: 'var(--danger)', marginRight: 'auto' }}
                  >
                    Delete Project
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMode('list')}
                  style={secondaryBtnStyle}
                >
                  Cancel
                </button>
                <button type="submit" disabled={saving} style={primaryBtnStyle}>
                  {saving ? 'Saving...' : mode === 'new' ? 'Create Project' : 'Apply Schema'}
                </button>
              </div>
            </form>
          )}
        </div>
      </aside>
    </div>
  );
}
