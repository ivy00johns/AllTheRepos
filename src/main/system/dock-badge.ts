/**
 * macOS dock badge manipulation.
 *
 * `setDockBadge(count)`:
 *   - `null` ⇒ clear the badge (`app.dock.setBadge('')`).
 *   - `0`    ⇒ clear (macOS has no canonical "0" badge).
 *   - n > 0  ⇒ render as a string (e.g. `"3"` or `"99+"` when capped).
 *
 * Guards:
 *   - macOS-only via `process.platform === 'darwin'`. Returns the
 *     effective badge string ("" when cleared) so the IPC response
 *     contract holds on every platform.
 *   - `app.dock` is optional in the Electron type defs even on macOS
 *     (cached at the wrong moment of init). We narrow defensively.
 */

import { app } from "electron";

/** Cap dock-badge numerals so a runaway count doesn't paint the dock. */
const MAX_NUMERIC = 99;

/**
 * Set (or clear) the macOS dock badge.
 *
 * Returns the resulting badge string for echo back to the renderer.
 * On non-darwin platforms we silently return `""` — the renderer
 * already treats the badge as best-effort cosmetic.
 */
export function setDockBadge(count: number | null): string {
  if (process.platform !== "darwin") {
    return "";
  }

  // `app.dock` should always exist on darwin but Electron types mark it
  // as optional. Belt + braces.
  const dock = app.dock;
  if (!dock) {
    return "";
  }

  if (count === null || count <= 0) {
    dock.setBadge("");
    return "";
  }

  const display = count > MAX_NUMERIC ? `${MAX_NUMERIC}+` : `${count}`;
  dock.setBadge(display);
  return display;
}
