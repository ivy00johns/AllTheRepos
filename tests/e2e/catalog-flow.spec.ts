/**
 * Phase 1 E2E — catalog flow smoke test.
 *
 * Validates the Phase 1 visual-parity deliverable from NEW-PLAN.md §9:
 * "Visually identical to the Next.js app, no browser involved." We
 * cannot drive a real scan against the test host (it would require
 * git-repo fixtures + Ollama for embeddings — out of scope here), so
 * we exercise the chrome that surrounds the catalog:
 *
 *   1. App launches and the catalog route renders without crashing.
 *   2. Layout chrome (top bar + search input + nav links) is visible.
 *   3. Settings route is reachable via in-app navigation. Note that
 *      because the renderer uses TanStack Router's memory history we
 *      navigate by clicking the in-app link, not by URL.
 *   4. No red console errors during catalog load + nav. Yellow / info
 *      messages are tolerated.
 *
 * We intentionally do NOT trigger a scan — a real scan needs disk +
 * Ollama and would be brittle. Scan logic is separately covered by
 * the unit tests in `tests/unit/main/ipc/scan.spec.ts` and the legacy
 * `tests/git/scanner.test.ts`.
 *
 * Owner: qe-agent (Phase 1).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  expect,
  test,
  type ConsoleMessage,
} from "@playwright/test";

import { launchApp } from "./_launch-app";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

/**
 * Console messages we don't care about — usually framework chatter or
 * the "preload bridge unavailable" warning that surfaces briefly in
 * dev. Filter them OUT of the error list before failing the test.
 */
const IGNORED_CONSOLE_PATTERNS: RegExp[] = [
  /Download the React DevTools/i,
  /Electron Security Warning/i,
  /Autofill\.enable/i, // chromedriver chatter when devtools probes appear
  // Phase 0 ships an empty `src/renderer/fonts/` dir — Plex/JetBrains
  // .woff2 files are placeholders. README documents this. Renderer
  // gracefully falls back to system fonts.
  /Failed to load resource: net::ERR_FILE_NOT_FOUND/i,
];

function isIgnored(message: ConsoleMessage): boolean {
  const text = message.text();
  return IGNORED_CONSOLE_PATTERNS.some((re) => re.test(text));
}

test.describe("Phase 1 catalog flow", () => {
  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test("catalog chrome renders, settings is reachable, no red console errors", async () => {
    const { app, close } = await launchApp();

    const consoleErrors: string[] = [];

    try {
      const win = await app.firstWindow();

      win.on("console", (msg) => {
        if (msg.type() === "error" && !isIgnored(msg)) {
          consoleErrors.push(msg.text());
        }
      });

      await win.waitForLoadState("domcontentloaded");

      // ----- (1) Catalog route renders without crashing. -----
      // The TopBar always shows the app title "AllTheRepos" (link to /).
      const appTitle = win.getByRole("link", { name: /^AllTheRepos$/i });
      await expect(appTitle).toBeVisible({ timeout: 15_000 });

      // The catalog page mounts the SearchBar (label "Search repos").
      // Even with an empty DB the input renders because CatalogShell
      // doesn't gate its chrome on data presence.
      // `<input type="search">` has the implicit role `searchbox`, not
      // `textbox`. Both the top bar and the catalog shell currently mount
      // a SearchBar on "/"; Phase 1 UX cleanup item. For now the test just
      // asserts at least one is visible.
      const searchInput = win
        .getByRole("searchbox", { name: /search repos/i })
        .first();
      await expect(searchInput).toBeVisible({ timeout: 10_000 });

      // ----- (2) Layout chrome (top-bar nav buttons) is visible. -----
      // Scope to the top-bar <header> banner so the group-sidebar's
      // duplicate Settings link doesn't trip strict-mode matching.
      const topBar = win.getByRole("banner");
      // `/debug` is deliberately not a destination (ATR-074): this is a
      // production render, so the dev-only affordance is absent and the chrome
      // carries the four destinations the app is for. The absence itself is
      // asserted in `nav-card-a11y.spec.ts` and `workstream-c.spec.ts`; here it
      // is enough that the settings destination is still there to click.
      await expect(
        topBar.getByRole("link", { name: /^debug$/i }),
        "a Debug affordance is in the app chrome of a production build",
      ).toHaveCount(0);
      const settingsLink = topBar.getByRole("link", { name: /^settings$/i });
      await expect(settingsLink).toBeVisible();
      const toggleSidebar = topBar.getByRole("button", {
        name: /toggle sidebar/i,
      });
      await expect(toggleSidebar).toBeVisible();

      // ----- (3) Settings route is reachable via in-app navigation. -----
      await settingsLink.click();
      // SettingsPage renders an h1 "Settings".
      await expect(
        win.getByRole("heading", { name: /^settings$/i }),
      ).toBeVisible({ timeout: 10_000 });

      // Navigate back to the catalog via the title link.
      await appTitle.click();
      await expect(searchInput).toBeVisible({ timeout: 10_000 });

      // Give React Query a tick to settle so any deferred errors surface.
      await win.waitForTimeout(500);

      // ----- (4) No red console errors. -----
      expect(
        consoleErrors,
        `Renderer logged unexpected console errors:\n  - ${consoleErrors.join(
          "\n  - ",
        )}`,
      ).toEqual([]);
    } finally {
      await close();
    }
  });
});
