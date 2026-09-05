/// <reference types="@rsbuild/core/types" />

interface ImportMetaEnv {
  /** Base URL for backend calls. Injected by rsbuild `source.define`. */
  readonly API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
