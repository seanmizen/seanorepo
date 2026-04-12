// URL query-string state so every preset configuration is bookmarkable.
// A preset URL looks like: /?op=transcode_webm&crf=28&audio=opus

export interface UrlState {
  op?: string;
  args: Record<string, string>;
}

const RESERVED = new Set(['op']);

export function readUrlState(): UrlState {
  const params = new URLSearchParams(window.location.search);
  const op = params.get('op') ?? undefined;
  const args: Record<string, string> = {};
  params.forEach((value, key) => {
    if (RESERVED.has(key)) return;
    args[key] = value;
  });
  return { op, args };
}

export function writeUrlState(state: UrlState): void {
  const params = new URLSearchParams();
  if (state.op) params.set('op', state.op);
  for (const [k, v] of Object.entries(state.args)) {
    if (v !== '' && v != null) params.set(k, v);
  }
  const qs = params.toString();
  const next = qs ? `?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', next);
}

export function stateToShareableUrl(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.op) params.set('op', state.op);
  for (const [k, v] of Object.entries(state.args)) {
    if (v !== '' && v != null) params.set(k, v);
  }
  const origin = window.location.origin + window.location.pathname;
  const qs = params.toString();
  return qs ? `${origin}?${qs}` : origin;
}

