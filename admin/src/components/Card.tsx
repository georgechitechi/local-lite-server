import type React from 'react';
import { cardStyle, sectionTitleStyle } from '@/styles/adminStyles';

export interface CardProps {
  header?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  toolbar?: React.ReactNode;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export function Card({
  header,
  title,
  subtitle,
  actions,
  toolbar,
  style,
  children,
}: CardProps) {
  const hasHeader =
    header != null ||
    title != null ||
    subtitle != null ||
    actions != null ||
    toolbar != null;

  return (
    <section style={{ ...cardStyle, ...style }}>
      {hasHeader && (
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            paddingBottom: 12,
            marginBottom: 14,
            borderBottom: '1px solid var(--border)',
          }}
        >
          {header ?? (
            <>
              <div>
                {title != null && (
                  <h2 style={{ ...sectionTitleStyle, margin: 0 }}>{title}</h2>
                )}
                {subtitle != null && (
                  <p
                    style={{
                      margin: '4px 0 0',
                      fontSize: 12.5,
                      color: 'var(--muted)',
                    }}
                  >
                    {subtitle}
                  </p>
                )}
              </div>

              {(toolbar != null || actions != null) && (
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    marginLeft: 'auto',
                  }}
                >
                  {toolbar}
                  {actions}
                </div>
              )}
            </>
          )}
        </header>
      )}

      {children}
    </section>
  );
}
