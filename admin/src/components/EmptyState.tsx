import type React from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div
      style={{
        padding: '28px 16px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>
        {title}
      </div>
      {description && (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', maxWidth: 420 }}>
          {description}
        </div>
      )}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}
