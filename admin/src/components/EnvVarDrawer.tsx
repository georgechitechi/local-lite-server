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

export interface EnvVarItem {
  key: string;
  maskedValue: string;
  isSecret: boolean;
  source: 'database' | 'env';
  readonly: boolean;
  revealable: boolean;
  description: string | null;
  updatedAt: number | null;
  updatedBy: string | null;
}

export type EnvDrawerMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; item: EnvVarItem; initialValue: string };

export function EnvVarDrawer({
  drawer,
  onClose,
  onSaved,
  onToast,
}: {
  drawer: EnvDrawerMode;
  onClose: () => void;
  onSaved: (key: string) => void;
  onToast: (msg: string, type?: ToastType) => void;
}) {
  const [envKey, setEnvKey] = useState('');
  const [envValue, setEnvValue] = useState('');
  const [envDesc, setEnvDesc] = useState('');
  const [envSecret, setEnvSecret] = useState(true);
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);

  const open = drawer.kind !== 'closed';
  const isEdit = drawer.kind === 'edit';

  useEffect(() => {
    if (drawer.kind === 'create') {
      setEnvKey('');
      setEnvValue('');
      setEnvDesc('');
      setEnvSecret(true);
      setShowValue(false);
    } else if (drawer.kind === 'edit') {
      setEnvKey(drawer.item.key);
      setEnvValue(drawer.initialValue);
      setEnvDesc(drawer.item.description || '');
      setEnvSecret(drawer.item.isSecret);
      setShowValue(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = envKey.trim().toUpperCase();
    if (!key) {
      onToast('Variable key is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch('/admin/env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set',
          key,
          value: envValue,
          isSecret: envSecret,
          description: envDesc.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(data?.error || 'Failed to save environment variable.', 'error');
        return;
      }
      onToast(`Saved ${key}.`, 'info');
      onSaved(key);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={() => {
        if (!saving) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        zIndex: 55,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 440,
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
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
            {isEdit ? `Edit ${drawer.item.key}` : 'Add Variable'}
          </h3>
          {!saving && (
            <button type="button" onClick={onClose} style={secondaryBtnStyle}>
              Close
            </button>
          )}
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div>
            <label style={labelStyle}>Key</label>
            <input
              type="text"
              placeholder="MY_API_KEY"
              value={envKey}
              disabled={isEdit}
              onChange={(e) => setEnvKey(e.target.value.toUpperCase())}
              style={{
                ...inputStyle,
                fontFamily: 'monospace',
                opacity: isEdit ? 0.7 : 1,
              }}
            />
          </div>

          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 6,
              }}
            >
              <label style={{ ...labelStyle, marginBottom: 0 }}>Value</label>
              <button
                type="button"
                onClick={() => setShowValue((v) => !v)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--muted)',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {showValue ? 'Hide' : 'Show'}
              </button>
            </div>
            <textarea
              rows={3}
              placeholder="sk_live_..."
              value={envValue}
              onChange={(e) => setEnvValue(e.target.value)}
              style={{
                ...inputStyle,
                fontFamily: 'monospace',
                resize: 'vertical',
                ...(envSecret && !showValue
                  ? ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)
                  : {}),
              }}
            />
          </div>

          <div>
            <label style={labelStyle}>Description (optional)</label>
            <input
              type="text"
              placeholder="External API key"
              value={envDesc}
              onChange={(e) => setEnvDesc(e.target.value)}
              style={inputStyle}
            />
          </div>

          <ToggleSlider
            checked={envSecret}
            onChange={setEnvSecret}
            label="Mask value as secret"
          />

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              marginTop: 8,
              borderTop: '1px solid var(--border)',
              paddingTop: 14,
            }}
          >
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
              {saving ? 'Saving...' : 'Save Variable'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
