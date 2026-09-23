// Browser side of a conversion: upload with progress, then poll the job.
// The Go service runs the job in the background (async=1), so a slow
// conversion never holds an HTTP response open past a proxy timeout.

import type { Tool } from './tools';

export interface Job {
  id: string;
  downloadUrl: string;
}

export class ConvertError extends Error {}

/** Uploads the file. onProgress receives 0..1. */
export function startJob(
  file: File,
  tool: Tool,
  extraArgs: Record<string, string>,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<Job> {
  const form = new FormData();
  form.append('op', tool.op);
  form.append('ext', tool.outputExt);
  form.append('async', '1');
  for (const [k, v] of Object.entries({ ...tool.args, ...extraArgs })) {
    form.append(k, v);
  }
  form.append('file', file);

  // fetch() has no upload progress, so this uses XMLHttpRequest.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/convert');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = parse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300 && body.job_id) {
        resolve({
          id: body.job_id,
          downloadUrl: `/api/jobs/${body.job_id}/output`,
        });
      } else {
        reject(new ConvertError(messageFor(xhr.status, body)));
      }
    };
    xhr.onerror = () =>
      reject(
        new ConvertError(
          'The upload stopped. Check your connection and try again.',
        ),
      );
    signal.addEventListener('abort', () => xhr.abort());
    xhr.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
    xhr.send(form);
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
