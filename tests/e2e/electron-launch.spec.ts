/**
 * Phase 0 E2E (updated for Phase 1) — Electron app launch + system:ping
 * round-trip via the new `/debug` route.
 *
 * Per NEW-PLAN.md §9 Phase 0 deliverable: "one passing E2E test that opens
 * the window". Phase 1 moved the ping/pong card out of `/` (now the
 * catalog) into `/debug`. TanStack Router is configured with
 * `createMemoryHistory` so we cannot navigate via URL — instead we click
 * the Debug nav button rendered in the top bar.
 *
 * This test:
 *   1. Launches Electron (via `_launch-app.ts`, against a private profile)
 *      pointing at the built
 *      main-process bundle (`out/main/index.js`).
 *   2. Waits for the first window to load.
 *   3. Navigates to `/debug` by clicking the top-bar "Debug" link.
 *   4. Asserts the renderer surfaces a successful ping response:
 *      "pong" text and a numeric mainProcessPid.
 *   5. Optionally clicks "Ping again" to re-verify the round-trip.
 *
 * Pre-requisite: `pnpm electron:build` (or `node scripts/run-electron-e2e.mjs`)
 * must have produced `out/main/index.js`.
 *
 * Owner: qe-agent (Phase 0 — refreshed in Phase 1).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

import { launchApp } from "./_launch-app";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

test.describe("Electron main window — /debug ping", () => {
  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test("opens, navigates to /debug, surfaces ping, exposes numeric pid", async () => {
    const { app, close } = await launchApp();

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      // The renderer mounts at `/` (catalog). Click the top-bar "Debug"
      // link to navigate to `/debug` where the ping card lives. Memory
      // history means the route only changes via in-app links — we
      // cannot just `goto('/debug')`.
      const debugLink = win.getByRole("link", { name: /^debug$/i });
      await expect(debugLink).toBeVisible({ timeout: 15_000 });
      await debugLink.click();

      // The DebugPage component pings on mount; wait for the rendered
      // response to settle.
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

      // Round-trip the ping a second time via "Ping again" to prove the
      // bridge isn't a one-shot.
      const pingAgain = win.getByRole("button", { name: /ping again/i });
      if ((await pingAgain.count()) > 0) {
        await pingAgain.first().click();
        await expect(win.locator("body")).toContainText("pong");
      }
    } finally {
      await close();
    }
  });
});
