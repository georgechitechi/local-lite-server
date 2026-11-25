import { useEffect, useState } from 'react';
import { ToggleSlider } from '@/components/ToggleSlider';
import type { ToastType } from '@/components/Toast';
import { adminFetch } from '@/lib/api';
import {
  compactPrimaryBtnStyle,
  inputStyle,
  labelStyle,
  secondaryBtnStyle,
} from '@/styles/adminStyles';

export type TableRowDrawerMode =
  | { kind: 'closed' }
  | { kind: 'create'; table: string; columns: string[] }
  | {
      kind: 'edit';
      table: string;
      columns: string[];
      row: Record<string, any>;
    };

function formatFieldValue(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'object') return JSON.stringify(val, null, 2);
  return String(val);
}

function parseFieldValue(col: string, raw: string, original: unknown): unknown {
  const trimmed = raw.trim();
  if (col === 'deleted') {
    return raw === 'true' || raw === '1' ? 1 : 0;
  }
  if (trimmed === '') return null;
  if (
    typeof original === 'object' &&
    original !== null &&
    (trimmed.startsWith('{') || trimmed.startsWith('['))
  ) {
    return JSON.parse(trimmed);
  }
  if (
    (col === 'metadata' ||
      col === 'changes' ||
      col === 'scopes' ||
      col === 'roles' ||
      col === 'amenities' ||
      col === 'photos' ||
      col === 'documents' ||
      col === 'images' ||
      col === 'affected_houses' ||
      col === 'payment_period' ||
      col === 'emails' ||
      col === 'schedule' ||
      col === 'setting_value' ||
      col === 'next_of_kin' ||
      col === 'raw_payload') &&
    (trimmed.startsWith('{') || trimmed.startsWith('['))
  ) {
    return JSON.parse(trimmed);
  }
  if (typeof original === 'number' && !Number.isNaN(Number(trimmed))) {
    return Number(trimmed);
  }
  return raw;
}

export function TableRowDrawer({
  drawer,
  onClose,
  onSaved,
  onToast,
}: {
  drawer: TableRowDrawerMode;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onToast: (msg: string, type?: ToastType) => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const open = drawer.kind !== 'closed';
  const isEdit = drawer.kind === 'edit';

  useEffect(() => {
    if (drawer.kind === 'create') {
      const initial: Record<string, string> = {};
      for (const col of drawer.columns) {
        if (col === 'created_at' || col === 'updated_at') continue;
        initial[col] = col === 'deleted' ? '0' : '';
      }
      setFields(initial);
    } else if (drawer.kind === 'edit') {
      const initial: Record<string, string> = {};
      for (const col of drawer.columns) {
        if (col === 'created_at' || col === 'updated_at') continue;
        initial[col] = formatFieldValue(drawer.row[col]);
      }
      setFields(initial);
    }
  }, [drawer]);

  useEffect(() => {
    if (!open || saving) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, saving, onClose]);

  if (!open) return null;

  const { table, columns } = drawer;
  const editableCols = columns.filter(
    (col) => col !== 'created_at' && col !== 'updated_at',
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, any> = {};
      const originalRow = isEdit ? drawer.row : {};
      for (const col of editableCols) {
        const raw = fields[col] ?? '';
        if (col === 'id' && !raw.trim() && !isEdit) continue;
        try {
          payload[col] = parseFieldValue(col, raw, originalRow[col]);
        } catch {
          onToast(`Invalid JSON in "${col}".`, 'error');
          setSaving(false);
          return;
        }
      }

      const res = await adminFetch('/admin/table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, row: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(data?.error || `Save failed (${res.status})`, 'error');
        return;
      }
      onToast(
        `${isEdit ? 'Updated' : 'Created'} row & broadcast to clients.`,
        'info',
      );
      await onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || !drawer.row.id) return;
    if (
      !window.confirm(
        `Soft-delete row "${drawer.row.id}" from "${table}" and broadcast to clients?`,
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch(
        `/admin/table?table=${encodeURIComponent(table)}&id=${encodeURIComponent(String(drawer.row.id))}`,
        { method: 'DELETE' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(data?.error || `Delete failed (${res.status})`, 'error');
        return;
      }
      onToast('Row soft-deleted & broadcast to clients.', 'info');
      await onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(2, 6, 23, 0.7)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <aside
        aria-label={isEdit ? `Edit ${table} row` : `New ${table} row`}
        style={{
          width: 'min(540px, 100vw)',
          height: '100%',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflowY: 'auto',
          boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.45)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid var(--border)',
            paddingBottom: 14,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
              {isEdit ? `Edit ${table} row` : `New ${table} row`}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              Saves atomically &amp; broadcasts via SSE immediately
            </div>
          </div>
          {!saving && (
            <button type="button" onClick={onClose} style={secondaryBtnStyle}>
              Close
            </button>
          )}
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {editableCols.map((col) => {
            const val = fields[col] ?? '';
            const isMultiline =
              val.includes('\n') ||
              val.length > 80 ||
              col === 'metadata' ||
              col === 'changes' ||
              col === 'raw_payload' ||
              col === 'content' ||
              col === 'remarks' ||
              col === 'description';

            if (col === 'deleted') {
              return (
                <ToggleSlider
                  key={col}
                  checked={val === '1' || val === 'true'}
                  onChange={(checked) =>
                    setFields((prev) => ({
                      ...prev,
                      [col]: checked ? '1' : '0',
                    }))
                  }
                  label={
                    <>
                      Soft-deleted (<code>deleted = 1</code>)
                    </>
                  }
                />
              );
            }

            return (
              <div key={col}>
                <label style={labelStyle}>{col}</label>
                {isMultiline ? (
                  <textarea
                    rows={3}
                    value={val}
                    disabled={isEdit && col === 'id'}
                    onChange={(e) =>
                      setFields((prev) => ({ ...prev, [col]: e.target.value }))
                    }
                    style={{
                      ...inputStyle,
                      fontFamily: 'monospace',
                      fontSize: 12.5,
                      resize: 'vertical',
                      opacity: isEdit && col === 'id' ? 0.7 : 1,
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    value={val}
                    placeholder={
                      !isEdit && col === 'id'
                        ? 'Auto-generated UUID if empty'
                        : ''
                    }
                    disabled={isEdit && col === 'id'}
                    onChange={(e) =>
                      setFields((prev) => ({ ...prev, [col]: e.target.value }))
                    }
                    style={{
                      ...inputStyle,
                      fontFamily: 'monospace',
                      fontSize: 12.5,
                      opacity: isEdit && col === 'id' ? 0.7 : 1,
                    }}
                  />
                )}
              </div>
            );
          })}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              marginTop: 8,
              borderTop: '1px solid var(--border)',
              paddingTop: 14,
            }}
          >
            {isEdit && drawer.row.id ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={saving}
                  style={{
                    ...secondaryBtnStyle,
                    color: 'var(--danger)',
                    borderColor: 'rgba(248, 113, 113, 0.35)',
                  }}
                >
                  Soft Delete
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={saving}
                    style={secondaryBtnStyle}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    style={compactPrimaryBtnStyle}
                  >
                    {saving ? 'Saving...' : 'Save & Broadcast'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  style={secondaryBtnStyle}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={compactPrimaryBtnStyle}
                >
                  {saving ? 'Saving...' : 'Save & Broadcast'}
                </button>
              </>
            )}
          </div>
        </form>
      </aside>
    </div>
  );
}
