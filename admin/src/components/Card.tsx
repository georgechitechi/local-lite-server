import type React from 'react';
import { cardStyle, sectionTitleStyle } from '@/styles/adminStyles';

export interface CardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  toolbar?: React.ReactNode;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export function Card({
  title,
  subtitle,
  actions,
  toolbar,
  style,
  children,
}: CardProps) {
  return (
    <section style={{ ...cardStyle, ...style }}>
      {(title != null || actions != null) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div>
            {title != null && (
              <h2 style={{ ...sectionTitleStyle, margin: 0 }}>{title}</h2>
            )}
            {subtitle != null && (
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
                {subtitle}
              </p>
            )}
          </div>
          {actions != null && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {actions}
            </div>
          )}
        </div>
      )}

      {toolbar != null && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            marginBottom: 14,
            flexWrap: 'wrap',
          }}
        >
          {toolbar}
        </div>
      )}

      {children}
    </section>
  );
}
