import { useEffect, useRef, useState } from 'react';
import { DropZone } from '@/components/DropZone';
import { FormatPicker } from '@/components/FormatPicker';
import { createJob, downloadUrl, getFormats, subscribeToJob, type JobStatus } from '@/api/client';

type Stage =
  | { name: 'idle' }
  | { name: 'picked'; file: File; inputExt: string; formats: string[] }
  | { name: 'converting'; jobId: string; job: JobStatus }
  | { name: 'done'; jobId: string; downloadName: string }
  | { name: 'error'; message: string };

export default function App() {
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const [formatsMap, setFormatsMap] = useState<Record<string, string[]>>({});
  const [selectedFmt, setSelectedFmt] = useState('');
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    getFormats().then(setFormatsMap).catch(console.error);
  }, []);

  // Clean up SSE on unmount.
  useEffect(() => () => unsubRef.current?.(), []);

  const handleFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const formats = formatsMap[ext] ?? [];
    if (formats.length === 0) {
      setStage({ name: 'error', message: `Unsupported format: .${ext || '???'}` });
      return;
    }
    setSelectedFmt(formats[0]);
    setStage({ name: 'picked', file, inputExt: ext, formats });
  };

  const handleConvert = async () => {
    if (stage.name !== 'picked') return;

    let jobId: string;
    try {
      const res = await createJob(stage.file, selectedFmt);
      jobId = res.id;
    } catch (e) {
      setStage({ name: 'error', message: String(e) });
      return;
    }

    const initialJob: JobStatus = {
      id: jobId,
      status: 'queued',
      originalName: stage.file.name,
      outputFormat: selectedFmt,
      progress: 0,
      createdAt: new Date().toISOString(),
    };
    setStage({ name: 'converting', jobId, job: initialJob });

    unsubRef.current = subscribeToJob(jobId, (updatedJob) => {
      if (updatedJob.status === 'done') {
        unsubRef.current?.();
        const base = stage.file.name.replace(/\.[^.]+$/, '');
        setStage({ name: 'done', jobId, downloadName: `${base}.${selectedFmt}` });
      } else if (updatedJob.status === 'error') {
        unsubRef.current?.();
        setStage({ name: 'error', message: updatedJob.error ?? 'Conversion failed' });
      } else {
        setStage((prev) =>
          prev.name === 'converting' ? { ...prev, job: updatedJob } : prev,
        );
      }
    });
  };

  const reset = () => {
    unsubRef.current?.();
    setStage({ name: 'idle' });
    setSelectedFmt('');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1rem',
      }}
    >
      <header style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.03em' }}>
          Converter
        </h1>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.4rem' }}>
          Video · Audio · Images — fast, free, private
        </p>
      </header>

      <main style={{ width: '100%', maxWidth: '520px' }}>
        {/* Idle / picking */}
        {(stage.name === 'idle' || stage.name === 'picked') && (
          <>
            <DropZone onFile={handleFile} />

            {stage.name === 'picked' && (
              <>
                <FormatPicker
                  inputExt={stage.inputExt}
                  formats={stage.formats}
                  selected={selectedFmt}
                  onChange={setSelectedFmt}
                />

                <div
                  style={{
                    marginTop: '1rem',
                    padding: '0.75rem 1rem',
                    background: 'var(--surface)',
                    borderRadius: 'var(--radius)',
                    fontSize: '0.875rem',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {stage.file.name}
                  </span>
                  <span style={{ flexShrink: 0, marginLeft: '1rem' }}>
                    {(stage.file.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleConvert}
                  style={{
                    marginTop: '1rem',
                    width: '100%',
                    padding: '0.8rem',
                    borderRadius: 'var(--radius)',
                    border: 'none',
                    background: 'var(--accent)',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: '1rem',
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                >
                  Convert to .{selectedFmt}
                </button>
              </>
            )}
          </>
        )}

        {/* Converting */}
        {stage.name === 'converting' && (
          <div
            style={{
              background: 'var(--surface)',
              borderRadius: 'var(--radius)',
              padding: '2rem',
              textAlign: 'center',
            }}
          >
            <p style={{ marginBottom: '1rem', fontWeight: 600 }}>
              {stage.job.status === 'queued' ? 'Queued…' : 'Converting…'}
            </p>
            <div
              role="progressbar"
              aria-valuenow={stage.job.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Conversion progress"
              style={{
                height: '6px',
                borderRadius: '3px',
                background: 'var(--border)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: stage.job.progress > 0 ? `${stage.job.progress}%` : '100%',
                  background: 'var(--accent)',
                  borderRadius: '3px',
                  transition: 'width 0.3s',
                  animation: stage.job.progress === 0 ? 'pulse 1.5s ease-in-out infinite' : undefined,
                }}
              />
            </div>
            {stage.job.progress > 0 && (
              <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                {stage.job.progress}%
              </p>
            )}
            <style>{`
              @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.4; }
              }
            `}</style>
          </div>
        )}

        {/* Done */}
        {stage.name === 'done' && (
          <div
            style={{
              background: 'var(--surface)',
              borderRadius: 'var(--radius)',
              padding: '2rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>✅</div>
            <p style={{ fontWeight: 600, marginBottom: '1.25rem' }}>Done!</p>
            <a
              href={downloadUrl(stage.jobId)}
              download={stage.downloadName}
              style={{
                display: 'block',
                padding: '0.8rem',
                borderRadius: 'var(--radius)',
                background: 'var(--accent)',
                color: '#fff',
                fontWeight: 600,
                fontSize: '1rem',
                textDecoration: 'none',
                textAlign: 'center',
              }}
            >
              Download {stage.downloadName}
            </a>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: '0.75rem',
                width: '100%',
                padding: '0.7rem',
                borderRadius: 'var(--radius)',
                border: '1.5px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-muted)',
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Convert another file
            </button>
          </div>
        )}

        {/* Error */}
        {stage.name === 'error' && (
          <div
            style={{
              background: 'var(--surface)',
              borderRadius: 'var(--radius)',
              padding: '2rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⚠️</div>
            <p style={{ color: 'var(--error)', fontWeight: 600, marginBottom: '1rem' }}>
              {stage.message}
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: '0.7rem 1.5rem',
                borderRadius: 'var(--radius)',
                border: '1.5px solid var(--border)',
                background: 'transparent',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        )}
      </main>

      <footer
        style={{
          marginTop: '3rem',
          color: 'var(--text-muted)',
          fontSize: '0.8rem',
          textAlign: 'center',
        }}
      >
        Files are deleted automatically after 1 hour · Powered by ffmpeg
      </footer>
    </div>
  );
}
