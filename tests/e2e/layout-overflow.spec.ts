/**
 * Layout overflow E2E — the window never scrolls; a route scrolls inside itself.
 *
 * The [2026-10-07 UI/UX review](../../docs/audits/2026-10-07-ui-ux-review.md)
 * measured two routes taller than the window they live in: the catalog shell at
 * `h-[100dvh]` inside `main.flex-1` under a 48px top bar (ATR-061) and `/graph`
 * at `h-[calc(100dvh-3rem)]` inside the padded `SimpleShell` (ATR-062). Both were
 * the same defect — `__root.tsx` rooted the app at `min-h-screen`, so the
 * document grew to content height and the window itself scrolled, pushing the
 * bottom-anchored furniture below the fold and clipping the catalog's own scroll
 * region behind `overflow-hidden`.
 *
 * So the invariant is asserted as a number rather than read off the classes:
 * `document.documentElement.scrollHeight === window.innerHeight` on every route,
 * from a profile with enough repos that a broken contract has something to
 * overflow with. A route that scrolls the window fails here even if it looks
 * fine, which is the point — the review's `848` and `864` were both real.
 *
 * This spec builds its own profile rather than inheriting the suite's template:
 * the template carries three repos, and three repos do not overflow a 1280x800
 * catalog, so a height regression would have nothing to push against.
 *
 * Owner: qe-agent (2026-10-07 UI/UX pass).
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");
const SEED_SCRIPT = resolve(REPO_ROOT, "tests", "e2e", "_seed-catalog.mjs");

// The electron package's index.js exports the path to its binary — the same
// runtime the app boots, borrowed as plain Node for the seeder, because the
// natives are built for Electron's ABI and a Playwright worker cannot load them.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronBinary = require("electron") as string;

/**
 * Enough repos that the grid cannot fit the catalog's scroll region at the
 * default 1280x800 window. Deliberately, obviously synthetic names.
 */
const DEMO_REPO_COUNT = 36;

const LAUNCH_ENV = {
  NODE_ENV: "test",
  ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
};

interface DocumentMetrics {
  /** The whole document's height — what the window would scroll by. */
  scrollHeight: number;
  /** The layout viewport height — how tall the window's content area is. */
  innerHeight: number;
  scrollWidth: number;
  innerWidth: number;
}

/** Read the window's own numbers, in the renderer, on the live document. */
function metrics(win: Page): Promise<DocumentMetrics> {
  return win.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}

/**
 * Assert every measured route fits the window on both axes, in one go. The
 * assertion is written over the collected numbers rather than route by route so
 * a run reports *both* overflows: "848 against 800" is the whole finding, and
 * failing on the first route would hide whether the map had one too.
 */
function expectFitsWindow(measured: Record<string, DocumentMetrics>): void {
  const viewport = Object.values(measured)[0];
  expect(
    Object.fromEntries(
      Object.entries(measured).map(([route, m]) => [route, m.scrollHeight]),
    ),
    `a route is taller than the ${viewport.innerHeight}px window`,
  ).toEqual(
    Object.fromEntries(
      Object.keys(measured).map((route) => [route, viewport.innerHeight]),
    ),
  );
  for (const [route, m] of Object.entries(measured)) {
    expect(
      m.scrollWidth,
      `${route} scrolls horizontally (${m.scrollWidth} against ${m.innerWidth})`,
    ).toBeLessThanOrEqual(m.innerWidth);
  }
}

/**
 * A throwaway profile with one migrated database carrying {@link
 * DEMO_REPO_COUNT} repos, cut off from the developer's real catalog the same way
 * `_global-setup.ts` and `scripts/make-readme-shots.mjs` do it: the `MIGRATED`
 * sentinel stops the boot copying `~/.alltherepos/` in, and `__legacyPromoted`
 * stops the settings half of the same one-shot promotion.
 */
async function buildProfile(): Promise<{ profileDir: string; root: string }> {
  // Canonicalise before seeding: macOS hands out `/var/folders/...` while the
  // kernel reports `/private/var/...`, and the process panel matches a
  // listener's cwd — always canonical — against the catalog's stored path.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atr-layout-e2e-")));
  const profileDir = join(root, "profile");
  const libraryDir = join(root, "repos");
  mkdirSync(profileDir, { recursive: true });

  writeFileSync(join(profileDir, "MIGRATED"), new Date().toISOString());
  writeFileSync(
    join(profileDir, "settings.json"),
    `${JSON.stringify({ scanPaths: [], __legacyPromoted: true }, null, 2)}\n`,
  );

  // 1. Boot once so the app owns the DDL — schema, FTS triggers and all. The
  //    seeder fills an existing database, it does not create one.
  const boot = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profileDir}`],
    cwd: REPO_ROOT,
    env: { ...process.env, ...LAUNCH_ENV },
  });
  try {
    const win = await boot.firstWindow();
    await win.waitForLoadState("domcontentloaded");
  } finally {
    await boot.close();
  }

  // 2. Fill it. `ELECTRON_RUN_AS_NODE` borrows the app's runtime so the writer
  //    and the app agree on NODE_MODULE_VERSION.
  const pairs = Array.from({ length: DEMO_REPO_COUNT }, (_, index) => [
    `Demo Repo ${String(index + 1).padStart(2, "0")}`,
    join(libraryDir, `demo-repo-${index + 1}`),
  ]).flat();

  const seeded = spawnSync(
    electronBinary,
    [SEED_SCRIPT, join(profileDir, "alltherepos.db"), ...pairs],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
    },
  );
  if (seeded.status !== 0) {
    throw new Error(
      `[layout-overflow] seeding failed (exit ${seeded.status ?? "null"})\n${seeded.stdout ?? ""}${seeded.stderr ?? ""}`,
    );
  }

  return { profileDir, root };
}

test.describe("window fits the route", () => {
  let app: ElectronApplication;
  let profileRoot: string;

  test.beforeAll(async () => {
    const { profileDir, root } = await buildProfile();
    profileRoot = root;
    app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${profileDir}`],
      cwd: REPO_ROOT,
      env: { ...process.env, ...LAUNCH_ENV },
    });
  });

  test.afterAll(async () => {
    await app?.close();
    if (profileRoot) rmSync(profileRoot, { recursive: true, force: true });
  });

  test("the catalog and the map fit the window, and their ends are reachable", async () => {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    // ----- The catalog. -----
    const appTitle = win.getByRole("link", { name: /^AllTheRepos$/i });
    await expect(appTitle).toBeVisible({ timeout: 15_000 });

    // Wait for the seeded rows rather than the empty shell, so the height
    // measurement is taken with a full grid.
    const cards = win.locator("[data-repo-slug]");
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    await expect(cards).toHaveCount(DEMO_REPO_COUNT, { timeout: 15_000 });

    const measured: Record<string, DocumentMetrics> = {
      "/": await metrics(win),
    };

    // The last row has to be reachable by scrolling the catalog's own region.
    // Once the document is proven unable to scroll, landing in the viewport can
    // only have come from the inner scroller.
    const lastCard = cards.last();
    await lastCard.scrollIntoViewIfNeeded();
    await expect(lastCard).toBeInViewport();

    // ----- The map. -----
    // The renderer uses TanStack Router's memory history, so navigate the way a
    // person does: click the destination. Scope to the banner — the sidebar and
    // the notice stack carry links of their own.
    const topBar = win.getByRole("banner");
    await topBar.getByRole("link", { name: /^map$/i }).click();
    const signals = win.getByRole("group", { name: "Relationship signals" });
    await expect(signals).toBeVisible({ timeout: 15_000 });

    measured["/graph"] = await metrics(win);

    // Both numbers first — this is the finding.
    expectFitsWindow(measured);

    // The map's bottom-anchored furniture is what the 64px of overflow pushed
    // below the fold, so it is asserted in the viewport, not just rendered.
    await expect(win.getByRole("group", { name: "Graph view" })).toBeInViewport();
    await expect(win.getByText("outside its cluster's home")).toBeInViewport();

    // And the header's second row — the six signal filters — is not clipped by
    // the route's own box.
    await expect(signals).toBeInViewport();
  });
});
