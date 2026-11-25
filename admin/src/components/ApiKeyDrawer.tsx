import { useEffect, useState } from 'react';
import type { ToastType } from '@/components/Toast';
import { adminFetch } from '@/lib/api';
import {
  inputStyle,
  labelStyle,
  primaryBtnStyle,
  secondaryBtnStyle,
} from '@/styles/adminStyles';

export function ApiKeyDrawer({
  open,
  onClose,
  onCreated,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
  onToast: (msg: string, type?: ToastType) => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('admin');
  const [userId, setUserId] = useState('');
  const [expiresInDays, setExpiresInDays] = useState<string>('0');
  const [saving, setSaving] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const handleClose = () => {
    if (saving) return;
    setCreatedKey(null);
    onClose();
  };

  useEffect(() => {
    if (!open || saving) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCreatedKey(null);
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, saving, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      onToast('Enter a name for the API key', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch('/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          role,
          userId: role === 'user' && userId.trim() ? userId.trim() : undefined,
          expiresInDays: Number(expiresInDays) || 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(data?.error || 'Failed to create API key', 'error');
        return;
      }
      setName('');
      setRole('admin');
      setUserId('');
      setExpiresInDays('0');
      setCreatedKey(data.key);
      onToast('API key created — copy it now, it will not be shown again', 'info');
      await onCreated();
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      onToast('API key copied', 'info');
    } catch {
      onToast('Copy failed — please copy manually', 'error');
    }
  };

  return (
    <div
      onClick={handleClose}
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
            {createdKey ? 'API Key Created' : 'Create API Key'}
          </h3>
          <button
            type="button"
            disabled={saving}
            onClick={handleClose}
            style={secondaryBtnStyle}
          >
            Close
          </button>
        </div>

        {createdKey ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                border: '1px solid var(--accent)',
                background: 'rgba(59, 130, 246, 0.08)',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              Save this key now. For security, it will <strong>not</strong> be shown again after you close this drawer.
            </div>

            <div>
              <label style={labelStyle}>Your API Key</label>
              <code
                style={{
                  display: 'block',
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  fontSize: 13,
                  wordBreak: 'break-all',
                }}
              >
                {createdKey}
              </code>
            </div>

            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
              <div>Usage examples:</div>
              <code style={{ display: 'block', marginTop: 4, wordBreak: 'break-all' }}>
                Authorization: Bearer {createdKey}
              </code>
              <code style={{ display: 'block', marginTop: 4, wordBreak: 'break-all' }}>
                X-API-Key: {createdKey}
              </code>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
              <button type="button" onClick={() => void handleCopy()} style={primaryBtnStyle}>
                Copy Key
              </button>
              <button type="button" onClick={handleClose} style={secondaryBtnStyle}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div>
              <label style={labelStyle}>Key Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Mobile Client"
                autoFocus
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Access Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value === 'user' ? 'user' : 'admin')}
                style={inputStyle}
              >
                <option value="admin">Admin (full access)</option>
                <option value="user">User (RLS-scoped)</option>
              </select>
            </div>

            {role === 'user' && (
              <div>
                <label style={labelStyle}>User ID (optional)</label>
                <input
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="Defaults to api_key:<id>"
                  style={inputStyle}
                />
              </div>
            )}

            <div>
              <label style={labelStyle}>Expiration</label>
              <select
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                style={inputStyle}
              >
                <option value="0">Never expires</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </select>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 10,
                marginTop: 8,
              }}
            >
              <button
                type="button"
                disabled={saving}
                onClick={handleClose}
                style={secondaryBtnStyle}
              >
                Cancel
              </button>
              <button type="submit" disabled={saving} style={primaryBtnStyle}>
                {saving ? 'Creating...' : 'Create API Key'}
              </button>
            </div>
          </form>
        )}
      </aside>
    </div>
  );
}
