// File → tool-page routing.
//
// Given a dropped file, return the canonical tool-page path the homepage
// should send the user to. Spec §7.1: "dropping a .mov on the homepage routes
// to /convert/mov-to-mp4".
//
// The mapping is intentionally minimal in Phase 1 — Phase 2 will expand it
// from the typed operations matrix (SEAN-38). Anything we don't recognise
// goes to the generic /convert page (which doesn't exist yet — Phase 2 ships
// it). For now, an unknown extension falls back to a search-style URL the
// user can route from manually.

const EXT_DEFAULT_TARGET: Record<string, string> = {
  // Video → MP4 by default. MOV is the headline case (iPhone footage).
  mov: '/convert/mov-to-mp4',
  webm: '/convert/webm-to-mp4',
  mkv: '/convert/mkv-to-mp4',
  avi: '/convert/avi-to-mp4',
  flv: '/convert/flv-to-mp4',
  wmv: '/convert/wmv-to-mp4',
  m4v: '/convert/m4v-to-mp4',
  mpeg: '/convert/mpeg-to-mp4',
  mpg: '/convert/mpg-to-mp4',
  // MP4 → most-asked sibling: WebM (browser-native).
  mp4: '/convert/mp4-to-webm',

  // Image → WebP is the modern web default.
  jpg: '/convert/jpg-to-webp',
  jpeg: '/convert/jpg-to-webp',
  png: '/convert/png-to-webp',
  heic: '/convert/heic-to-jpg',
  heif: '/convert/heic-to-jpg',
  bmp: '/convert/bmp-to-jpg',
  tiff: '/convert/tiff-to-jpg',
  tif: '/convert/tiff-to-jpg',

  // Audio → MP3 by default (universal).
  wav: '/convert/wav-to-mp3',
  flac: '/convert/flac-to-mp3',
  aac: '/convert/aac-to-mp3',
  ogg: '/convert/ogg-to-mp3',
  m4a: '/convert/m4a-to-mp3',
  opus: '/convert/opus-to-mp3',
};

/**
 * Lowercase extension without the leading dot, or `''` if the filename has no
 * extension.
 */
export function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Pick the tool-page path to route to for a given file. Returns `null` when
 * the extension isn't in our table — the caller should surface a friendly
 * "we don't recognise this format" message rather than dumping the user on a
 * 404.
 */
export function routeForFile(file: File | { name: string }): string | null {
  const ext = extOf(file.name);
  if (!ext) return null;
  return EXT_DEFAULT_TARGET[ext] ?? null;
}
