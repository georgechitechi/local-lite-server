import { useState } from 'react';
import { SlideDrawer } from '@/components/SlideDrawer';
import { ToggleSlider } from '@/components/ToggleSlider';
import type { ToastType } from '@/components/Toast';
import { adminFetch } from '@/lib/api';
import {
  primaryBtnStyle,
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
    <SlideDrawer
      open={open}
      title="Create Storage Bucket"
      onClose={onClose}
      disabled={saving}
    >
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
            justifyContent: 'space-between',
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
          <button type="submit" disabled={saving} style={primaryBtnStyle}>
            {saving ? 'Creating...' : 'Create Bucket'}
          </button>
        </div>
      </form>
    </SlideDrawer>
  );
}
