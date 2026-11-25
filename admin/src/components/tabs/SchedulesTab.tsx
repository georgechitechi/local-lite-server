import { useCallback, useEffect, useState } from 'react';
import {
  type CronJob,
  type DrawerMode,
  ScheduleDrawer,
} from '@/components/ScheduleDrawer';
import type { ToastType } from '@/components/Toast';
import { adminFetch } from '@/lib/api';
import { formatTime } from '@/lib/formatters';
import {
  cardStyle,
  primaryBtnStyle,
  secondaryBtnStyle,
  sectionTitleStyle,
} from '@/styles/adminStyles';

export function SchedulesTab({
  onToast,
}: {
  onToast: (msg: string, type?: ToastType) => void;
}) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerMode>({ kind: 'closed' });

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch('/admin/crons', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.jobs)) {
        setJobs(data.jobs);
      } else {
        onToast(data?.error || 'Failed to load schedules', 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const openEditDrawer = (job: CronJob) => setDrawer({ kind: 'edit', job });

  const runJob = async (jobKey: string) => {
    setRunningKey(jobKey);
    try {
      const res = await adminFetch('/admin/crons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_key: jobKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onToast(
          jobKey === 'all'
            ? 'All enabled schedules executed.'
            : `${jobKey} executed.`,
          'info',
        );
      } else {
        onToast(data?.error || `Execution failed (${res.status})`, 'error');
      }
      await loadJobs();
    } finally {
      setRunningKey(null);
    }
  };

  const hasEnabledJobs = jobs.some((j) => j.enabled);

  return (
    <section style={cardStyle}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ ...sectionTitleStyle, margin: 0 }}>
            Scheduled Automations
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Manage standing automations, cadence, and execution results.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void loadJobs()}
            disabled={loading}
            style={secondaryBtnStyle}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setDrawer({ kind: 'create' })}
            style={secondaryBtnStyle}
          >
            + New Schedule
          </button>
          <button
            type="button"
            disabled={runningKey !== null || !hasEnabledJobs}
            onClick={() => void runJob('all')}
            style={{
              ...primaryBtnStyle,
              opacity: runningKey !== null || !hasEnabledJobs ? 0.45 : 1,
              cursor:
                runningKey !== null || !hasEnabledJobs
                  ? 'not-allowed'
                  : 'pointer',
            }}
          >
            {runningKey === 'all' ? 'Running All...' : 'Run All Enabled'}
          </button>
        </div>
      </div>

      {loading && jobs.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: 12 }}>
          Loading schedules...
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {jobs.map((job) => {
            const isRunning =
              runningKey === job.job_key || runningKey === 'all';
            return (
              <div
                key={job.job_key}
                style={{
                  padding: 14,
                  borderRadius: 10,
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <strong style={{ fontSize: 14 }}>{job.label}</strong>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: job.enabled
                          ? 'var(--success-soft)'
                          : 'var(--surface-alt)',
                        color: job.enabled ? 'var(--success)' : 'var(--muted)',
                        fontWeight: 600,
                      }}
                    >
                      {job.enabled ? 'Enabled' : 'Paused'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      <code>{job.cron}</code>
                      {job.timezone ? ` (${job.timezone})` : ''}
                    </span>
                    {job.last_status && (
                      <span
                        style={{
                          fontSize: 11,
                          padding: '2px 8px',
                          borderRadius: 999,
                          background:
                            job.last_status === 'success'
                              ? 'var(--success-soft)'
                              : 'var(--danger-soft)',
                          color:
                            job.last_status === 'success'
                              ? 'var(--success)'
                              : 'var(--danger)',
                          fontWeight: 600,
                        }}
                      >
                        {job.last_status}
                      </span>
                    )}
                  </div>
                  <p
                    style={{
                      margin: '4px 0 8px',
                      fontSize: 13,
                      color: 'var(--muted)',
                    }}
                  >
                    {job.description}
                  </p>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Last run:{' '}
                    {job.last_run_at ? formatTime(job.last_run_at) : 'Never'}
                    {job.last_duration_ms != null
                      ? ` (${job.last_duration_ms}ms)`
                      : ''}
                    {' · '}
                    Next run:{' '}
                    {job.next_run_at ? formatTime(job.next_run_at) : 'Paused'}
                    {job.last_summary ? ` — ${job.last_summary}` : ''}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => openEditDrawer(job)}
                    style={secondaryBtnStyle}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => void runJob(job.job_key)}
                    style={primaryBtnStyle}
                  >
                    {isRunning ? 'Running...' : 'Run Now'}
                  </button>
                  {!job.is_system && (
                    <button
                      type="button"
                      onClick={() => setDrawer({ kind: 'delete', job })}
                      style={{ ...secondaryBtnStyle, color: 'var(--danger)' }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ScheduleDrawer
        drawer={drawer}
        onClose={() => setDrawer({ kind: 'closed' })}
        onCreated={(job) => setJobs((prev) => [...prev, job])}
        onUpdated={(job) =>
          setJobs((prev) =>
            prev.map((j) => (j.job_key === job.job_key ? job : j)),
          )
        }
        onDeleted={(jobKey) =>
          setJobs((prev) => prev.filter((j) => j.job_key !== jobKey))
        }
        onToast={onToast}
      />
    </section>
  );
}
