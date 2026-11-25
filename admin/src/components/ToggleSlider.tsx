import type { ReactNode } from 'react';

export interface ToggleSliderProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}

export function ToggleSlider({
  checked,
  onChange,
  label,
  disabled = false,
  ariaLabel,
}: ToggleSliderProps) {
  return (
    <label
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 13,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        userSelect: 'none',
      }}
    >
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          position: 'absolute',
          opacity: 0,
          width: 1,
          height: 1,
          margin: 0,
          pointerEvents: 'none',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          width: 38,
          height: 22,
          borderRadius: 999,
          padding: 2,
          boxSizing: 'border-box',
          display: 'inline-flex',
          alignItems: 'center',
          flexShrink: 0,
          background: checked ? 'var(--accent)' : 'var(--surface-alt)',
          border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
          transition: 'background 0.18s ease, border-color 0.18s ease',
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#ffffff',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.25)',
            transform: checked ? 'translateX(16px)' : 'translateX(0)',
            transition: 'transform 0.18s ease',
          }}
        />
      </span>
      {label !== undefined && <span>{label}</span>}
    </label>
  );
}
