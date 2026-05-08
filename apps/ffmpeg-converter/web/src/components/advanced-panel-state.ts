// SEAN-95 — Pure state helpers for the Advanced disclosure panel.
//
// Lives outside the .tsx file so the test runner (`node --test` via ts-node,
// no JSDOM) can import these without dragging React in. The .tsx component
// re-exports for ergonomic imports at call sites that already use the
// component.

import type { UrlState } from './url-state';

export interface AdvancedFormState {
  crf: string;
  bitrate: string;
  preset: string;
  fps: string;
  audio_bitrate: string;
  codec: string;
}

export interface AdvancedDefaults {
  crf: number;
  preset: string;
  bitrate: string;
  fps: string;
  audio_bitrate: string;
  codec: string;
}

/**
 * Hydrate form state from a URL-state snapshot, falling back to per-row
 * defaults. Pure, testable. URL > defaults (ConverterPanel handles row
 * preset → defaults; this layer just merges URL on top).
 */
export function hydrateFormState(
  urlState: UrlState,
  defaults: AdvancedDefaults,
): AdvancedFormState {
  return {
    crf: urlState.crf ?? String(defaults.crf),
    bitrate: urlState.bitrate ?? defaults.bitrate,
    preset: urlState.preset ?? defaults.preset,
    fps: urlState.fps ?? defaults.fps,
    audio_bitrate: urlState.audio_bitrate ?? defaults.audio_bitrate,
    codec: urlState.codec ?? defaults.codec,
  };
}

/**
 * Build the URL-state object from the form. Empty fields drop out entirely
 * so the URL stays minimal — only non-default explicit overrides survive.
 *
 * CRF default special-case: when the form's CRF matches the row default AND
 * no bitrate is set, we drop CRF from the URL too. Otherwise every page load
 * would write the default CRF back into the URL on first interaction, which
 * is noisy and breaks the "URL stays clean unless you customise" contract.
 *
 * Same rule for preset (drops when matching the row default).
 */
export function formStateToUrl(
  form: AdvancedFormState,
  defaults: { crf: number; preset: string },
): UrlState {
  const out: Record<string, string> = {};
  if (form.crf && form.crf !== String(defaults.crf)) out.crf = form.crf;
  if (form.bitrate) out.bitrate = form.bitrate;
  if (form.preset && form.preset !== defaults.preset) out.preset = form.preset;
  if (form.fps) out.fps = form.fps;
  if (form.audio_bitrate) out.audio_bitrate = form.audio_bitrate;
  if (form.codec) out.codec = form.codec;
  return out;
}
