/**
 * The order a launch does things in (ATR-055).
 *
 * The defect was positional: `app.whenReady()` awaited the process scan, the
 * editor detection and the whole Claude index *before* `createMainWindow()`, so
 * a launch could not paint until every service was up. Nothing about that is
 * observable from a unit test of any single module — it is a property of the
 * main entry's sequence — and the behaviours it protects are the ones a handler
 * has to uphold, which is where a regression would quietly land: move the
 * window back, or add a handler that forgets to await its service, and the app
 * still works, just slowly, or with one panel reading empty state.
 *
 * So this reads the entry as text. That is a crude instrument, and it is chosen
 * deliberately over the alternative: asserting the timing from outside needs a
 * real Electron launch, which costs seconds and is exactly the flaky kind of
 * measurement a machine under load breaks. Order is what this item is about,
 * and order is what can be checked without a clock.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

/**
 * The body of the `app.whenReady()` callback — where the order matters.
 *
 * Sliced from the call itself: the entry's own header comment names this API,
 * a later comment mentions it again, and a test that measured prose would pass
 * or fail on wording. The call is the only mention followed by `.then(`.
 */
function readyBody(source: string): string {
  const match = /\.whenReady\(\)\s*\n\s*\.then\(/.exec(source);
  if (!match) throw new Error("no app.whenReady() call in the main entry");
  return source.slice(match.index);
}

/** The body of the background boot function, from its declaration onward. */
function backgroundBootBody(source: string): string {
  const start = source.indexOf("function bootServicesBehindTheWindow()");
  if (start === -1) {
    throw new Error("the services are not booted behind the window");
  }
  return source.slice(start);
}

describe("the main entry", () => {
  const source = read("src/main/index.ts");

  test("creates the window before it boots the services", () => {
    const body = readyBody(source);
    // The assignment form, so a mention in a comment cannot be mistaken for
    // the call.
    const handlers = body.indexOf("registerIpcHandlers();");
    const window_ = body.indexOf("mainWindow = createMainWindow();");

    expect(handlers, "the IPC handlers are registered in the ready body").toBeGreaterThan(0);
    expect(window_, "the window is created in the ready body").toBeGreaterThan(0);
    // Handlers first: the renderer's first call has to find one.
    expect(handlers).toBeLessThan(window_);

    for (const name of ["processService", "launcherService", "claudeService"]) {
      expect(
        body.includes(`await ${name}.boot()`),
        `${name}.boot() must not be awaited before the window — that is the bug (ATR-055)`,
      ).toBe(false);
    }
  });

  test("boots them behind the window, and awaits them there", () => {
    const body = readyBody(source);
    expect(body).toContain("bootServicesBehindTheWindow();");
    // Called, not awaited: awaiting it here would be the same old gate with
    // extra steps.
    expect(body).not.toContain("await bootServicesBehindTheWindow()");

    const background = backgroundBootBody(source);
    for (const name of ["processService", "launcherService", "claudeService"]) {
      expect(
        background.includes(`await ${name}.boot()`),
        `${name}.boot() should be awaited in the background, in order`,
      ).toBe(true);
    }
    // Started, not blocked on: the caller is not an async function.
    expect(background).toContain("void (async () => {");
  });
});

describe("every handler that needs a booted service waits for it", () => {
  /**
   * Counted rather than listed, so a handler added tomorrow is covered by the
   * same rule: however many `process:*` handlers exist, that many awaits of the
   * service's `boot()` must precede them. A handler that dispatches without it
   * can read a snapshot the trie has not been built for — the race the window
   * being created first would otherwise open.
   */
  const cases = [
    { file: "src/main/ipc/process.ts", service: "processService" },
    { file: "src/main/ipc/claude.ts", service: "claudeService" },
  ] as const;

  for (const { file, service } of cases) {
    test(`${file} awaits ${service}.boot() in every registration`, () => {
      const source = read(file);
      const registrations = source.match(/ipcMain\.handle\(/g) ?? [];
      const awaits = source.match(new RegExp(`await ${service}\\.boot\\(\\);`, "g")) ?? [];

      expect(registrations.length).toBeGreaterThan(0);
      expect(
        awaits.length,
        `${registrations.length} handler(s) but ${awaits.length} await(s) of ${service}.boot()`,
      ).toBe(registrations.length);
    });
  }
});
