/**
 * Remembering where the window was.
 *
 * The renderer keeps its route in the address (`#/graph?cluster=1&repo=…&off=…`
 * — see `renderer/router.tsx`), and that already survives a reload: adopting
 * the hash is what made "it keeps resetting on refresh" stop. It did not
 * survive a *quit*. Closing the app and opening it again put you back on the
 * catalog, and on a machine with a few hundred repos — where the map takes a
 * moment to lay out and the repo you were reading is one of five in a group —
 * "where was I" is the whole question.
 *
 * So main remembers the last fragment and hands it back on the next launch.
 *
 * It is a small JSON file in the profile rather than a key in `settings.json`
 * because it is not a preference: nothing in the app reads it, nobody edits it
 * by hand, and losing it should cost nothing but a visit to the catalog. That
 * also keeps it out of the settings schema the renderer validates, where a
 * second consumer of a UI fact would be one more thing to keep in step.
 *
 * The satellite windows are deliberately not part of this. `#window=spotlight`
 * and `#window=tray-popover` are not routes — they are how main tells one
 * bundle which window it is — so {@link restorableRoute} accepts only a
 * fragment that names a route, and the satellites have their own fixed
 * fragments in `spotlight.ts` and `tray-popover.ts`.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The file's name inside the profile. Not a route, and not user data. */
export const ROUTE_MEMORY_FILENAME = "window-route.json";

/**
 * A fragment longer than this is not a route this app can produce — the map's
 * own address is about eighty characters — and a file that grew without bound
 * would be a way to make every launch slower than the last.
 */
const MAX_ROUTE_LENGTH = 2000;

/**
 * The fragment, when it is one the app can open on.
 *
 * `#/` and `#/graph?cluster=1` are routes; `""`, `#`, `#window=spotlight` and a
 * bare `/graph` are not. Anything with a control character in it is refused
 * rather than written back into a URL.
 */
export function restorableRoute(hash: string | null | undefined): string | null {
  if (typeof hash !== "string") return null;
  const trimmed = hash.trim();
  if (!trimmed.startsWith("#/")) return null;
  if (trimmed.length > MAX_ROUTE_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

/**
 * What was remembered last time, or `null`.
 *
 * Every failure is `null`: no file (a first launch), a half-written file (the
 * app was killed mid-write), a file somebody emptied, a fragment that is no
 * longer a route. There is nothing here worth an error dialog — the catalog is
 * a perfectly good place to open.
 */
export function readLastRoute(userDataDir: string): string | null {
  try {
    const raw = fs.readFileSync(
      path.join(userDataDir, ROUTE_MEMORY_FILENAME),
      "utf8",
    );
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return restorableRoute((parsed as { route?: unknown }).route as string);
  } catch {
    return null;
  }
}

/**
 * Write the fragment down for the next launch.
 *
 * Written to a temporary name and renamed into place, so a launch that reads
 * while another writes sees the old file or the new one and never a truncated
 * one. Never throws: this is a convenience, and a full disk should not take
 * the window down.
 */
export function rememberRoute(userDataDir: string, hash: string): boolean {
  const route = restorableRoute(hash);
  if (route === null) return false;
  const file = path.join(userDataDir, ROUTE_MEMORY_FILENAME);
  const temporary = `${file}.tmp`;
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(temporary, `${JSON.stringify({ route })}\n`, "utf8");
    fs.renameSync(temporary, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * The URL to open the renderer at, with the remembered route on it.
 *
 * Both spellings of "where the renderer lives" end up here because they differ
 * in one place only — the dev server is an `http` origin and production is a
 * `file` URL — and the fragment is appended the same way to both. `loadFile`
 * cannot carry a fragment, which is why this builds the URL rather than taking
 * the path.
 */
export function rendererTarget(options: {
  /** electron-vite's dev server, when this is a dev run. */
  rendererUrl?: string | undefined;
  /** `out/renderer/index.html` as main sees it. */
  indexPath: string;
  /** A fragment from {@link restorableRoute}, or nothing. */
  route: string | null;
}): string {
  const { rendererUrl, indexPath, route } = options;
  const suffix = route ?? "";
  if (typeof rendererUrl === "string" && rendererUrl.length > 0) {
    const base = rendererUrl.endsWith("/")
      ? rendererUrl.slice(0, -1)
      : rendererUrl;
    return `${base}/${suffix}`;
  }
  return `${pathToFileURL(indexPath).toString()}${suffix}`;
}
