/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL?: string;
  /** Canonical absolute URL of the hosted app, used for QR/session links. */
  readonly VITE_PUBLIC_APP_URL?: string;
  /** Build timestamp baked in by scripts/build-apk.mjs (shows in the footer). */
  readonly VITE_BUILD_STAMP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
