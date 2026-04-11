const API_BASE = '';

export interface JobStatus {
  id: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  originalName: string;
  outputFormat: string;
  progress: number;
  error?: string;
  createdAt: string;
}

export async function getFormats(): Promise<Record<string, string[]>> {
  const res = await fetch(`${API_BASE}/api/formats`);
  if (!res.ok) throw new Error('Failed to load formats');
  return res.json();
}

export async function createJob(file: File, outputFormat: string): Promise<{ id: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('outputFormat', outputFormat);

  const res = await fetch(`${API_BASE}/api/jobs`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Upload failed (${res.status})`);
  }
  return res.json();
}

export function subscribeToJob(id: string, onEvent: (job: JobStatus) => void): () => void {
  const es = new EventSource(`${API_BASE}/api/jobs/${id}/events`);
  es.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      // ignore malformed events
    }
  };
  return () => es.close();
}

export function downloadUrl(id: string): string {
  return `${API_BASE}/api/jobs/${id}/download`;
}
