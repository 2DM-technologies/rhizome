/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Rhizome store. Defaults to the dev server's origin when unset. */
  readonly VITE_RHIZOME_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
