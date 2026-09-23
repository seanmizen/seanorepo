'use client';

// Home page: choose any file, then choose what to make of it.

import { useState } from 'react';
import { MAX_UPLOAD_MB, type Tool, toolsForFile } from '@/tools';
import { Converter } from './Converter';

export function HomePicker() {
  const [file, setFile] = useState<File>();
  const [tool, setTool] = useState<Tool>();
  const [key, setKey] = useState(0);

  const reset = () => {
    setFile(undefined);
    setTool(undefined);
    setKey((k) => k + 1);
  };

  if (file && tool) {
    return <Converter tool={tool} initialFile={file} onReset={reset} />;
  }

  const options = file ? toolsForFile(file) : [];

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-8">
      {!file && (
        <div className="text-center">
          <label className="inline-flex min-h-16 w-full cursor-pointer items-center justify-center rounded-xl bg-accent px-8 text-xl font-semibold text-accent-fg shadow-sm transition-colors hover:bg-accent-hover focus-within:outline focus-within:outline-4 focus-within:outline-offset-2 focus-within:outline-accent sm:w-auto">
            Choose a file
            <input
              key={key}
              type="file"
              accept="video/*,audio/*,image/*"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0])}
            />
          </label>
          <p className="mt-4 text-sm text-muted">
            Video, audio or image. Up to {MAX_UPLOAD_MB / 1024} GB.
          </p>
        </div>
      )}

      {file && (
        <div>
          <p className="truncate font-medium text-fg">{file.name}</p>
          {options.length > 0 ? (
            <>
              <h2 className="mt-4 text-lg font-semibold text-fg">
                What do you want to do?
              </h2>
              <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {options.map((t) => (
                  <li key={t.slug}>
                    <button
                      type="button"
                      onClick={() => setTool(t)}
                      className="flex min-h-14 w-full items-center rounded-xl border border-line px-4 text-left font-semibold text-fg hover:border-accent hover:bg-accent/10"
                    >
                      {labelFor(t)}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-4 text-danger" role="alert">
              We cannot convert this type of file. We convert video, audio and
              images.
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            className="mt-5 text-muted underline underline-offset-4 hover:text-fg"
          >
            Choose another file
          </button>
        </div>
      )}
    </div>
  );
}

// "MOV to MP4" reads oddly after the user chose a MOV. Say what they get.
function labelFor(t: Tool): string {
  if (t.group === 'Compress and edit') return t.name;
  const out = t.outputExt.toUpperCase();
  if (t.outputExt === 'gif') return 'Make a GIF';
  if (t.op === 'audio_mp3' || t.op === 'extract_audio') {
    return t.kind === 'video'
      ? `Save the sound as ${out}`
      : `Convert to ${out}`;
  }
  return `Convert to ${out}`;
}
