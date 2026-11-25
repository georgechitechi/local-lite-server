import type React from 'react';

export const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 18,
};

export const labelStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--muted)',
  marginBottom: 6,
};

export const subLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--muted)',
  marginTop: 4,
};

export const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 14px',
  fontSize: 15.5,
  fontWeight: 600,
};

export const inputStyle: React.CSSProperties = {
  height: 42,
  padding: '0 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13.5,
  width: '100%',
};

const baseBtnStyle: React.CSSProperties = {
  height: 36,
  padding: '0 14px',
  borderRadius: 8,
  fontSize: 13,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

export const primaryBtnStyle: React.CSSProperties = {
  ...baseBtnStyle,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 600,
};

export const secondaryBtnStyle: React.CSSProperties = {
  ...baseBtnStyle,
  border: '1px solid var(--border)',
  background: 'var(--surface-alt)',
  color: 'var(--text)',
  fontWeight: 500,
};

export const paginationBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface-alt)',
  color: 'var(--text)',
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer',
};

export const pillCountStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 7px',
  borderRadius: 999,
  background: 'var(--surface-alt)',
  color: 'var(--muted)',
};

export const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

export const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontWeight: 600,
  fontSize: 12,
};

export const tdStyle: React.CSSProperties = {
  padding: '9px 10px',
};
