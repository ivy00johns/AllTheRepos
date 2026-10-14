/**
 * The harness's own guarantee: a launch it made is torn down, even when the
 * app refuses to quit.
 *
 * `_launch-app.close()` used to be exactly as patient as the app was stubborn.
 * Playwright asks the app to quit and then awaits the process exit with no
 * timeout, so a window that declined the request held that await open for as
 * long as anything was willing to wait. Observed while hammering the suite:
 * one stuck app spent the test's 60s budget and the worker then spent a second
 * 60s failing to close it — `Test timeout of 60000ms exceeded` followed by
 * `Worker teardown timeout of 60000ms exceeded`, with no window named in
 * either and no way to tell the stall from a slow machine.
 *
 * The app in the first test is made to refuse on purpose, through both routes
 * out of the process: `before-quit` is what `app.quit()` goes through, and
 * subscribing to `window-all-closed` is what suppresses Electron's default
 * quit-when-the-last-window-closes. That is the state those two timeouts came
 * from, held still so it can be asserted on.
 *
 * What is asserted is the contract the harness offers now: `close()` returns
 * within its bound, and when it returns, no process from that launch is left.
 * The second test is the other half of the same contract — that the ordinary
 * app, the one that quits when asked, still closes and is still gone — because
 * a teardown that kills everything is not better than one that kills nothing.
 *
 * Owner: qe-agent.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type ElectronApplication } from "@playwright/test";

import { launchApp } from "./_launch-app";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

/**
 * The bound `_launch-app.ts` allows a close before it kills the app. Restated
 * rather than imported so that widening it fails here instead of quietly
 * widening the test with it.
 */
const CLOSE_BOUND_MS = 5_000;

/** Whether a pid still exists. Signal 0 asks without delivering anything. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Make the app decline every route out of the process. */
async function refuseToQuit(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp }) => {
    electronApp.on("before-quit", (event) => event.preventDefault());
    // Subscribing at all is what stops Electron quitting by itself once the
    // last window is gone.
    electronApp.on("window-all-closed", () => {});
  });
}

test.describe("the harness tears its own apps down", () => {
  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test("a window that will not quit is killed, and close() still returns", async () => {
    const { app, close } = await launchApp();
    const pid = app.process().pid;
    expect(pid, "a launched app should have a pid").toBeDefined();

    await refuseToQuit(app);

    const startedAt = Date.now();
    await close();
    const elapsedMs = Date.now() - startedAt;

    expect(
      isAlive(pid as number),
      "the app process outlived close(), so the next test launches on top of it",
    ).toBe(false);
    expect(
      elapsedMs,
      `close() took ${elapsedMs}ms — the wait is supposed to be bounded, not as long as the app lasts`,
    ).toBeLessThan(CLOSE_BOUND_MS * 2);
  });

  test("an app that quits when asked is closed, and leaves nothing behind", async () => {
    const { app, close } = await launchApp();
    const pid = app.process().pid;
    expect(pid, "a launched app should have a pid").toBeDefined();

    await app.firstWindow();

    await close();

    expect(isAlive(pid as number), "the app process outlived close()").toBe(
      false,
    );
  });
});
