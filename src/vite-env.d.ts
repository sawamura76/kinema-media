/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Skrin's own TMDB key, set at build time — see src/metadata/builtinKey.ts. */
  readonly VITE_TMDB_API_KEY?: string;
}
