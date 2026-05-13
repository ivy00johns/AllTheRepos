/**
 * Phase 0 E2E — Electron app launch + system:ping round-trip.
 *
 * Per NEW-PLAN.md §9 Phase 0 deliverable: "one passing E2E test that opens
 * the window". This test:
 *   1. Launches Electron via `_electron.launch` pointing at the built
 *      main-process bundle (`out/main/index.js`).
 *   2. Waits for the first window to load.
 *   3. Asserts the renderer surfaces a successful ping response:
 *      "pong" text and a numeric mainProcessPid.
 *   4. Optionally clicks a "Ping again" button if the renderer renders
 *      one (graceful no-op if it doesn't — the contract only requires
 *      the initial ping to render).
 *
 * Pre-requisite: `pnpm electron:build` (or `node scripts/run-electron-e2e.mjs`)
 * must have produced `out/main/index.js`. Without that, the test fails fast
 * with a clear error explaining how to fix it.
 *
 * Owner: qe-agent (Phase 0).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

test.describe("Electron main window", () => {
  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test("opens, surfaces ping, and exposes a numeric main-process pid", async () => {
    const app = await electron.launch({
      args: [MAIN_ENTRY],
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
      },
    });

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      // The renderer should call window.atr.system.ping() on mount and
      // render the result. Wait for "pong" to show up — generous timeout
      // covers cold start.
      await expect(win.locator("body")).toContainText("pong", {
        timeout: 15_000,
      });

      // Sanity: the body text contains the main-process pid (any positive
      // integer) somewhere in the rendered card.
      const bodyText = (await win.locator("body").textContent()) ?? "";
      const pidMatch = bodyText.match(/\b\d{2,}\b/);
      expect(
        pidMatch,
        `expected a numeric pid in body text but got: ${bodyText.slice(0, 200)}`,
      ).not.toBeNull();

      // If the renderer offers a "Ping again" button, click it and assert
      // "pong" remains visible. If the button isn't there, that's fine —
      // the initial ping satisfies the Phase 0 contract.
      const pingAgain = win.getByRole("button", { name: /ping again/i });
      if ((await pingAgain.count()) > 0) {
        await pingAgain.first().click();
        await expect(win.locator("body")).toContainText("pong");
      }
    } finally {
      await app.close();
    }
  });
});
