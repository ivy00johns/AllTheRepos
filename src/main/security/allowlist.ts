/**
 * `shell.openExternal` allowlist.
 *
 * Per NEW-PLAN.md §3.4, every external URL handed to `shell.openExternal`
 * MUST be filtered through this allowlist. Anything that isn't an
 * `https:` URL or a known editor / app URL scheme is rejected.
 *
 * Phase 0 ships the helper so Phase 1 frontend code can call it directly
 * via an IPC handler. We do NOT register any `openExternal` IPC channels
 * yet — that's Phase 1's launcher namespace.
 */

import { shell } from "electron";

/**
 * URL schemes we trust to forward to the OS. Update this list — not the
 * call sites — when adding a new launcher (e.g. a new editor protocol).
 *
 * Phase 3a additions (launcher namespace): `windsurf:`, `goland:`,
 * `clion:`, `rubymine:`, `warp:`. JetBrains family (`idea:`, `webstorm:`,
 * `pycharm:`, `rider:`, `goland:`, `clion:`, `rubymine:`) all use the
 * `open?file=` query-string form built in `services/launcher.ts`.
 * `warp:` is `warp://action/open_path?path=…` for Warp terminal.
 * `xcode:` remains allowed for forward-compat even though Xcode is
 * currently dispatched via `open -a Xcode <path>` (no URL scheme).
 */
export const ALLOWED_EXTERNAL_SCHEMES: ReadonlyArray<string> = [
  "https:",
  "vscode:",
  "vscode-insiders:",
  "cursor:",
  "zed:",
  "windsurf:",
  "devin:",
  "idea:",
  "webstorm:",
  "pycharm:",
  "rider:",
  "goland:",
  "clion:",
  "rubymine:",
  "xcode:",
  "subl:",
  "warp:",
  "alltherepos:",
];

export interface OpenExternalResult {
  ok: boolean;
  reason?: string;
}

/**
 * True if the URL's scheme is in {@link ALLOWED_EXTERNAL_SCHEMES}.
 * Exposed for unit tests and for renderer-side preflight checks
 * (the authoritative check still happens in the main process).
 */
export function isUrlAllowed(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return ALLOWED_EXTERNAL_SCHEMES.includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Wrapped `shell.openExternal`. Returns a discriminated result rather
 * than throwing so it composes cleanly into IPC handlers.
 */
export async function openExternalAllowlisted(
  rawUrl: string,
): Promise<OpenExternalResult> {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return { ok: false, reason: "empty_url" };
  }
  if (!isUrlAllowed(rawUrl)) {
    return { ok: false, reason: "scheme_not_allowed" };
  }
  try {
    await shell.openExternal(rawUrl);
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "open_failed";
    return { ok: false, reason };
  }
}
