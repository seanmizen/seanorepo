interface Props {
  inputExt: string;
  formats: string[];
  selected: string;
  onChange: (fmt: string) => void;
}

export function FormatPicker({ inputExt, formats, selected, onChange }: Props) {
  return (
    <div style={{ marginTop: '1.5rem' }}>
      <p style={{ marginBottom: '0.75rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        Convert <strong style={{ color: 'var(--text)' }}>.{inputExt}</strong> to:
      </p>
      <div
        role="group"
        aria-label="Output format"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        {formats.map((fmt) => (
          <button
            key={fmt}
            type="button"
            aria-pressed={selected === fmt}
            onClick={() => onChange(fmt)}
            style={{
              padding: '0.4rem 0.9rem',
              borderRadius: '6px',
              border: `1.5px solid ${selected === fmt ? 'var(--accent)' : 'var(--border)'}`,
              background: selected === fmt ? 'var(--accent-dim)' : 'var(--surface)',
              color: selected === fmt ? 'var(--text)' : 'var(--text-muted)',
              fontWeight: selected === fmt ? 600 : 400,
              fontSize: '0.875rem',
              transition: 'border-color 0.12s, background 0.12s, color 0.12s',
              cursor: 'pointer',
            }}
          >
            .{fmt}
          </button>
        ))}
      </div>
    </div>
  );
}
