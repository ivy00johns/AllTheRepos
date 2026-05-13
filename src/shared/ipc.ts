/**
 * CONTRACT v1 — IPC channel name registry.
 *
 * All IPC channel names used by main / preload / renderer MUST be
 * referenced through this module. Hard-coded strings in `ipcMain.handle`
 * or `ipcRenderer.invoke` are a contract violation.
 *
 * Channels are namespaced by domain with a `:` separator
 * (e.g. `system:ping`, `catalog:list`). Phase 0 only registers the
 * `system` namespace; future phases will add `catalog:*`, `git:*`,
 * `scan:*`, `claude:*`, `process:*`, `launcher:*`, `settings:*`.
 *
 * The literal-string `as const` typing here is what lets TypeScript
 * pin channel names so a typo in a handler key becomes a compile error.
 */

/**
 * Phase 0 IPC channel map. Add new channels here as later phases unlock.
 *
 * Convention: `<namespace>:<verb>` — namespace is lowercase, single word
 * where possible. Use `<namespace>:on:<event>` for push-style streams.
 */
export const IPC = {
  /** System namespace — health checks, app lifecycle, version info. */
  SYSTEM: {
    /** Trivial round-trip used to validate the preload bridge. */
    PING: "system:ping",
  },
} as const;

/** Flat union of every registered channel name (compile-time only). */
export type IpcChannel = typeof IPC.SYSTEM[keyof typeof IPC.SYSTEM];

/** Phase 0 — the renderer surface exposed on `window.atr`. */
export const PRELOAD_BRIDGE_KEY = "atr" as const;
export type PreloadBridgeKey = typeof PRELOAD_BRIDGE_KEY;
