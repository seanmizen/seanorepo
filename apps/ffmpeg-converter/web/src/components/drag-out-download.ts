// SEAN-96: Drag-out download.
//
// When a conversion finishes, the result row's filename label is draggable
// directly into Finder, the desktop, or an email/Slack compose window —
// bypassing the Downloads folder. The browser primitive that makes this work
// is `dataTransfer.setData('DownloadURL', '<mime>:<filename>:<absolute-url>')`,
// a long-standing Chromium-and-friends extension that Firefox sometimes
// honours and sometimes silently ignores. The "Download" button always
// remains as the universal fallback.
//
// This module is pure TS (no React/JSX) so the test runner can import it
// without pulling in the rest of the component tree — same pattern the
// SEAN-75 fix uses for `submit-conversion.ts`.

/**
 * MIME types for every output format the converter actually produces today.
 * Mirrored from the matrix's `outputFormat` set. If a new output format
 * lands without a MIME entry here, `mimeForExt` falls back to
 * `application/octet-stream` — the drag still works, the receiving app
 * just sees an opaque blob.
 *
 * Kept private + exported `mimeForExt()` rather than the table so callers
 * can't introduce extension-spelling bugs (`.jpeg` vs `.jpg`).
 */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  // Video
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  // Image
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  'webp-anim': 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
};

/**
 * Resolve the MIME type for an output extension. Case-insensitive. Returns
 * `application/octet-stream` when the extension is unknown — the drag still
 * works but the receiving app gets a generic blob.
 */
export function mimeForExt(ext: string): string {
  const normalised = ext.trim().toLowerCase().replace(/^\./, '');
  return MIME_BY_EXT[normalised] ?? 'application/octet-stream';
}

/**
 * Replace an input filename's extension with `outputExt`. Falls back to
 * `output.<ext>` if the input has no extension at all. Mirrors
 * `buildDownloadName` in `ResultBlock.tsx` — kept here too so the drag
 * logic can compute the same name without importing the React component.
 */
export function buildDownloadName(input: string, outputExt: string): string {
  const dot = input.lastIndexOf('.');
  const base = dot > 0 ? input.slice(0, dot) : input || 'output';
  return `${base}.${outputExt}`;
}

/**
 * Build the magic `DownloadURL` payload Chrome reads on drop:
 *
 *   `<mime>:<filename>:<absolute-url>`
 *
 * The URL has to be absolute (Chrome ignores relative URLs in this slot),
 * so callers pass `window.location.origin` as `origin`. We tolerate either
 * an already-absolute URL or a same-origin path like `/api/jobs/.../output`.
 *
 * Returns the full payload string ready to hand to
 * `event.dataTransfer.setData('DownloadURL', payload)`.
 */
export function buildDownloadUrlPayload(args: {
  downloadUrl: string;
  filename: string;
  outputExt: string;
  origin: string;
}): string {
  const { downloadUrl, filename, outputExt, origin } = args;
  const mime = mimeForExt(outputExt);
  const absolute = isAbsoluteUrl(downloadUrl)
    ? downloadUrl
    : `${origin.replace(/\/$/, '')}${
        downloadUrl.startsWith('/') ? downloadUrl : `/${downloadUrl}`
      }`;
  return `${mime}:${filename}:${absolute}`;
}

function isAbsoluteUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
}
