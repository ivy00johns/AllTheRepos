/**
 * Unit tests for the window's memory: where it was, and how big.
 *
 * Three things are worth pinning here, and each one is a way the feature could
 * go wrong quietly rather than loudly:
 *
 *   - the validator. A remembered fragment is written back into a load URL, so
 *     what it accepts is the difference between "opens where you were" and
 *     "opens a URL this app did not mean to build". `#window=spotlight` is the
 *     live example: it is how main picks a satellite's root component, it looks
 *     exactly like a fragment, and it must never be treated as a route;
 *   - the round trip. A launch that cannot read back what the last one wrote is
 *     the bug this module exists to prevent, and it is invisible without a test
 *     because the failure mode is "opens on the catalog", which is also what a
 *     first launch does;
 *   - the URL. The dev server is an `http` origin and production is a `file`
 *     URL, and the fragment has to survive both — `loadFile` cannot carry one,
 *     which is why the URL is built here rather than the handle being handed a
 *     path.
 *
 * The shape has one more failure of its own, and it is the reason
 * {@link restorableBounds} judges size and position separately: a valid position
 * can point at a monitor that has been unplugged. Keeping the size and dropping
 * the place is the difference between "opens the shape you chose, centred" and
 * "opens off the edge of a screen that is not there", and the two halves of that
 * verdict are pinned beside each other below.
 *
 * The profile directory is injected rather than read from `app`, so none of this
 * needs Electron: the same reason `main-window.ts` passes it in. So are the
 * displays, which is what lets a test describe a laptop docked to a monitor
 * without owning one.
 */

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../../helpers/tmp-dir";

import {
  WINDOW_MEMORY_FILENAME,
  readWindowMemory,
  rememberBounds,
  rememberRoute,
  rendererTarget,
  restorableBounds,
  restorableRoute,
  type WorkArea,
} from "@main/window/window-memory";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) cleanupTmp(dirs.pop());
});

function profile(): string {
  const dir = makeTmpDir("atr-window-memory");
  dirs.push(dir);
  return dir;
}

/** The built-in display of a laptop nobody has docked anything to. */
const LAPTOP: WorkArea = { x: 0, y: 25, width: 1512, height: 945 };

describe("what counts as a route worth remembering", () => {
  it("accepts the addresses the app itself writes", () => {
    // The two shapes the map and the settings screen produce, plus the catalog.
    expect(restorableRoute("#/")).toBe("#/");
    expect(restorableRoute("#/settings")).toBe("#/settings");
    expect(
      restorableRoute("#/graph?cluster=1&repo=abc&off=naming"),
    ).toBe("#/graph?cluster=1&repo=abc&off=naming");
  });

  it("refuses a satellite's fragment, which is not a route at all", () => {
    // `#window=spotlight` and `#window=tray-popover` select a root component
    // inside the same bundle. Remembering one would open the spotlight's
    // markup in the main window — a blank window with no way back.
    expect(restorableRoute("#window=spotlight")).toBeNull();
    expect(restorableRoute("#window=tray-popover")).toBeNull();
  });

  it("refuses everything that is not a fragment or not a path", () => {
    expect(restorableRoute("")).toBeNull();
    expect(restorableRoute("#")).toBeNull();
    expect(restorableRoute("/graph")).toBeNull();
    expect(restorableRoute(undefined)).toBeNull();
    expect(restorableRoute(null)).toBeNull();
  });

  it("never hands back a fragment with a control character in it", () => {
    // A newline in the middle of a load URL is how a fragment stops being only
    // a fragment, so that is refused rather than cleaned up.
    expect(restorableRoute("#/graph\nmalicious")).toBeNull();
    expect(restorableRoute("#/graph\u007f")).toBeNull();

    // Whitespace padding is trimmed instead, and the value that comes back is
    // the one without it — which is what keeps the guarantee above true at the
    // only other place a control character could arrive from.
    expect(restorableRoute("#/graph\t")).toBe("#/graph");
    expect(restorableRoute("  #/settings\n")).toBe("#/settings");
  });

  it("refuses an unbounded fragment", () => {
    // Nothing the app writes is near this; a file that grew without limit
    // would make every launch slower than the last.
    expect(restorableRoute(`#/graph?q=${"x".repeat(4000)}`)).toBeNull();
  });
});

describe("what counts as a shape worth restoring", () => {
  it("accepts a size the window itself could be, and the place it was at", () => {
    expect(
      restorableBounds(
        { width: 1440, height: 900, x: 120, y: 60 },
        { displays: [LAPTOP] },
      ),
    ).toEqual({ width: 1440, height: 900, x: 120, y: 60 });
  });

  it("refuses a size the window could never be", () => {
    // Below the window's own minimum, or nonsense: a hand-edited file, another
    // app's window, or a value `getBounds` could not have produced. The whole
    // shape goes, because there is no size here worth keeping.
    expect(restorableBounds({ width: 799, height: 900 })).toBeNull();
    expect(restorableBounds({ width: 1440, height: 599 })).toBeNull();
    expect(restorableBounds({ width: 1440.5, height: 900 })).toBeNull();
    expect(restorableBounds({ width: 1440 })).toBeNull();
    expect(restorableBounds({ width: "1440", height: "900" })).toBeNull();
    expect(restorableBounds({ width: Number.NaN, height: 900 })).toBeNull();
  });

  it("drops half a position rather than inventing the other half", () => {
    // `getBounds()` always hands back both, so a file with one of them is a file
    // somebody edited. The size is still the size they chose, so it survives and
    // the window manager places the window.
    expect(restorableBounds({ width: 1440, height: 900, x: 10 })).toEqual({
      width: 1440,
      height: 900,
    });
    expect(
      restorableBounds({ width: 1440, height: 900, y: "60" }),
    ).toEqual({ width: 1440, height: 900 });
  });

  it("refuses a shape that is not a shape at all", () => {
    expect(restorableBounds(null)).toBeNull();
    expect(restorableBounds(undefined)).toBeNull();
    expect(restorableBounds(1440)).toBeNull();
    expect(restorableBounds("1440x900")).toBeNull();
    expect(restorableBounds([])).toBeNull();
  });

  it("keeps the size and drops the place when that display is gone", () => {
    // The everyday case: a laptop was docked to a monitor, the window was
    // dragged onto it, and the next launch happens with the monitor unplugged.
    // Restoring the position would open the window off the edge of a screen
    // that is not attached; keeping the size and letting the window manager
    // centre it is the shape you chose, on the screen you are looking at.
    expect(
      restorableBounds(
        { width: 1440, height: 900, x: 2600, y: 140 },
        { displays: [LAPTOP] },
      ),
    ).toEqual({ width: 1440, height: 900 });
  });

  it("keeps a position that overlaps a display, even mostly off it", () => {
    // A window hanging over the right edge is reachable and worth restoring —
    // the test is whether enough of it is *there* to grab, not whether all of
    // it is on screen.
    expect(
      restorableBounds(
        { width: 1440, height: 900, x: 1380, y: 60 },
        { displays: [LAPTOP] },
      ),
    ).toEqual({ width: 1440, height: 900, x: 1380, y: 60 });
  });

  it("keeps the size but not a position that is a sliver of itself", () => {
    // One pixel of the window inside the display is technically visible and
    // practically lost, so it is treated as gone.
    expect(
      restorableBounds(
        { width: 1440, height: 900, x: 1511, y: 60 },
        { displays: [LAPTOP] },
      ),
    ).toEqual({ width: 1440, height: 900 });
  });

  it("judges a size with no position as a size, not as a failure", () => {
    expect(restorableBounds({ width: 1200, height: 800 })).toEqual({
      width: 1200,
      height: 800,
    });
  });

  it("restores the position when no displays were named", () => {
    // The check is about displays that are *known* to exist. With nothing to
    // compare against — the seam's default — the position is taken at its word
    // rather than refused for lack of evidence.
    expect(
      restorableBounds({ width: 1440, height: 900, x: 2600, y: 140 }),
    ).toEqual({ width: 1440, height: 900, x: 2600, y: 140 });
  });
});

describe("the round trip through the profile", () => {
  it("reads back both halves, which is the whole feature", () => {
    const dir = profile();

    expect(rememberRoute(dir, "#/graph?cluster=2&repo=abc&off=naming")).toBe(
      true,
    );
    expect(rememberBounds(dir, { width: 1440, height: 900, x: 120, y: 60 })).toBe(
      true,
    );

    expect(readWindowMemory(dir, { displays: [LAPTOP] })).toEqual({
      route: "#/graph?cluster=2&repo=abc&off=naming",
      bounds: { width: 1440, height: 900, x: 120, y: 60 },
    });
  });

  it("does not let one half erase the other", () => {
    // They are written by different moments — the route as the address changes,
    // the shape as the window is dragged — so each write is a read-modify-write.
    // A plain overwrite would mean whichever moved last erased the other, and
    // the symptom would be a launch that came back to the place without the
    // shape, or the shape without the place.
    const dir = profile();

    rememberRoute(dir, "#/settings");
    rememberBounds(dir, { width: 1000, height: 700 });
    rememberRoute(dir, "#/graph?repo=abc");

    expect(readWindowMemory(dir)).toEqual({
      route: "#/graph?repo=abc",
      bounds: { width: 1000, height: 700 },
    });
  });

  it("says nothing rather than throwing on a first launch", () => {
    expect(readWindowMemory(profile())).toEqual({ route: null, bounds: null });
  });

  it("survives a file that was emptied, truncated or hand-edited", () => {
    // Killed mid-write is a real way to arrive here, and the honest answer is
    // the catalog at the default size rather than an error dialog nobody can
    // act on.
    const dir = profile();
    const file = path.join(dir, WINDOW_MEMORY_FILENAME);

    fs.writeFileSync(file, "", "utf8");
    expect(readWindowMemory(dir)).toEqual({ route: null, bounds: null });

    fs.writeFileSync(file, '{"route":', "utf8");
    expect(readWindowMemory(dir)).toEqual({ route: null, bounds: null });

    fs.writeFileSync(file, '"just a string"', "utf8");
    expect(readWindowMemory(dir)).toEqual({ route: null, bounds: null });

    fs.writeFileSync(file, '{"route":"#window=spotlight"}', "utf8");
    expect(readWindowMemory(dir)).toEqual({ route: null, bounds: null });
  });

  it("keeps the half that is still good when the other one is not", () => {
    const dir = profile();
    fs.writeFileSync(
      path.join(dir, WINDOW_MEMORY_FILENAME),
      JSON.stringify({
        route: "#/graph?repo=abc",
        bounds: { width: 20, height: 20 },
      }),
      "utf8",
    );

    expect(readWindowMemory(dir)).toEqual({
      route: "#/graph?repo=abc",
      bounds: null,
    });
  });

  it("leaves no temporary file behind and never half-writes the real one", () => {
    // Written to a temporary name and renamed, so a second launch reading at
    // the same moment sees one whole file rather than a partial one.
    const dir = profile();
    rememberRoute(dir, "#/settings");

    expect(fs.readdirSync(dir)).toEqual([WINDOW_MEMORY_FILENAME]);
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, WINDOW_MEMORY_FILENAME), "utf8")),
    ).toEqual({ route: "#/settings", bounds: null });
  });

  it("refuses to remember something it would not read back", () => {
    const dir = profile();
    expect(rememberRoute(dir, "#window=spotlight")).toBe(false);
    expect(rememberBounds(dir, { width: 20, height: 20 })).toBe(false);
    expect(readWindowMemory(dir)).toEqual({ route: null, bounds: null });
  });
});

describe("the URL the window opens on", () => {
  it("puts the route on the dev server's origin", () => {
    expect(
      rendererTarget({
        rendererUrl: "http://localhost:5173",
        indexPath: "/tmp/nowhere/index.html",
        route: "#/graph?cluster=1",
      }),
    ).toBe("http://localhost:5173/#/graph?cluster=1");
  });

  it("does not double the slash when the dev server's URL ends in one", () => {
    expect(
      rendererTarget({
        rendererUrl: "http://localhost:5173/",
        indexPath: "/tmp/nowhere/index.html",
        route: "#/settings",
      }),
    ).toBe("http://localhost:5173/#/settings");
  });

  it("carries the route onto the bundled file URL", () => {
    // `loadFile` has no fragment argument, so production is the case that has
    // to be built by hand.
    const url = rendererTarget({
      indexPath: "/Applications/AllTheRepos/index.html",
      route: "#/graph?repo=x",
    });
    expect(url.startsWith("file://")).toBe(true);
    expect(url.endsWith("/index.html#/graph?repo=x")).toBe(true);
  });

  it("opens the plain renderer when there is nothing to restore", () => {
    expect(
      rendererTarget({
        rendererUrl: "http://localhost:5173",
        indexPath: "/tmp/nowhere/index.html",
        route: null,
      }),
    ).toBe("http://localhost:5173/");
    expect(
      rendererTarget({ indexPath: "/tmp/nowhere/index.html", route: null }),
    ).toBe("file:///tmp/nowhere/index.html");
  });
});
