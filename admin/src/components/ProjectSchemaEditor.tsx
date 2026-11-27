import { inputStyle, secondaryBtnStyle } from '@/styles/adminStyles';

const FIELD_TYPES = [
  'string',
  'string | null',
  'number',
  'number | null',
  'boolean',
  'boolean | null',
  'json',
  'json | null',
  'string[]',
  'string[] | null',
] as const;

const RULE_PRESETS = [
  { value: '', label: 'Default (Server Rules — owner)' },
  { value: 'authenticated', label: 'Authenticated users' },
  { value: 'owner', label: 'Row owner (owner_id / user_id)' },
  { value: 'admin', label: 'Admin / API key only' },
  { value: 'none', label: 'Deny all client access' },
] as const;

export type TableDraft = {
  name: string;
  rule: string;
  fields: Array<{ name: string; type: string }>;
};

export function schemaToDrafts(
  schema: Record<string, Record<string, string>>,
  rulesRaw: Record<string, any> = {},
): TableDraft[] {
  const entries = Object.entries(schema);
  if (entries.length === 0) return [];
  return entries.map(([name, cols]) => {
    const r = rulesRaw[name];
    return {
      name,
      rule: typeof r === 'string' ? r : '',
      fields: Object.entries(cols).map(([col, type]) => ({ name: col, type })),
    };
  });
}

export function draftsToPayload(drafts: TableDraft[]): {
  schema: Record<string, Record<string, string>>;
  rules: Record<string, string>;
} {
  const schema: Record<string, Record<string, string>> = {};
  const rules: Record<string, string> = {};
  for (const t of drafts) {
    const tableName = t.name.trim();
    if (!tableName) continue;
    const cols: Record<string, string> = {};
    for (const f of t.fields) {
      const colName = f.name.trim();
      if (colName) cols[colName] = f.type;
    }
    schema[tableName] = cols;
    if (t.rule) rules[tableName] = t.rule;
  }
  return { schema, rules };
}

export function ProjectSchemaEditor({
  drafts,
  onChange,
}: {
  drafts: TableDraft[];
  onChange: (next: TableDraft[]) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {drafts.map((tbl, ti) => (
        <div
          key={ti}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={tbl.name}
              onChange={(e) => {
                const next = [...drafts];
                next[ti] = { ...tbl, name: e.target.value };
                onChange(next);
              }}
              placeholder="table_name"
              style={{ ...inputStyle, flex: 1, fontWeight: 600 }}
            />
            <button
              type="button"
              onClick={() => onChange(drafts.filter((_, i) => i !== ti))}
              style={{
                ...secondaryBtnStyle,
                padding: '6px 10px',
                fontSize: 12,
                color: 'var(--danger)',
              }}
            >
              Remove
            </button>
          </div>

          <select
            value={tbl.rule}
            onChange={(e) => {
              const next = [...drafts];
              next[ti] = { ...tbl, rule: e.target.value };
              onChange(next);
            }}
            style={{ ...inputStyle, fontSize: 12 }}
          >
            {RULE_PRESETS.map((r) => (
              <option key={r.value} value={r.value}>
                Access Rule: {r.label}
              </option>
            ))}
          </select>

          {tbl.fields.map((f, fi) => (
            <div
              key={fi}
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <input
                value={f.name}
                onChange={(e) => {
                  const next = [...drafts];
                  const fields = [...tbl.fields];
                  fields[fi] = { ...f, name: e.target.value };
                  next[ti] = { ...tbl, fields };
                  onChange(next);
                }}
                placeholder="column_name"
                style={{ ...inputStyle, flex: '1 1 120px', minWidth: 0 }}
              />
              <select
                value={f.type}
                onChange={(e) => {
                  const next = [...drafts];
                  const fields = [...tbl.fields];
                  fields[fi] = { ...f, type: e.target.value };
                  next[ti] = { ...tbl, fields };
                  onChange(next);
                }}
                style={{ ...inputStyle, flex: '0 1 135px', minWidth: 110 }}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const next = [...drafts];
                  next[ti] = {
                    ...tbl,
                    fields: tbl.fields.filter((_, i) => i !== fi),
                  };
                  onChange(next);
                }}
                style={{
                  ...secondaryBtnStyle,
                  padding: '6px 9px',
                  fontSize: 12,
                }}
              >
                ×
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => {
              const next = [...drafts];
              next[ti] = {
                ...tbl,
                fields: [...tbl.fields, { name: '', type: 'string' }],
              };
              onChange(next);
            }}
            style={{
              ...secondaryBtnStyle,
              alignSelf: 'flex-start',
              padding: '4px 10px',
              fontSize: 12,
            }}
          >
            + Add Column
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() =>
          onChange([
            ...drafts,
            {
              name: '',
              rule: 'owner',
              fields: [{ name: 'title', type: 'string' }],
            },
          ])
        }
        style={{
          ...secondaryBtnStyle,
          alignSelf: 'flex-start',
          fontSize: 12.5,
        }}
      >
        + Add Table
      </button>
    </div>
  );
}
