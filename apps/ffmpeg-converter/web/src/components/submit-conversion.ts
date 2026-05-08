// Pure HTTP layer: POST a single file to the backend `/api/convert` endpoint
// and return a typed `ConversionJob`.
//
// Lives in its own (.ts, no JSX) module so the test runner can import it
// without pulling in any React/tsx files. `<DropZone />` and the homepage
// `<HeroDrop />` flow both call into this helper — the load-bearing path of
// the SEAN-75 fix is "homepage drop forwards the File here exactly once,
// without a second user action".

export interface ConversionJob {
  /** Backend job id, e.g. UUID. */
  jobId: string;
  /** Same-origin download URL (`/api/jobs/<id>/output`). */
  downloadUrl: string;
  /** Original input filename, used to name the downloaded result. */
  inputFilename: string;
  /** Output extension (without leading dot), e.g. `mp4`, `webp`, `mp3`. */
  outputExt: string;
}

export interface SubmitConversionArgs {
  file: File;
  goOp: string;
  outputExt: string;
  extraArgs?: Record<string, string>;
  /** Injectable for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /**
   * SEAN-81: optional abort signal. The homepage in-place flow uses this to
   * cancel the in-flight upload when the user picks a different output format
   * mid-conversion (or clicks Cancel). The backend handles connection close
   * cleanly — partial uploads are dropped on abort.
   */
  signal?: AbortSignal;
}

export async function submitConversion(
  args: SubmitConversionArgs,
): Promise<ConversionJob> {
  const { file, goOp, outputExt, extraArgs, fetchImpl, signal } = args;
  const f = fetchImpl ?? fetch;

  const form = new FormData();
  form.append('op', goOp);
  form.append('file', file);
  form.append('ext', outputExt);
  if (extraArgs) {
    for (const [k, v] of Object.entries(extraArgs)) {
      if (v !== '') form.append(k, v);
    }
  }

  const res = await f('/api/convert', {
    method: 'POST',
    body: form,
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { job_id?: string; output?: string };
  const jobId = data.job_id ?? '';
  const downloadPath = data.output ?? `/jobs/${jobId}/output`;
  return {
    jobId,
    downloadUrl: `/api${downloadPath}`,
    inputFilename: file.name,
    outputExt,
  };
}
