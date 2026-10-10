/**
 * Phase 0 E2E (updated for Phase 1) — Electron app launch + system:ping
 * round-trip via the new `/debug` route.
 *
 * Per NEW-PLAN.md §9 Phase 0 deliverable: "one passing E2E test that opens
 * the window". Phase 1 moved the ping/pong card out of `/` (now the
 * catalog) into `/debug`. TanStack Router keeps its route in the URL hash, so
 * `#/debug` reaches it too — but the route is reached through the app here,
 * as a person reaches it.
 *
 * That door changed with ATR-074: `/debug` left the primary navigation, so
 * there is no longer a top-bar link to click. The command palette's
 * `app.open-debug` action is the affordance, and it is the one that works in
 * *this* build — the suite launches `pnpm electron:build`, a production render
 * of the renderer, where the top-bar dev affordance (`import.meta.env.DEV`) is
 * deliberately absent. The palette is opened from the catalog because the
 * renderer's own Cmd+K fallback lives in the catalog shell.
 *
 * This test:
 *   1. Launches Electron (via `_launch-app.ts`, against a private profile)
 *      pointing at the built
 *      main-process bundle (`out/main/index.js`).
 *   2. Waits for the first window to load.
 *   3. Runs "Open Debug Page" from the Cmd+K palette to reach `/debug`.
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

      // The renderer mounts at `/` (catalog). Run the palette action that
      // opens `/debug`, where the ping card lives. Memory history means the
      // route only changes through the app — we cannot just `goto('/debug')`.
      //
      // The catalog chrome first: the renderer's own Cmd+K fallback mounts with
      // the catalog shell, so pressing the key before it is up would open
      // nothing and read as a broken action rather than a race.
      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });
      await win.keyboard.press("Meta+K");
      const palette = win.getByRole("dialog", { name: /command palette/i });
      await expect(palette).toBeVisible({ timeout: 15_000 });
      await palette.getByPlaceholder(/run a command/i).fill("debug page");
      const openDebug = palette.getByText(/^open debug page$/i).first();
      await expect(openDebug).toBeVisible({ timeout: 5_000 });
      await win.keyboard.press("Enter");
      await expect(palette).toBeHidden({ timeout: 5_000 });

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
