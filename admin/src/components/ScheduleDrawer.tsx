import { useEffect, useState } from 'react';
import { ToggleSlider } from '@/components/ToggleSlider';
import type { ToastType } from '@/components/Toast';
import { adminFetch } from '@/lib/api';
import {
  primaryBtnStyle,
  inputStyle,
  labelStyle,
  secondaryBtnStyle,
} from '@/styles/adminStyles';

export interface CronJob {
  job_key: string;
  label: string;
  description: string;
  cron: string;
  timezone: string | null;
  endpoint: string;
  is_system: boolean;
  enabled: boolean;
  last_run_at: number | null;
  next_run_at: number | null;
  last_status: 'success' | 'error' | null;
  last_summary: string | null;
  last_duration_ms: number | null;
  consecutive_failures?: number;
}

export type DrawerMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; job: CronJob }
  | { kind: 'delete'; job: CronJob };

const CRON_PRESETS = [
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Daily at 3:00 AM', value: '0 3 * * *' },
  { label: 'Daily at 8:00 AM', value: '0 8 * * *' },
  { label: 'Weekly (Sunday 4:00 AM)', value: '0 4 * * 0' },
];

const ACTION_OPTIONS = [
  { label: 'HTTP Webhook (POST)', value: 'http_webhook' },
  { label: 'Run Server Function', value: 'function_call' },
  { label: 'Trim Old Logs', value: 'trim_old_logs' },
  { label: 'Orphaned Storage Cleanup', value: 'storage_orphan_prune' },
];

const PINNED_TIMEZONES = [
  'Africa/Nairobi',
  'UTC',
  'Africa/Kampala',
  'Africa/Dar_es_Salaam',
  'Africa/Kigali',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Dubai',
];

function getTimezoneOptions(): string[] {
  const supported =
    typeof Intl !== 'undefined' &&
    typeof (Intl as any).supportedValuesOf === 'function'
      ? ((Intl as any).supportedValuesOf('timeZone') as string[])
      : [];
  const pinnedSet = new Set(PINNED_TIMEZONES);
  const rest = supported.filter((tz) => !pinnedSet.has(tz));
  return [...PINNED_TIMEZONES, ...rest];
}

const TIMEZONE_OPTIONS = getTimezoneOptions();

interface ScheduleDrawerProps {
  drawer: DrawerMode;
  onClose: () => void;
  onCreated: (job: CronJob) => void;
  onUpdated: (job: CronJob) => void;
  onDeleted: (jobKey: string) => void;
  onToast: (msg: string, type?: ToastType) => void;
}

export function ScheduleDrawer({
  drawer,
  onClose,
  onCreated,
  onUpdated,
  onDeleted,
  onToast,
}: ScheduleDrawerProps) {
  const [saving, setSaving] = useState(false);
  const [formLabel, setFormLabel] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formAction, setFormAction] = useState('http_webhook');
  const [formTarget, setFormTarget] = useState('');
  const [formCron, setFormCron] = useState('0 3 * * *');
  const [formTimezone, setFormTimezone] = useState('Africa/Nairobi');
  const [formEnabled, setFormEnabled] = useState(true);

  useEffect(() => {
    if (drawer.kind === 'create') {
      setFormLabel('');
      setFormDesc('');
      setFormAction('http_webhook');
      setFormTarget('');
      setFormCron('0 3 * * *');
      setFormTimezone('Africa/Nairobi');
      setFormEnabled(true);
    } else if (drawer.kind === 'edit') {
      setFormLabel(drawer.job.label);
      setFormDesc(drawer.job.description);
      setFormCron(drawer.job.cron || '0 3 * * *');
      setFormTimezone(drawer.job.timezone || 'Africa/Nairobi');
      setFormEnabled(drawer.job.enabled);
    }
  }, [drawer]);

  if (drawer.kind === 'closed') return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (drawer.kind !== 'create' && drawer.kind !== 'edit') return;
    if (!formLabel.trim()) {
      onToast('Schedule name is required.', 'warning');
      return;
    }
    if (!formCron.trim()) {
      onToast('Cron expression is required.', 'warning');
      return;
    }
    setSaving(true);
    try {
      if (drawer.kind === 'create') {
        const res = await adminFetch('/admin/crons', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: formLabel.trim(),
            description: formDesc.trim(),
            action_type: formAction,
            action_target:
              formAction === 'http_webhook' ? formTarget.trim() : null,
            cron: formCron.trim(),
            timezone: formTimezone || 'Africa/Nairobi',
            enabled: formEnabled,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.job) {
          onCreated(data.job);
          onClose();
          onToast('Schedule created.', 'info');
        } else {
          onToast(data?.error || 'Failed to create schedule', 'error');
        }
      } else {
        const job = drawer.job;
        const res = await adminFetch('/admin/crons', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_key: job.job_key,
            label: formLabel.trim(),
            description: formDesc.trim(),
            cron: formCron.trim(),
            timezone: formTimezone || null,
            enabled: formEnabled,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.job) {
          onUpdated(data.job);
          onClose();
          onToast('Schedule updated.', 'info');
        } else {
          onToast(data?.error || 'Failed to update schedule', 'error');
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (drawer.kind !== 'delete') return;
    const jobKey = drawer.job.job_key;
    setSaving(true);
    try {
      const res = await adminFetch(
        `/admin/crons?job_key=${encodeURIComponent(jobKey)}`,
        { method: 'DELETE' },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onDeleted(jobKey);
        onClose();
        onToast('Schedule deleted.', 'info');
      } else {
        onToast(data?.error || 'Failed to delete schedule', 'error');
      }
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
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {drawer.kind === 'create'
              ? 'New Schedule'
              : drawer.kind === 'edit'
                ? 'Edit Schedule'
                : 'Delete Schedule'}
          </h3>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            style={secondaryBtnStyle}
          >
            Close
          </button>
        </div>

        {drawer.kind === 'delete' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
              Permanently delete schedule{' '}
              <strong style={{ color: 'var(--text)' }}>
                {drawer.job.label}
              </strong>
              ? This cannot be undone.
            </p>
            <div
              style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}
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
                type="button"
                disabled={saving}
                onClick={() => void handleConfirmDelete()}
                style={{
                  ...primaryBtnStyle,
                  background: 'var(--danger)',
                }}
              >
                {saving ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => void handleSave(e)}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div>
              <div style={labelStyle}>Schedule Name</div>
              <input
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="e.g. Nightly Backup"
                style={inputStyle}
              />
            </div>

            <div>
              <div style={labelStyle}>Description</div>
              <input
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="Optional description"
                style={inputStyle}
              />
            </div>

            {drawer.kind === 'create' && (
              <>
                <div>
                  <div style={labelStyle}>Action</div>
                  <select
                    value={formAction}
                    onChange={(e) => setFormAction(e.target.value)}
                    style={inputStyle}
                  >
                    {ACTION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {formAction === 'http_webhook' && (
                  <div>
                    <div style={labelStyle}>Webhook URL</div>
                    <input
                      value={formTarget}
                      onChange={(e) => setFormTarget(e.target.value)}
                      placeholder="https://example.com/webhook"
                      style={inputStyle}
                    />
                  </div>
                )}
              </>
            )}

            <div>
              <div style={labelStyle}>Cron Schedule</div>
              <input
                value={formCron}
                onChange={(e) => setFormCron(e.target.value)}
                placeholder="0 3 * * *"
                style={{ ...inputStyle, fontFamily: 'monospace' }}
              />
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  flexWrap: 'wrap',
                  marginTop: 6,
                }}
              >
                {CRON_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setFormCron(preset.value)}
                    style={{
                      ...secondaryBtnStyle,
                      padding: '3px 8px',
                      fontSize: 11,
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={labelStyle}>Timezone</div>
              <select
                value={formTimezone}
                onChange={(e) => setFormTimezone(e.target.value)}
                style={inputStyle}
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <ToggleSlider
              checked={formEnabled}
              onChange={setFormEnabled}
              label="Schedule enabled"
            />

            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'space-between',
                marginTop: 8,
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
                style={primaryBtnStyle}
              >
                {saving
                  ? 'Saving...'
                  : drawer.kind === 'create'
                    ? 'Create Schedule'
                    : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </aside>
    </div>
  );
}
