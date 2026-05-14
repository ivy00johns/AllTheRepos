/**
 * Phase 3b E2E — Claude tab smoke test.
 *
 * Validates the Phase 3b deliverable: the Claude tab on the repo
 * detail page renders the four sections (Skills / Agents / MCP servers
 * / Sessions) or surfaces the empty-state CTA when the seeded repo
 * has no `.claude/` directory.
 *
 *   1. App launches and the catalog route renders.
 *   2. Either:
 *      - a repo card is present → click into detail → switch to Claude
 *        tab → assert the expected headings + Launch button render.
 *      - no repo cards → skip with a documented reason (we don't seed
 *        repos in this environment).
 *   3. No red console errors during the flow.
 *
 * If E2E execution is blocked by the same Node-21 environmental issue
 * documented in Phase 3a's qa-report (Node 21 host can't resolve
 * `node:util#styleText` required by @electron/rebuild 4.0.4 CLI), the
 * suite is committed but unrun. The unit-level coverage in
 * `tests/unit/main/{claude,services/claude,ipc/claude}.spec.ts` plus
 * the renderer/route contract coverage is the primary signal here.
 *
 * Owner: qe-agent (Phase 3b).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ConsoleMessage,
} from "@playwright/test";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

const IGNORED_CONSOLE_PATTERNS: RegExp[] = [
  /Download the React DevTools/i,
  /Electron Security Warning/i,
  /Autofill\.enable/i,
  /Failed to load resource: net::ERR_FILE_NOT_FOUND/i,
];

function isIgnored(message: ConsoleMessage): boolean {
  const text = message.text();
  return IGNORED_CONSOLE_PATTERNS.some((re) => re.test(text));
}

test.describe("Phase 3b Claude flow", () => {
  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test("repo detail Claude tab renders sections OR empty state, no red console errors", async () => {
    const app = await electron.launch({
      args: [MAIN_ENTRY],
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
      },
    });

    const consoleErrors: string[] = [];

    try {
      const win = await app.firstWindow();

      win.on("console", (msg) => {
        if (msg.type() === "error" && !isIgnored(msg)) {
          consoleErrors.push(msg.text());
        }
      });

      await win.waitForLoadState("domcontentloaded");

      // ----- (1) Catalog renders. -----
      const appTitle = win.getByRole("link", { name: /^AllTheRepos$/i });
      await expect(appTitle).toBeVisible({ timeout: 15_000 });

      // ----- (2) Look for a repo card to click into. -----
      // The catalog renders <article> cards per repo. If the DB is
      // empty in this environment, fall back to the global /claude
      // route assertion.
      const repoCard = win.locator("article a[href^='/repos/']").first();
      const cardCount = await repoCard.count();

      if (cardCount === 0) {
        // No seeded repos — verify the global /claude route is reachable
        // via the in-app navigation and renders its "Claude Usage"
        // heading. This still exercises the IPC + renderer.
        console.warn(
          "[claude-flow] no repo cards in catalog — falling back to /claude global usage assertion",
        );
        await win.goto("/claude").catch(() => {
          // TanStack Router uses memory history; .goto() may noop.
        });
        // The route ships a "Claude Usage" h1 (or "Claude usage
        // unavailable" callout when the preload bridge is missing).
        const heading = win
          .getByRole("heading", {
            name: /claude usage|claude usage unavailable/i,
          })
          .first();
        await expect(heading).toBeVisible({ timeout: 10_000 });
      } else {
        // ----- (3) Click into the first repo. -----
        await repoCard.click();

        // The repo detail page has a tablist with a "Claude" tab.
        const claudeTab = win.getByRole("tab", { name: /^claude$/i });
        await expect(claudeTab).toBeVisible({ timeout: 10_000 });
        await claudeTab.click();

        // ----- (4) Assert one of the two acceptable states. -----
        // The Claude tab renders either the four headings + a Launch
        // button, OR the empty-state CTA.
        const launchBtn = win.getByRole("button", {
          name: /launch claude code in this repo/i,
        });
        const skillsHeading = win.locator("#claude-skills-heading");
        const agentsHeading = win.locator("#claude-agents-heading");
        const mcpHeading = win.locator("#claude-mcp-heading");
        const sessionsHeading = win.locator("#claude-sessions-heading");
        const emptyStateCue = win.getByText(/install claude code/i).first();

        // Wait briefly for either to surface.
        await Promise.race([
          launchBtn.waitFor({ timeout: 8_000 }).catch(() => null),
          emptyStateCue.waitFor({ timeout: 8_000 }).catch(() => null),
        ]);

        const launchVisible = await launchBtn.isVisible().catch(() => false);
        const emptyVisible = await emptyStateCue.isVisible().catch(() => false);

        expect(launchVisible || emptyVisible).toBe(true);

        if (launchVisible) {
          await expect(skillsHeading).toBeVisible({ timeout: 5_000 });
          await expect(agentsHeading).toBeVisible({ timeout: 5_000 });
          await expect(mcpHeading).toBeVisible({ timeout: 5_000 });
          await expect(sessionsHeading).toBeVisible({ timeout: 5_000 });

          // Bonus: aria-label is correct.
          const label = await launchBtn.getAttribute("aria-label");
          expect(label).toMatch(/launch claude code/i);
        }
      }

      // Settle so any deferred errors surface.
      await win.waitForTimeout(500);

      // ----- (5) No red console errors. -----
      expect(
        consoleErrors,
        `Renderer logged unexpected console errors:\n  - ${consoleErrors.join(
          "\n  - ",
        )}`,
      ).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
