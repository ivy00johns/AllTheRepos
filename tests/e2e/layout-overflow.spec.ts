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
 * The chain from the route's own box up to `<html>`, with the numbers that
 * decide whether a percentage height resolves. A route that overflows is
 * always at least one ancestor failing to hand down a definite height, and
 * "1123 against 800" does not say which — this does, without anyone having to
 * re-derive it from the classes.
 */
function layoutChain(win: Page): Promise<Array<Record<string, unknown>>> {
  return win.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    const push = (label: string, el: Element | null): void => {
      if (!el) return;
      const style = getComputedStyle(el);
      out.push({
        at: label,
        height: style.height,
        overflowY: style.overflowY,
        offset: (el as HTMLElement).offsetHeight,
        scroll: (el as HTMLElement).scrollHeight,
      });
    };

    const main = document.querySelector("main");
    let el: Element | null = main;
    const up: Element[] = [];
    while (el) {
      up.push(el);
      el = el.parentElement;
    }
    up.reverse().forEach((node) =>
      push(
        `<${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}>`,
        node,
      ),
    );
    push(
      "main > route",
      main?.firstElementChild ?? null,
    );
    push(
      "main > route > content",
      main?.firstElementChild?.firstElementChild ?? null,
    );
    return out;
  });
}

/**
 * The shell holds elements and nothing else.
 *
 * A JSX comment written without its braces is *text*, so React renders it — and
 * a loose text child of the shell column is not cosmetic: it becomes an
 * anonymous flex item, cannot shrink below its content, and takes its height
 * out of `main`. That shipped: a block of CSS-looking prose above the content
 * on every route, which cost `main` a hundred pixels while every assertion in
 * this file still passed, because the document never grew. Hence a guard that
 * names the failure directly instead of one more height nobody would notice.
 */
async function expectShellHoldsOnlyElements(win: Page): Promise<void> {
  const stray = await win.evaluate(() => {
    const shell = document.querySelector("main")?.parentElement;
    if (!shell) return "no shell element above <main>";
    return [...shell.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => (node.textContent ?? "").trim())
      .filter(Boolean)
      .join(" | ");
  });
  expect(
    stray,
    `the shell renders loose text instead of only elements: ${stray}`,
  ).toBe("");
}

/**
 * Assert every measured route fits the window on both axes, in one go. The
 * assertion is written over the collected numbers rather than route by route so
 * a run reports *both* overflows: "848 against 800" is the whole finding, and
 * failing on the first route would hide whether the map had one too.
 */
async function expectFitsWindow(
  win: Page,
  measured: Record<string, DocumentMetrics>,
): Promise<void> {
  const viewport = Object.values(measured)[0];
  const chain = await layoutChain(win);
  expect(
    Object.fromEntries(
      Object.entries(measured).map(([route, m]) => [route, m.scrollHeight]),
    ),
    `a route is taller than the ${viewport.innerHeight}px window — the chain that decides it:\n${JSON.stringify(
      chain,
      null,
      2,
    )}`,
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

    // The shell is shared by every route, so once is enough — and it is
    // checked before the numbers, because a stray text node is what makes the
    // numbers look plausible while the content is pushed down.
    await expectShellHoldsOnlyElements(win);

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
    await expectFitsWindow(win, measured);

    // The map's bottom-anchored furniture is what the 64px of overflow pushed
    // below the fold, so it is asserted in the viewport, not just rendered.
    await expect(win.getByRole("group", { name: "Graph view" })).toBeInViewport();
    await expect(win.getByText("outside its cluster's home")).toBeInViewport();

    // And the header's second row — the six signal filters — is not clipped by
    // the route's own box.
    await expect(signals).toBeInViewport();

    // ----- A route that uses the padded shell instead. -----
    // Making the window unscrollable moved every remaining route onto
    // `SimpleShell` as the thing that scrolls, so one of them is held to the
    // same contract rather than assumed to have inherited it. Its last section
    // also has to be reachable, which is what proves the scroll moved inward
    // rather than the content being cut off.
    await topBar.getByRole("link", { name: /^settings$/i }).click();
    await expect(
      win.getByRole("heading", { name: /^Settings$/i }),
    ).toBeVisible({ timeout: 15_000 });

    measured["/settings"] = await metrics(win);
    await expectFitsWindow(win, measured);

    const lastSection = win.getByRole("heading", { name: /^Scan now$/i });
    await lastSection.scrollIntoViewIfNeeded();
    await expect(lastSection).toBeInViewport();

    // ----- The rest of the routes, on the same number. -----
    // The positioning-context fix is route-agnostic, which is reasoning and not
    // measurement: only `/`, `/graph` and `/settings` were ever held to this
    // contract. These four render and navigate elsewhere in the suite, so what
    // was missing is exactly the height. "Reachable end" checks are not
    // repeated here — the routes that carry bottom-anchored furniture already
    // have one, and inventing a marker for each of these would be asserting the
    // fixture rather than the route.
    const heights: Array<[string, RegExp, RegExp]> = [
      ["/claude", /^claude$/i, /^Claude Usage$/i],
      ["/processes", /^running/i, /^Processes$/i],
    ];
    for (const [route, label, heading] of heights) {
      await topBar.getByRole("link", { name: label }).click();
      // The route has painted: its own heading, whatever that route calls it.
      await expect(win.getByRole("heading", { name: heading })).toBeVisible({
        timeout: 15_000,
      });
      measured[route] = await metrics(win);
    }

    // ----- `/debug`, which is a route but no longer a destination (ATR-074). -----
    // It is held to the same height contract, so it still has to be *reached*,
    // and the way a person reaches it now is the command palette's dev-tools
    // action — not a top-bar link, which is the finding. The palette is opened
    // from the catalog, because the renderer's Cmd+K fallback mounts with the
    // catalog shell; the native menu accelerator cannot be driven from here.
    await topBar.getByRole("link", { name: /^AllTheRepos$/i }).click();
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    await win.keyboard.press("Meta+K");
    const palette = win.getByRole("dialog", { name: /command palette/i });
    await expect(palette).toBeVisible({ timeout: 15_000 });
    await palette.getByPlaceholder(/run a command/i).fill("debug page");
    await expect(
      palette.getByText(/^open debug page$/i).first(),
      "the palette no longer carries the door to /debug",
    ).toBeVisible({ timeout: 5_000 });
    await win.keyboard.press("Enter");
    await expect(palette).toBeHidden({ timeout: 5_000 });
    await expect(
      win.getByRole("heading", { name: /^\/debug — system\.ping$/i }),
    ).toBeVisible({ timeout: 15_000 });
    measured["/debug"] = await metrics(win);

    // The standalone repo page, through the affordance that opens it: select a
    // card, then take the detail panel's "open in a page" link.
    await topBar.getByRole("link", { name: /^AllTheRepos$/i }).click();
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    await cards.first().click();
    const openPage = win.getByRole("link", { name: "Open full detail page" });
    await expect(openPage).toBeVisible({ timeout: 15_000 });
    await openPage.click();
    await expect(
      win.getByRole("link", { name: /back to catalog/i }),
    ).toBeVisible({ timeout: 15_000 });
    measured["/repos/$slug"] = await metrics(win);

    // Every route, one comparison — a failure names which one and by how much.
    await expectFitsWindow(win, measured);
  });
});
