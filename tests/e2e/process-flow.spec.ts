/**
 * Phase 3a E2E — Process panel flow.
 *
 * Validates the `/processes` route end-to-end inside a built Electron app.
 * Two strategies are exercised here:
 *
 *   1. Route chrome smoke: navigate to `/processes` via the Activity top-bar
 *      nav button, assert the page heading and that the body renders the
 *      empty-state copy or the populated table without crashing.
 *   2. Listening-port detection: spawn a real `http.createServer` child inside
 *      one of the seeded repos and assert that its row — repo, port and PID —
 *      reaches the table, then that killing it clears the row.
 *
 * ## Neither leg waits out the poll interval
 *
 * The panel refreshes on mount and offers a Refresh action, both of which ask
 * main for a sweep instead of reading the snapshot the last tick produced
 * (`process:refresh`). This spec uses that: a server started a moment ago is
 * otherwise invisible for up to 15s while the app is blurred, which is long
 * enough to look like detection failing.
 *
 * ## Why leg 2 pins the repo and not just the PID
 *
 * The pid and port come straight out of the `lsof` sweep. The repo does not:
 * it is matched by looking the listener's cwd up in the catalog's path trie,
 * and `lsof` reports the cwd the kernel resolved. So a row that links to the
 * seeded repo slug is what proves the cwd → repo binding works end to end —
 * and that binding is the whole feature, since a port with no repo beside it
 * tells you nothing. It also happens to cover the trap documented on
 * `runLsofCwds` in `services/process.ts`: without `lsof -a` the cwd query ORs
 * its selection options and answers with some *other* process's cwd, which
 * reads exactly like "this server belongs to no repo".
 *
 * The wait here is a couple of poller ticks, not a couple of hundred
 * milliseconds: the main-side poller runs on an interval (3s focused, 15s
 * blurred), so a row that appears between ticks waits for the next one.
 *
 * Owner: qe-agent (Phase 3a).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { TEMPLATE_PROFILE_ENV, launchApp } from "./_launch-app";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

/**
 * The seeded repo the spawned server runs inside — one of `SEEDED_REPOS` in
 * `_global-setup.ts`, which builds them beside the template profile.
 */
const SEEDED_REPO = "demo-cli";

/**
 * Both ceilings sit far above one on-demand sweep (~0.5s of `lsof`/`ps` work
 * here, with the row landing in 40-80ms) and below the 15s blurred poll
 * interval, so the panel showing the host is what is being asserted — not the
 * suite waiting out the poller. They are not tight enough to prove the row
 * arrived *because* of the refresh rather than a tick; the unit specs pin that
 * `refresh` sweeps rather than reading the cache.
 */
const DETECTION_TIMEOUT_MS = 10_000;
const CLEAR_TIMEOUT_MS = 10_000;
/** How long a killed child gets to actually exit before the sweep looks. */
const EXIT_TIMEOUT_MS = 10_000;

/** Where `_global-setup.ts` put the seeded repos. */
function seededRepoDir(name: string): string {
  const template = process.env[TEMPLATE_PROFILE_ENV];
  if (!template) {
    throw new Error(
      `[process-flow] ${TEMPLATE_PROFILE_ENV} is unset — run this spec through Playwright so _global-setup.ts can build the seeded profile.`,
    );
  }
  const dir = join(dirname(template), "repos", name);
  if (!existsSync(dir)) {
    throw new Error(
      `[process-flow] no seeded repo at ${dir} — is "${name}" still in SEEDED_REPOS (tests/e2e/_global-setup.ts)?`,
    );
  }
  return dir;
}

/** Ask the app itself which slug it gives a repo path. */
async function catalogSlugFor(win: Page, fullPath: string): Promise<string> {
  return win.evaluate(async (dir) => {
    const atr = (
      window as unknown as {
        atr: {
          catalog: {
            list(
              input: unknown,
            ): Promise<{ items: Array<{ slug: string; fullPath: string }> }>;
          };
        };
      }
    ).atr;
    const page = await atr.catalog.list({});
    return page.items.find((item) => item.fullPath === dir)?.slug ?? "";
  }, fullPath);
}

test.describe("Phase 3a process flow", () => {
  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test("processes route renders chrome (empty or populated table)", async () => {
    const { app, close } = await launchApp();

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      // Wait for catalog chrome to load.
      const appTitle = win.getByRole("link", { name: /^AllTheRepos$/i });
      await expect(appTitle).toBeVisible({ timeout: 15_000 });

      // The top-bar Activity icon links to /processes (aria-label
      // "Running processes"). Click it.
      const processesLink = win.getByRole("link", {
        name: /running processes/i,
      });
      await expect(processesLink).toBeVisible({ timeout: 10_000 });
      await processesLink.click();

      // The /processes page renders an h1 "Processes".
      await expect(
        win.getByRole("heading", { name: /^processes$/i }),
      ).toBeVisible({ timeout: 10_000 });

      // This leg is route chrome only: the host may genuinely have nothing
      // listening, so either state is fine here. Leg 2 is the one that
      // asserts detection.
      const body = win.locator("body");
      const text = (await body.textContent()) ?? "";
      const hasEmptyState =
        /no dev servers detected/i.test(text) ||
        /loading processes/i.test(text);
      const hasTable = (await win.locator("table").count()) > 0;
      expect(
        hasEmptyState || hasTable,
        `expected either the empty-state copy or a <table> in /processes — got: ${text.slice(0, 300)}`,
      ).toBe(true);
    } finally {
      await close();
    }
  });

  test("a spawned server appears in /processes bound to its repo, and killing it clears the row", async () => {
    // Setup, then a tick to detect and a tick to clear.
    test.setTimeout(180_000);

    const repoDir = seededRepoDir(SEEDED_REPO);
    let child: ChildProcess | null = null;

    const { app, close } = await launchApp();

    try {
      // 1. Spawn a tiny http server listening on an ephemeral port, with its
      //    cwd inside a repo the catalog knows about. Pipe stdout so we can
      //    capture the chosen port.
      child = spawn(
        process.execPath,
        [
          "-e",
          "const s=require('http').createServer((q,r)=>r.end('ok'));s.listen(0,()=>{console.log('PORT='+s.address().port);});",
        ],
        {
          cwd: repoDir,
          stdio: ["ignore", "pipe", "ignore"],
        },
      );

      const port = await new Promise<number>((resolvePort, rejectPort) => {
        const t = setTimeout(
          () => rejectPort(new Error("http server didn't print PORT in 3s")),
          3_000,
        );
        child!.stdout?.on("data", (buf: Buffer) => {
          const m = buf.toString("utf8").match(/PORT=(\d+)/);
          if (m && m[1]) {
            clearTimeout(t);
            resolvePort(parseInt(m[1], 10));
          }
        });
        child!.once("error", (err) => {
          clearTimeout(t);
          rejectPort(err);
        });
        child!.once("exit", (code) => {
          clearTimeout(t);
          rejectPort(
            new Error(`http server exited early code=${code ?? "null"}`),
          );
        });
      });

      expect(port).toBeGreaterThan(1024);
      const pid = child.pid!;
      expect(pid).toBeGreaterThan(0);

      // 2. Drive the renderer to /processes.
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });
      await win.getByRole("link", { name: /running processes/i }).click();
      await expect(
        win.getByRole("heading", { name: /^processes$/i }),
      ).toBeVisible({ timeout: 10_000 });

      // 3. Ask for a sweep rather than waiting out the poll interval.
      const refreshBtn = win.getByRole("button", { name: /^refresh$/i });
      await expect(refreshBtn).toBeVisible({ timeout: 5_000 });
      await expect(refreshBtn).toBeEnabled({ timeout: 10_000 });

      // The row has to arrive. Match on cells rather than `has-text` on the
      // <tr>: a bare substring lets a 4-digit port match a longer one (port
      // 5000 lives inside port 15000). The port renders inside its own <span>
      // next to a decorative dot; the PID cell holds only the number.
      const rowSelector = win
        .locator("tbody tr")
        .filter({ has: win.locator(`span:text-is("${port}")`) })
        .filter({ has: win.locator(`td:text-is("${pid}")`) });

      const detectedAt = Date.now();
      await refreshBtn.click();
      await expect(
        rowSelector,
        `expected PID ${pid} on port ${port} to appear in the /processes table ` +
          `within ${DETECTION_TIMEOUT_MS}ms of asking for a fresh sweep.`,
      ).toHaveCount(1, { timeout: DETECTION_TIMEOUT_MS });
      const detectionMs = Date.now() - detectedAt;

      // 4. ...and it has to name the repo the server was started in.
      const repoSlug = await catalogSlugFor(win, repoDir);
      expect(
        repoSlug,
        `the app's catalog has no repo at ${repoDir}, so the attribution assertion below cannot mean anything`,
      ).not.toBe("");
      await expect(
        rowSelector.getByRole("link", { name: repoSlug }),
        `expected the row for PID ${pid} to link to the ${SEEDED_REPO} repo. ` +
          `The listener's cwd (which lsof reports as the kernel resolved it) ` +
          `did not match the catalog path ${repoDir}.`,
      ).toBeVisible();

      // 5. Click the kill button on this row.
      const killBtn = rowSelector.getByRole("button", {
        name: new RegExp(`kill pid ${pid}`, "i"),
      });
      await expect(killBtn).toBeVisible({ timeout: 5_000 });

      // The kill handler opens window.confirm; auto-accept. The click returns
      // as soon as it dispatches, so wait for the child itself to go before
      // sweeping — a sweep that ran early would be right to still list it.
      win.once("dialog", (d) => {
        void d.accept();
      });
      await killBtn.click();
      const exitDeadline = Date.now() + EXIT_TIMEOUT_MS;
      while (child.exitCode === null && child.signalCode === null) {
        if (Date.now() > exitDeadline) break;
        await win.waitForTimeout(50);
      }
      expect(
        child.exitCode !== null || child.signalCode !== null,
        `PID ${pid} had not exited ${EXIT_TIMEOUT_MS}ms after the kill was confirmed`,
      ).toBe(true);

      // 6. The row clears on a fresh sweep.
      const killedAt = Date.now();
      await expect(refreshBtn).toBeEnabled({ timeout: 10_000 });
      await refreshBtn.click();
      await expect(
        rowSelector,
        `PID ${pid} was killed but its row is still in the /processes table ` +
          `after a fresh sweep + ${CLEAR_TIMEOUT_MS}ms.`,
      ).toHaveCount(0, { timeout: CLEAR_TIMEOUT_MS });

      // eslint-disable-next-line no-console
      console.log(
        `[process-flow] PID ${pid} on port ${port} appeared as ${repoSlug} after ${detectionMs}ms; ` +
          `row cleared ${Date.now() - killedAt}ms after the kill`,
      );
    } finally {
      try {
        if (child && !child.killed) child.kill("SIGKILL");
      } catch {
        // ignore
      }
      await close();
    }
  });
});
