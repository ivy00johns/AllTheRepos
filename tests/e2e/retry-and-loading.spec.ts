/**
 * What a screen does when a read fails, and while one is in flight.
 *
 * Two ledger items from the [2026-10-07 review](../../docs/audits/2026-10-07-ui-ux-review.md),
 * and both are states rather than markup, so the markup is not the thing to
 * check:
 *
 *   - **ATR-063** — `repos.$slug`, `/settings` and `/processes` rendered a
 *     headline plus the raw message and stopped, so a transient failure left a
 *     dead screen whose only exit was to quit and relaunch.
 *   - **ATR-064** — the same three rendered a bare sentence while waiting, where
 *     the grid and the detail panel already used skeletons. With a cold start
 *     the first paint is exactly where that wait shows.
 *
 * Neither state happens on a healthy machine, and neither would be verified by
 * asserting that a branch exists in the source. So this spec arranges the real
 * thing: `src/main/ipc/_faults.ts` names channels to spoil before the app starts,
 * and a flag file holds the outage open. Everything below is then a property of
 * what the app *did* — the error the user is shown, the retry they click, the
 * placeholder that is on screen while the answer is not.
 *
 * **Which channels get delayed is not arbitrary.** The loading state is only
 * reachable where the read under test is the *only* source for that panel, and
 * two of the three screens fail that test: the top bar reads the process
 * snapshot and `settings:get` for the catalog before either panel mounts, so
 * their pending states are usually already resolved, and the process snapshot
 * additionally arrives by push (`process:on:update`), which fills the cache
 * without any read completing. Both are still covered for their error states,
 * and only the repo page and the settings page are asked to show a skeleton —
 * the two where a pending read is the only thing a person could be looking at.
 * All three screens are therefore reached in the real window in both of the
 * states the review filed, with the one exception named above.
 *
 * The one thing that is a test's own arrangement rather than the app's: the
 * outage is lifted by deleting the flag file, the way a rate limit would clear —
 * and lifting it releases a read already waiting, so the answer that arrives
 * afterwards is the app's own.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { launchApp } from "./_launch-app";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

/**
 * Long enough that the placeholder is on screen while a person looks at it, and
 * comfortably longer than a launch plus a navigation takes, so the assertion
 * cannot miss the window it is looking for.
 */
const SLOW_MS = 8_000;

/** A flag file the app watches, and the test deletes to end the outage. */
function outage(): { flag: string; end: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "atr-ipc-outage-"));
  const flag = join(dir, "outage");
  writeFileSync(flag, "failing on purpose\n");
  return {
    flag,
    end: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** The renderer's half of a deep link, pushed the way main pushes it. */
async function deepLinkTo(
  app: Awaited<ReturnType<typeof launchApp>>["app"],
  slug: string,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("protocol:on:deep-link", payload);
    }
  }, { path: `repo/${slug}`, params: { slug } });
}

async function openApp(env: Record<string, string>) {
  const launched = await launchApp({ env });
  const win = await launched.app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await expect(win.getByRole("link", { name: /^AllTheRepos$/i })).toBeVisible({
    timeout: 20_000,
  });
  return { ...launched, win };
}

/** The top bar destination a person clicks to get somewhere. */
async function goTo(win: Page, label: string): Promise<void> {
  await win.getByRole("banner").getByRole("link", { name: new RegExp(`^${label}\\b`, "i") }).click();
}

/** The placeholder boxes, inside whichever container is announcing the wait. */
function boxes(win: Page) {
  return win.locator('[aria-busy="true"] .animate-pulse');
}

/** The settings form's own submit control — its marker that the values landed. */
function saveSettings(win: Page) {
  return win.getByRole("button", { name: /save settings/i });
}

test.describe("error states and loading states", () => {
  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test("a failed settings read says so, and Try again loads the form", async () => {
    const fail = outage();
    const { win, close } = await openApp({
      ATR_FAIL_IPC: "settings:get",
      ATR_FAULT_UNTIL: fail.flag,
    });

    try {
      await goTo(win, "Settings");

      const retry = win.getByRole("button", { name: "Try again" });
      await expect(
        retry,
        "a failed read has to offer a way out of the screen",
      ).toBeVisible({ timeout: 20_000 });
      // The reason is still printed: a retry that fails again and says nothing
      // new is worse than one that shows what happened.
      await expect(win.getByText(/settings:get/)).toBeVisible();
      // …and no form stood in for the values it never got. Scoped to the page
      // rather than to every `input` on screen, because the top bar's search
      // field is one.
      await expect(saveSettings(win)).toHaveCount(0);
      await expect(
        win.getByLabel("New scan path"),
        "the scan-path field belongs to the form, which is not here",
      ).toHaveCount(0);

      // The outage clears, the way a rate limit does.
      fail.end();
      await retry.click();

      await expect(saveSettings(win)).toBeVisible({ timeout: 20_000 });
      await expect(retry).toHaveCount(0);
    } finally {
      fail.end();
      await close();
    }
  });

  test("a failed process read says so, and Try again fills the panel", async () => {
    const fail = outage();
    const { win, close } = await openApp({
      ATR_FAIL_IPC: "process:list",
      ATR_FAULT_UNTIL: fail.flag,
    });

    try {
      await goTo(win, "Running");

      const retry = win.getByRole("button", { name: "Try again" });
      await expect(retry).toBeVisible({ timeout: 20_000 });
      await expect(win.getByText(/process:list/)).toBeVisible();

      fail.end();
      await retry.click();

      // The answer, rather than the dead screen. Which answer depends on the
      // host: the snapshot is this machine's own listeners, so a machine with
      // dev servers up shows the table and a quiet one the empty state — and
      // either is the retry working. Asserting the empty state alone passed on
      // a quiet run and failed on a busy one, which is a test measuring the
      // machine rather than the fix.
      await expect(retry).toHaveCount(0, { timeout: 20_000 });
      await expect(
        win.getByText(/No dev servers detected/).or(win.locator("table")),
        "the retry should replace the error with whatever the snapshot holds",
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      fail.end();
      await close();
    }
  });

  test("a failed repo read says so, and Try again loads the page", async () => {
    const fail = outage();
    const { app, win, close } = await openApp({
      ATR_FAIL_IPC: "catalog:get",
      ATR_FAULT_UNTIL: fail.flag,
    });

    try {
      const card = win.locator("article[data-repo-slug]").first();
      await expect(card).toBeVisible({ timeout: 20_000 });
      const slug = await card.getAttribute("data-repo-slug");
      const name = (await card.locator("h3").innerText()).trim();
      expect(slug, "the seeded catalog should offer a repo").toBeTruthy();

      await deepLinkTo(app, slug as string);

      const retry = win.getByRole("button", { name: "Try again" });
      await expect(retry).toBeVisible({ timeout: 20_000 });
      await expect(win.getByText(/catalog:get/)).toBeVisible();

      fail.end();
      await retry.click();

      await expect(
        win.getByRole("heading", { name: name, exact: true }),
        "the retry should load the repo the page was opened with",
      ).toBeVisible({ timeout: 20_000 });
      await expect(retry).toHaveCount(0);
    } finally {
      fail.end();
      await close();
    }
  });

  test("a pending repo read shows the page's shape, not a sentence", async () => {
    const slow = outage();
    const { app, win, close } = await openApp({
      ATR_DELAY_IPC: "catalog:get",
      ATR_DELAY_IPC_MS: String(SLOW_MS),
      ATR_FAULT_UNTIL: slow.flag,
    });

    try {
      // A slug from the grid, without selecting it — selecting would read the
      // repo through the panel as well.
      const card = win.locator("article[data-repo-slug]").first();
      await expect(card).toBeVisible({ timeout: 20_000 });
      const slug = await card.getAttribute("data-repo-slug");
      const name = (await card.locator("h3").innerText()).trim();
      expect(slug, "the seeded catalog should offer a repo").toBeTruthy();

      // The standalone page, reached the way the OS reaches it.
      await deepLinkTo(app, slug as string);

      // The placeholder: boxes standing in for the back affordance, the name,
      // the meta line and the two content blocks.
      await expect(boxes(win).first()).toBeVisible({ timeout: 10_000 });
      expect(await boxes(win).count()).toBeGreaterThan(3);
      await expect(win.getByText(/Loading repo/)).toHaveCount(0);

      // The read the outage was holding is released, and the page fills in.
      slow.end();
      await expect(
        win.getByRole("heading", { name: name, exact: true }),
        "the repo the deep link named should be on the page",
      ).toBeVisible({ timeout: 20_000 });
      await expect(boxes(win)).toHaveCount(0);
    } finally {
      slow.end();
      await close();
    }
  });

  test("a pending settings read shows label-and-field rows, not a sentence", async () => {
    const slow = outage();
    const { win, close } = await openApp({
      ATR_DELAY_IPC: "settings:get",
      ATR_DELAY_IPC_MS: String(SLOW_MS),
      ATR_FAULT_UNTIL: slow.flag,
    });

    try {
      // The catalog reads settings too, so this query is already in flight when
      // the page that shows it mounts — which is the case the flag file exists
      // to make deterministic: the read that matters is the one still waiting
      // when the screen appears, not the first one anybody happened to make.
      await goTo(win, "Settings");

      await expect(boxes(win).first()).toBeVisible({ timeout: 10_000 });
      expect(await boxes(win).count()).toBeGreaterThan(6);
      await expect(win.getByText(/Loading settings/)).toHaveCount(0);

      slow.end();
      await expect(saveSettings(win)).toBeVisible({ timeout: 20_000 });
      await expect(boxes(win)).toHaveCount(0);
    } finally {
      slow.end();
      await close();
    }
  });
});
