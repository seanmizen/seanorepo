/// <reference types="@rsbuild/core/types" />

interface ImportMetaEnv {
  /** The base URL for backend calls. rsbuild `source.define` injects it. */
  readonly API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
