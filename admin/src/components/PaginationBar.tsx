import { paginationBtnStyle } from '@/styles/adminStyles';

export function PaginationBar({
  total,
  offset,
  count,
  unit = 'row',
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  total: number;
  offset: number;
  count: number;
  unit?: string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const rangeLabel =
    total === 0 ? `0 ${unit}s` : `${offset + 1}–${offset + count} of ${total}`;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        marginTop: 14,
        paddingTop: 12,
        borderTop: '1px solid var(--border)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{rangeLabel}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={!hasPrev}
          onClick={onPrev}
          style={{
            ...paginationBtnStyle,
            opacity: hasPrev ? 1 : 0.4,
            cursor: hasPrev ? 'pointer' : 'not-allowed',
          }}
        >
          Prev
        </button>
        <button
          type="button"
          disabled={!hasNext}
          onClick={onNext}
          style={{
            ...paginationBtnStyle,
            opacity: hasNext ? 1 : 0.4,
            cursor: hasNext ? 'pointer' : 'not-allowed',
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
