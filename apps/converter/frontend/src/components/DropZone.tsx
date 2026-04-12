import { type ChangeEvent, type DragEvent, useRef, useState } from 'react';

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function DropZone({ onFile, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    // reset so the same file can be re-selected
    e.target.value = '';
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Drop a file here or click to browse"
      aria-disabled={disabled}
      style={{
        border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        padding: '3rem 2rem',
        textAlign: 'center',
        cursor: disabled ? 'default' : 'pointer',
        background: dragging ? 'var(--accent-dim)' : 'var(--surface)',
        transition: 'border-color 0.15s, background 0.15s',
        opacity: disabled ? 0.5 : 1,
        userSelect: 'none',
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' '))
          inputRef.current?.click();
      }}
    >
      <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📁</div>
      <p style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
        Drop a file here
      </p>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        or <span style={{ color: 'var(--accent)' }}>browse</span> to choose
      </p>
      <p
        style={{
          color: 'var(--text-muted)',
          fontSize: '0.8rem',
          marginTop: '0.75rem',
        }}
      >
        Video · Audio · Image — up to 500 MB
      </p>
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleChange}
        tabIndex={-1}
      />
    </div>
  );
}
