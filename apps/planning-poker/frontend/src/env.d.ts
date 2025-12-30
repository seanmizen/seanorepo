/// <reference types="@rsbuild/core/types" />
/** biome-ignore-all lint/correctness/noUnusedVariables: it's a D file! */

interface ImportMetaEnv {
  readonly PUBLIC_DEBUG_BACKEND: string;
  readonly PUBLIC_DEBUG_SHOW_SNACKBAR_TIMER: string;
  readonly PUBLIC_DEBUG_SHOW_ATTENDEE_ID: string;
  readonly PUBLIC_DEBUG_SHOW_REFRESH_BUTTON: string;
  readonly PUBLIC_DEBUG_WS_UPDATES: string;
  readonly PUBLIC_SHOW_DISCLAIMER: string;
  readonly PUBLIC_HIDE_COPY_URL_BUTTON: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
