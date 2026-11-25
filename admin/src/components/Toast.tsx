import { useEffect } from 'react';

export type ToastType = 'info' | 'warning' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

const TOAST_STYLES: Record<
  ToastType,
  { border: string; background: string; color: string; label: string }
> = {
  info: {
    border: 'rgba(158, 120, 220, 0.45)',
    background: '#1c1828',
    color: 'var(--text)',
    label: 'Info',
  },
  warning: {
    border: 'rgba(251, 191, 36, 0.45)',
    background: '#241f14',
    color: '#fcd34d',
    label: 'Warning',
  },
  error: {
    border: 'rgba(248, 113, 113, 0.45)',
    background: '#261619',
    color: 'var(--danger)',
    label: 'Error',
  },
};

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: 380,
        width: 'calc(100vw - 40px)',
      }}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const ms = toast.type === 'error' ? 7000 : 4500;
    const timer = window.setTimeout(() => onDismiss(toast.id), ms);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.type, onDismiss]);

  const style = TOAST_STYLES[toast.type];

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      style={{
        padding: '12px 14px',
        borderRadius: 10,
        background: style.background,
        border: `1px solid ${style.border}`,
        color: style.color,
        fontSize: 13,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        boxShadow: '0 10px 28px rgba(0, 0, 0, 0.45)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            opacity: 0.85,
          }}
        >
          {style.label}
        </span>
        <span style={{ color: 'var(--text)', lineHeight: 1.4 }}>
          {toast.message}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--muted)',
          cursor: 'pointer',
          padding: 2,
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  );
}
