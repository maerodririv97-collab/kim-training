/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STUDIO_TZ?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
