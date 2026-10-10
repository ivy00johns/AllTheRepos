/**
 * Remembering where the window was — the place, and the shape.
 *
 * The renderer keeps its route in the address (`#/graph?cluster=1&repo=…&off=…`
 * — see `renderer/router.tsx`), and that already survives a reload: adopting
 * the hash is what made "it keeps resetting on refresh" stop. It did not
 * survive a *quit*. Closing the app and opening it again put you back on the
 * catalog, at the size it felt like. On a machine with a few hundred repos —
 * where the map takes a moment to lay out, the repo you were reading is one of
 * five in a group, and a window you sized for two panes is not the shape the
 * default gives you — both halves of that are the question "where was I".
 *
 * So main remembers both and hands them back on the next launch.
 *
 * It is a small JSON file in the profile rather than keys in `settings.json`
 * because this is not a preference: nothing in the app reads it, nobody edits it
 * by hand, and losing it should cost nothing but a visit to the catalog at the
 * default size. That also keeps it out of the settings schema the renderer
 * validates, where a second consumer of a UI fact would be one more thing to
 * keep in step.
 *
 * The satellite windows are deliberately not part of this. `#window=spotlight`
 * and `#window=tray-popover` are not routes — they are how main tells one bundle
 * which window it is — so {@link restorableRoute} accepts only a fragment that
 * names a route, and neither satellite is restored at a remembered size.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The file's name inside the profile. Not a route, and not user data. */
export const WINDOW_MEMORY_FILENAME = "window-memory.json";

/** The window's size, and its position when it has one worth restoring. */
export interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

/** A display's usable rectangle, as `screen.getAllDisplays()` reports it. */
export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What was remembered: each half may be missing, and often is on a first run. */
export interface WindowMemory {
  route: string | null;
  bounds: WindowBounds | null;
}

/** The window cannot be smaller than this, so neither can a remembered size. */
export const MIN_WINDOW_WIDTH = 800;
export const MIN_WINDOW_HEIGHT = 600;

/**
 * No display is this large, and a file that said so is a file somebody edited.
 * Bounding it keeps the window from being created at a size no card can draw.
 */
const MAX_WINDOW_SIDE = 20_000;

/**
 * A fragment longer than this is not a route this app can produce — the map's
 * own address is about eighty characters — and a file that grew without bound
 * would be a way to make every launch slower than the last.
 */
const MAX_ROUTE_LENGTH = 2000;

/**
 * How much of the window has to land on a display for its position to be worth
 * restoring. A window one pixel inside an edge is technically reachable and
 * practically lost, so the test is whether enough of it is *there* to grab.
 */
const MIN_VISIBLE_WIDTH = 120;
const MIN_VISIBLE_HEIGHT = 40;

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

function isSide(value: unknown, minimum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= MAX_WINDOW_SIDE
  );
}

function isCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Math.abs(value) <= MAX_WINDOW_SIDE
  );
}

/** How much of `bounds` sits inside this display's usable area. */
function visibleArea(
  bounds: { x: number; y: number; width: number; height: number },
  work: WorkArea,
): { width: number; height: number } {
  const width =
    Math.min(bounds.x + bounds.width, work.x + work.width) -
    Math.max(bounds.x, work.x);
  const height =
    Math.min(bounds.y + bounds.height, work.y + work.height) -
    Math.max(bounds.y, work.y);
  return { width: Math.max(width, 0), height: Math.max(height, 0) };
}

/**
 * The window's shape, when it is one this app can open at.
 *
 * Size and position are judged separately, because they fail differently. A size
 * outside what the window itself allows is simply not a size — it is a
 * hand-edited file or another app's window — so the whole thing is dropped. A
 * position can be perfectly valid and still point at a monitor that is not
 * plugged in any more, which is an ordinary thing to happen to a laptop, so the
 * **size is kept and the position is dropped**: the window reopens the shape you
 * chose, centred, rather than off the edge of a screen that is not there.
 */
export function restorableBounds(
  value: unknown,
  options: { displays?: WorkArea[] } = {},
): WindowBounds | null {
  if (typeof value !== "object" || value === null) return null;
  const { width, height, x, y } = value as Record<string, unknown>;

  if (!isSide(width, MIN_WINDOW_WIDTH) || !isSide(height, MIN_WINDOW_HEIGHT)) {
    return null;
  }
  if (!isCoordinate(x) || !isCoordinate(y)) return { width, height };

  const displays = options.displays ?? [];
  if (displays.length > 0) {
    const reachable = displays.some((work) => {
      const visible = visibleArea({ x, y, width, height }, work);
      return (
        visible.width >= MIN_VISIBLE_WIDTH && visible.height >= MIN_VISIBLE_HEIGHT
      );
    });
    if (!reachable) return { width, height };
  }

  return { width, height, x, y };
}

/** The file's contents as written, without interpreting them. */
function readRaw(userDataDir: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(path.join(userDataDir, WINDOW_MEMORY_FILENAME), "utf8"),
    );
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, unknown>;
  } catch {
    // No file (a first launch), a half-written file (the app was killed
    // mid-write), an empty file, something that is not JSON at all. There is
    // nothing here worth an error dialog: the catalog at the default size is a
    // perfectly good place to open.
    return {};
  }
}

/**
 * Write the file, whole, by renaming a temporary one over it.
 *
 * So a launch that reads while another writes sees the old file or the new one
 * and never a truncated one. Never throws: this is a convenience, and a full
 * disk should not take the window down.
 */
function writeMemory(userDataDir: string, memory: WindowMemory): boolean {
  const file = path.join(userDataDir, WINDOW_MEMORY_FILENAME);
  const temporary = `${file}.tmp`;
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(temporary, `${JSON.stringify(memory)}\n`, "utf8");
    fs.renameSync(temporary, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * What was remembered last time, each half validated on the way out.
 *
 * `displays` is passed in rather than reached for so the position check is the
 * same function the tests drive, and so this module needs no Electron: main has
 * a `screen`, and this file only needs to know what it said.
 */
export function readWindowMemory(
  userDataDir: string,
  options: { displays?: WorkArea[] } = {},
): WindowMemory {
  const raw = readRaw(userDataDir);
  return {
    route: restorableRoute(raw.route as string),
    bounds: restorableBounds(raw.bounds, options),
  };
}

/**
 * Remember the fragment, keeping the shape that was already written.
 *
 * Read-modify-write because the two halves are written by different moments —
 * the route as the address changes, the shape as the window is dragged — and a
 * plain overwrite here would mean whichever moved last erased the other.
 */
export function rememberRoute(userDataDir: string, hash: string): boolean {
  const route = restorableRoute(hash);
  if (route === null) return false;
  const existing = readWindowMemory(userDataDir);
  return writeMemory(userDataDir, { route, bounds: existing.bounds });
}

/** Remember the shape, keeping the fragment that was already written. */
export function rememberBounds(
  userDataDir: string,
  bounds: unknown,
): boolean {
  // Validated on the way in as well as out: what arrives is
  // `window.getBounds()`, which is already the window's truth, and a value that
  // fails this is not a shape worth remembering.
  const shape = restorableBounds(bounds);
  if (shape === null) return false;
  const existing = readWindowMemory(userDataDir);
  return writeMemory(userDataDir, { route: existing.route, bounds: shape });
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
