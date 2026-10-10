/**
 * The two routes that were taller than the window they render in.
 *
 * The [2026-10-07 UI/UX review](../../docs/audits/2026-10-07-ui-ux-review.md)
 * measured both at **1280x800** and filed them as P1. The catalog's root was
 * `h-[100dvh]` inside a `main.flex-1` that already sits under a 48px top bar,
 * so the shell's box ran `top 48 / height 800 / bottom 848` against
 * `innerHeight` 800 — and because that root is `overflow-hidden`, the last 48px
 * of the grid was clipped rather than reachable by scrolling. `/graph` sized
 * itself `h-[calc(100dvh-3rem)]` inside a shell that adds its own padding, so
 * the page came out 64px over and its bottom-anchored legend and control bar
 * opened below the fold.
 *
 * Both are properties of a laid-out window, so this spec resizes the real one
 * and asks the page how tall it thinks it is. `documentElement.scrollHeight`
 * against `innerHeight` is the measurement the review used, which keeps the
 * assertion comparable with the finding.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { launchApp } from "./_launch-app";
import { describeMetrics, pageMetrics, resizeWindow } from "./_window";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

/** The size the 2026-10-07 review measured at. */
const REVIEWED = { width: 1280, height: 800 };

/** A CSS pixel of slack, for sub-pixel layout and a rounded scroll height. */
const SLACK = 1;

/** How far the content area may sit from the requested height (macOS chrome). */
const HEIGHT_TOLERANCE = 40;

test.describe("the routes fit the window they render in", () => {
  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test("the catalog and the map both fit 1280x800, with nothing clipped", async () => {
    const { app, close } = await launchApp();

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });

      await resizeWindow(app, win, REVIEWED);

      // ----- The catalog. -----
      const catalog = await pageMetrics(win);
      // The window really is the reviewed size, within macOS's title-bar
      // difference, so a pass here cannot be a pass at some other width.
      expect(
        catalog.innerWidth,
        describeMetrics("the catalog", catalog),
      ).toBeGreaterThanOrEqual(REVIEWED.width - 2);
      expect(
        Math.abs(catalog.innerHeight - REVIEWED.height),
        describeMetrics("the catalog", catalog),
      ).toBeLessThanOrEqual(HEIGHT_TOLERANCE);

      expect(
        catalog.documentScrollHeight,
        `the catalog is taller than its window — ${describeMetrics("the catalog", catalog)}`,
      ).toBeLessThanOrEqual(catalog.innerHeight + SLACK);

      // ----- The map, which renders inside a different shell. -----
      // Navigated through the bar itself: the renderer uses memory history, so
      // a `goto` would not reach the route at all.
      await win
        .getByRole("banner")
        .getByRole("link", { name: /^Map\b/i })
        .click();
      await expect(
        win.getByRole("img", { name: /linked by/i }),
        "the map summary is how this spec knows /graph mounted",
      ).toBeVisible({ timeout: 15_000 });

      const map = await pageMetrics(win);
      expect(
        map.documentScrollHeight,
        `the map is taller than its window — ${describeMetrics("the graph", map)}`,
      ).toBeLessThanOrEqual(map.innerHeight + SLACK);

      // ----- The other half of the same fix, and the failure it could have
      // traded for. -----
      // The map fits because it stopped sizing itself to the viewport and asks
      // the shell for the space that is left. That shell is now pinned to the
      // window's height as well, and `main` clips — so a route whose content is
      // taller than the window has to be scrollable inside the shell, or this
      // fix would have swapped a map that overflowed for pages that cannot be
      // read to the bottom.
      //
      // What is asserted is the guarantee rather than today's content height:
      // the shell is the scroll container, and whatever it does clip is
      // reachable. Settings happens to fit at 1280x800, so the second half is
      // the one that will matter on a shorter window or a longer page — and it
      // is measured rather than assumed.
      await win
        .getByRole("banner")
        .getByRole("link", { name: /^Settings\b/i })
        .click();
      await expect(
        win.getByRole("heading", { name: /settings/i }).first(),
        "navigating to Settings is how this leg knows the route mounted",
      ).toBeVisible({ timeout: 15_000 });

      const shell = await win.evaluate(() => {
        const main = document.querySelector("main");
        const element = main?.firstElementChild as HTMLElement | null;
        if (!element) throw new Error("no shell element inside main");
        const clipped = element.scrollHeight - element.clientHeight;
        const before = element.scrollTop;
        element.scrollTop = clipped;
        const reached = element.scrollTop;
        element.scrollTop = before;
        return {
          overflowY: getComputedStyle(element).overflowY,
          clipped,
          reached,
        };
      });

      // The scroll container is the shell. `main` clips, so without this the
      // overflow would be lost rather than scrollable.
      expect(
        shell.overflowY,
        `the shared shell has to scroll its overflow (main clips) — it is "${shell.overflowY}"`,
      ).toMatch(/^(auto|scroll)$/);

      expect(
        shell.reached,
        `settings content is cut off with no way to reach it: ${shell.clipped}px of overflow, scrolled to ${shell.reached}`,
      ).toBeGreaterThanOrEqual(Math.max(0, shell.clipped) - SLACK);
    } finally {
      await close();
    }
  });
});
