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

export function StorageBucketDrawer({
  open,
  onClose,
  onCreated,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (bucketName: string) => Promise<void> | void;
  onToast: (msg: string, type?: ToastType) => void;
}) {
  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);

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
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) {
      onToast('Bucket name is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch('/admin/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          visibility: isPrivate ? 'private' : 'public',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(data?.error || `Create bucket failed (${res.status})`, 'error');
        return;
      }
      const createdName = data.bucket?.name || trimmed;
      onToast(`Created bucket "${createdName}".`, 'info');
      setName('');
      setIsPrivate(false);
      onClose();
      await onCreated(createdName);
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
            Create Storage Bucket
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
            <label style={labelStyle}>Bucket Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="bucket-name (e.g. property-photos)"
              style={{ ...inputStyle, fontFamily: 'monospace' }}
            />
          </div>

          <ToggleSlider
            checked={isPrivate}
            onChange={setIsPrivate}
            label="Private bucket (requires signed URLs)"
          />

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              marginTop: 8,
              borderTop: '1px solid var(--border)',
              paddingTop: 14,
            }}
          >
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              style={secondaryBtnStyle}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={compactPrimaryBtnStyle}
            >
              {saving ? 'Creating...' : 'Create Bucket'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
