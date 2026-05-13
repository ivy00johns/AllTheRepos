/// <reference types="vite/client" />

/**
 * Renderer environment type declarations.
 *
 * - `vite/client` provides `import.meta.env`, asset import types, etc.
 * - `window.atr` is augmented in `@renderer/lib/atr` so renderer code
 *   that imports from there picks up the typings automatically.
 * - The backend agent owns `src/preload/index.d.ts`; once it lands we
 *   add a `/// <reference path="../preload/index.d.ts" />` here so the
 *   preload's structural typing wins over the renderer-local fallback.
 */

interface ImportMetaEnv {
  /**
   * Injected by electron-vite in dev. Points the main process at the
   * Vite dev server for HMR; the renderer itself reads it indirectly
   * via `BrowserWindow.loadURL`. Exposed here for completeness.
   */
  readonly ELECTRON_RENDERER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
