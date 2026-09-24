// Browser side of a conversion: upload with progress, then poll the job.
// The Go service runs the job in the background (async=1), so a slow
// conversion never holds an HTTP response open past a proxy timeout.

import type { Tool } from './tools';

export interface Job {
  id: string;
  downloadUrl: string;
}

export class ConvertError extends Error {}

/** Retries of one chunk after the first try, for a network drop or a 5xx. */
const CHUNK_RETRIES = 3;

/**
 * Uploads the file in chunks, then starts the job. onProgress receives 0..1.
 * Every request stays under Cloudflare's 100 MB body limit: the server says
 * how large a chunk may be (uploads.go).
 */
export async function startJob(
  file: File,
  tool: Tool,
  extraArgs: Record<string, string>,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<Job> {
  const started = await send('POST', '/api/uploads', null, signal);
  if (started.status !== 201 || !started.body.upload_id) {
    throw new ConvertError(messageFor(started.status, started.body));
  }
  const uploadId = started.body.upload_id;
  const chunkSize = started.body.chunk_size ?? 32 * 1024 * 1024;
  const chunks = Math.max(1, Math.ceil(file.size / chunkSize));

  let sent = 0;
  for (let n = 0; n < chunks; n++) {
    const chunk = file.slice(n * chunkSize, (n + 1) * chunkSize);
    await withRetries(signal, () =>
      send('PUT', `/api/uploads/${uploadId}/${n}`, chunk, signal, (loaded) =>
        onProgress((sent + loaded) / Math.max(1, file.size)),
      ),
    );
    sent += chunk.size;
  }

  const form = new FormData();
  form.append('op', tool.op);
  form.append('ext', tool.outputExt);
  form.append('async', '1');
  for (const [k, v] of Object.entries({ ...tool.args, ...extraArgs })) {
    form.append(k, v);
  }
  form.append('upload_id', uploadId);
  form.append('chunks', String(chunks));
  form.append('filename', file.name);
  const res = await send('POST', '/api/convert', form, signal);
  if (res.status < 200 || res.status >= 300 || !res.body.job_id) {
    throw new ConvertError(messageFor(res.status, res.body));
  }
  return {
    id: res.body.job_id,
    downloadUrl: `/api/jobs/${res.body.job_id}/output`,
  };
}

/** Network errors and 5xx answers try again, after 1, 2 and 4 seconds. */
async function withRetries(
  signal: AbortSignal,
  attempt: () => Promise<{ status: number; body: Body }>,
): Promise<void> {
  for (let tries = 0; ; tries++) {
    let res: { status: number; body: Body } | undefined;
    try {
      res = await attempt();
    } catch (e) {
      if (signal.aborted || tries >= CHUNK_RETRIES) throw e;
    }
    if (res && res.status >= 200 && res.status < 300) return;
    if (res && res.status < 500) {
      throw new ConvertError(messageFor(res.status, res.body));
    }
    if (tries >= CHUNK_RETRIES) {
      throw new ConvertError(
        res
          ? messageFor(res.status, res.body)
          : 'The upload stopped. Check your connection and try again.',
      );
    }
    await sleep(1000 * 2 ** tries, signal);
  }
}

/**
 * One request. It resolves with any HTTP status. It rejects on a network
 * error or a cancel. fetch() has no upload progress, so this uses
 * XMLHttpRequest.
 */
function send(
  method: string,
  url: string,
  body: Blob | FormData | null,
  signal: AbortSignal,
  onUpload?: (loaded: number) => void,
): Promise<{ status: number; body: Body }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Cancelled', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    if (onUpload) xhr.upload.onprogress = (e) => onUpload(e.loaded);
    xhr.onload = () =>
      resolve({ status: xhr.status, body: parse(xhr.responseText) });
    xhr.onerror = () =>
      reject(
        new ConvertError(
          'The upload stopped. Check your connection and try again.',
        ),
      );
    const onAbort = () => xhr.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    xhr.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
    xhr.onloadend = () => signal.removeEventListener('abort', onAbort);
    xhr.send(body);
  });
}

/** Resolves when the job is done. Rejects with a message for the user. */
export async function waitForJob(job: Job, signal: AbortSignal): Promise<void> {
  let delay = 500;
  for (;;) {
    await sleep(delay, signal);
    delay = Math.min(delay * 1.5, 3000);
    let res: Response;
    try {
      res = await fetch(`/api/jobs/${job.id}`, { signal, cache: 'no-store' });
    } catch (e) {
      if (signal.aborted) throw e;
      continue; // A short network drop. Try again.
    }
    const body = parse(await res.text());
    if (!res.ok) throw new ConvertError(messageFor(res.status, body));
    if (body.status === 'done') return;
    if (body.status === 'error') {
      throw new ConvertError(messageFor(422, body));
    }
  }
}

interface Body {
  job_id?: string;
  upload_id?: string;
  chunk_size?: number;
  status?: string;
  error?: string;
  message?: string;
}

function parse(text: string): Body {
  try {
    return JSON.parse(text) as Body;
  } catch {
    return {};
  }
}

// The Go errors are for developers (ffmpeg arguments, paths). Show the user
// what happened and what to do, and keep the raw error in the console.
function messageFor(status: number, body: Body): string {
  const raw = body.error ?? '';
  if (raw) console.warn('conversion error:', raw);
  if (status === 413) return raw.replace(/^file/, 'This file is');
  if (status === 402)
    return body.message ?? 'This conversion needs an account.';
  if (status === 404) {
    return 'We could not find this conversion. Files are deleted after one hour. Please convert the file again.';
  }
  const tooLong = raw.match(/video too long: .* fit in (\S+) MB/);
  if (tooLong) {
    return `This video is too long to fit in ${tooLong[1]} MB. Trim it first, or pick a larger size.`;
  }
  if (raw.includes('could not read the video duration')) {
    return 'We could not read this video. The file may be damaged.';
  }
  if (status >= 500 || status === 0) {
    return 'Something went wrong on our side. Please try again in a minute.';
  }
  return 'We could not convert this file. It may be damaged, or it may not be the type of file that this page expects.';
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Cancelled', 'AbortError'));
    });
  });
}
