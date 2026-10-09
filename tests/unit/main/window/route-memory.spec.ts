/**
 * Unit tests for the window's route memory.
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
 * The profile directory is injected rather than read from `app`, so none of
 * this needs Electron: the same reason `main-window.ts` passes it in.
 */

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../../helpers/tmp-dir";

import {
  ROUTE_MEMORY_FILENAME,
  readLastRoute,
  rememberRoute,
  rendererTarget,
  restorableRoute,
} from "@main/window/route-memory";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) cleanupTmp(dirs.pop());
});

function profile(): string {
  const dir = makeTmpDir("atr-route-memory");
  dirs.push(dir);
  return dir;
}

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

describe("the round trip through the profile", () => {
  it("reads back what it wrote, which is the whole feature", () => {
    const dir = profile();

    expect(rememberRoute(dir, "#/graph?cluster=2&repo=abc&off=naming")).toBe(
      true,
    );
    expect(readLastRoute(dir)).toBe("#/graph?cluster=2&repo=abc&off=naming");
  });

  it("says nothing rather than throwing on a first launch", () => {
    expect(readLastRoute(profile())).toBeNull();
  });

  it("survives a file that was emptied, truncated or hand-edited", () => {
    // Killed mid-write is a real way to arrive here, and the honest answer is
    // the catalog rather than an error dialog nobody can act on.
    const dir = profile();
    const file = path.join(dir, ROUTE_MEMORY_FILENAME);

    fs.writeFileSync(file, "", "utf8");
    expect(readLastRoute(dir)).toBeNull();

    fs.writeFileSync(file, '{"route":', "utf8");
    expect(readLastRoute(dir)).toBeNull();

    fs.writeFileSync(file, '"just a string"', "utf8");
    expect(readLastRoute(dir)).toBeNull();

    fs.writeFileSync(file, '{"route":"#window=spotlight"}', "utf8");
    expect(readLastRoute(dir)).toBeNull();
  });

  it("leaves no temporary file behind and never half-writes the real one", () => {
    // Written to a temporary name and renamed, so a second launch reading at
    // the same moment sees one whole file rather than a partial one.
    const dir = profile();
    rememberRoute(dir, "#/settings");

    expect(fs.readdirSync(dir)).toEqual([ROUTE_MEMORY_FILENAME]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, ROUTE_MEMORY_FILENAME), "utf8"))).toEqual({
      route: "#/settings",
    });
  });

  it("refuses to remember something it would not read back", () => {
    const dir = profile();
    expect(rememberRoute(dir, "#window=spotlight")).toBe(false);
    expect(readLastRoute(dir)).toBeNull();
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
