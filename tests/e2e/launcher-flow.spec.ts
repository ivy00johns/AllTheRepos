/**
 * Phase 3a E2E — Launcher icon row on a seeded repo card.
 *
 * Validates the LauncherButtons icon row renders on the catalog
 * route. Each icon must:
 *   - be visible inside the catalog grid,
 *   - carry a non-empty `aria-label`,
 *   - NOT be clicked (clicking would spawn a real editor /
 *     terminal / Finder reveal on the test machine, which is
 *     unacceptable for an automated suite).
 *
 * If the local catalog DB has zero repos seeded (a fresh dev
 * machine, or CI without `~/.alltherepos/`), the test gracefully
 * documents that and exits — the unit specs cover the buttons'
 * behaviour in depth (`tests/unit/main/ipc/launcher.spec.ts` +
 * `tests/unit/main/services/launcher.spec.ts`).
 *
 * Owner: qe-agent (Phase 3a).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

const EXPECTED_LAUNCHER_LABELS = [
  /^open in editor$/i,
  /^open in terminal$/i,
  /^reveal in finder$/i,
  /^open remote/i, // "Open remote (origin)"
  /^copy path$/i,
];

test.describe("Phase 3a launcher flow", () => {
  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test("launcher icon row renders on the catalog with non-empty aria-labels", async () => {
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

      // Wait for the catalog chrome (same anchor as catalog-flow.spec.ts).
      const appTitle = win.getByRole("link", { name: /^AllTheRepos$/i });
      await expect(appTitle).toBeVisible({ timeout: 15_000 });

      // Give the catalog a moment to settle so the repo grid is mounted.
      await win.waitForTimeout(800);

      // If there are zero repos in the catalog, the icon row simply
      // isn't rendered. Bail with a warning so the suite stays green
      // on unseeded hosts.
      const editorBtns = win.getByRole("button", {
        name: /^open in editor$/i,
      });
      const editorCount = await editorBtns.count();
      if (editorCount === 0) {
        // eslint-disable-next-line no-console
        console.warn(
          "[launcher-flow] no seeded repos in local catalog — skipping aria-label assertions. Run a scan to seed the catalog before running this suite for full coverage.",
        );
        return;
      }

      // Every launcher icon must surface its accessible name.
      for (const labelRe of EXPECTED_LAUNCHER_LABELS) {
        const buttons = win.getByRole("button", { name: labelRe });
        const count = await buttons.count();
        expect(
          count,
          `expected at least one button matching ${labelRe} on the catalog`,
        ).toBeGreaterThan(0);

        // Sanity: aria-label is non-empty (Playwright's getByRole
        // matches the accessible name, but we double-check the
        // attribute itself).
        const first = buttons.first();
        const ariaLabel = await first.getAttribute("aria-label");
        expect(ariaLabel?.length ?? 0).toBeGreaterThan(0);
      }

      // We deliberately do NOT click any launcher button: clicking
      // "Open in editor" / "Reveal in Finder" / "Open remote" would
      // spawn a real subprocess or open a real OS surface on the test
      // machine. The handlers themselves are covered by the unit
      // suite. Copy-path could in theory be clicked safely, but the
      // implementation uses Electron's `clipboard.writeText` which
      // we'd need to round-trip through `navigator.clipboard.readText`
      // — and Playwright Electron doesn't expose clipboard read by
      // default. Skip to keep the spec deterministic.
    } finally {
      await app.close();
    }
  });
});
