/// <reference types="@rsbuild/core/types" />
/** biome-ignore-all lint/correctness/noUnusedVariables: it's a D file! */

interface ImportMetaEnv {
  readonly PUBLIC_DEBUG_BACKEND: string;
  readonly PUBLIC_DEBUG_SHOW_SNACKBAR_TIMER: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
