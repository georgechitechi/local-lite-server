import { useEffect, type ReactNode } from 'react';
import { secondaryBtnStyle } from '@/styles/adminStyles';

export function SlideDrawer({
  open = true,
  title,
  onClose,
  disabled = false,
  maxWidth = 440,
  zIndex = 55,
  children,
}: {
  open?: boolean;
  title: string;
  onClose: () => void;
  disabled?: boolean;
  maxWidth?: number;
  zIndex?: number;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open || disabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, disabled, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={() => {
        if (!disabled) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        zIndex,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth,
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
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{title}</h3>
          <button
            type="button"
            disabled={disabled}
            onClick={onClose}
            style={secondaryBtnStyle}
          >
            Close
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}
