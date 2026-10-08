/**
 * Type-scale E2E — the rule, read off every screen the app has.
 *
 * ATR-072's guard was a source walk, and its on-screen half was one route: `/`,
 * which never drew the table view. So a raw 13px size sat on a screen the check
 * never opened, and the check stayed green — which is the shape of hole this file
 * exists to close. The screens are not listed by hand, either:
 *
 *   - Every route the router composes is read out of `src/renderer/routes/`, and
 *     the sweep fails if one of them is not in its visit plan. A new screen cannot
 *     be silently immune to a rule about every screen.
 *   - The catalog's view modes are read off the running toolbar, so a fourth view
 *     is audited the day it is added.
 *   - The satellite windows are read out of the factories that create them, so the
 *     spotlight and the tray popover are audited too. They are separate renderer
 *     roots over this same bundle, and the popover has no door from a renderer at
 *     all — see `SATELLITES` for how each one is opened.
 *
 * Each screen is then held to the same three things, on the built renderer:
 *
 *   - no element carries a raw font size in its class list — any value, in `px`,
 *     `rem` or `em`. This is the unit guard's rule, read back off what painted;
 *   - every element carrying a named step computes to that step's size
 *     (`.atr-label` 12, `.atr-micro` 10, `.atr-meta` 11, `text-body` 13), which is
 *     also what says a theme token produces a real utility rather than a class
 *     nothing matches — a misdeclared step leaves those elements at 16px;
 *   - no heading, tab or column header is below the 12px floor — the roles the
 *     finding was about, on every screen rather than on the route that was
 *     measured.
 *
 * Findings are collected across the whole sweep and asserted once, so a run names
 * every screen that is wrong instead of stopping at the first.
 *
 * Owner: qe-agent (2026-10-08 UI/UX pass).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";

import { launchApp } from "./_launch-app";

const REPO_ROOT = resolve(__dirname, "..", "..");
const ROUTES_DIR = join(REPO_ROOT, "src", "renderer", "routes");
const WINDOW_DIR = join(REPO_ROOT, "src", "main", "window");

/** The size each named step claims. The unit guard pins the CSS; this reads what painted. */
const TIER_PX: Record<string, number> = {
  "atr-label": 12,
  "atr-micro": 10,
  "atr-meta": 11,
  "text-body": 13,
};

/** The floor ATR-072 asked for — now held to on every screen, not only the one it was measured on. */
const FLOOR_PX = 12;

/** The catalog is the route the app opens on, and the one with view modes. */
const CATALOG = "/";

interface TierHit {
  tier: string;
  size: number;
  text: string;
}

interface Audit {
  raw: string[];
  tiers: TierHit[];
  underFloor: Array<{ tag: string; size: number; text: string }>;
  /** Characters of text in `main`, so an empty screen cannot pass the audit. */
  painted: number;
}

/** One screen's type scale, as the built renderer computes it. */
function audit(win: Page): Promise<Audit> {
  return win.evaluate((tierNames: string[]) => {
    const raw: string[] = [];
    const tiers: Array<{ tier: string; size: number; text: string }> = [];
    const underFloor: Array<{ tag: string; size: number; text: string }> = [];

    const FLOOR_SELECTOR =
      'h1,h2,h3,h4,h5,h6,[role="tab"],[role="columnheader"]';

    document.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const cls = typeof el.className === "string" ? el.className : "";
      if (/text-\[[^\]\s]*(?:px|rem|em)\]/.test(cls)) {
        raw.push(`${el.tagName.toLowerCase()}.${cls.slice(0, 80)}`);
      }

      const size = parseFloat(getComputedStyle(el).fontSize);
      const text = (el.textContent ?? "").trim().slice(0, 40);
      for (const tier of tierNames) {
        if (new RegExp(`(^|\\s)${tier}(\\s|$)`).test(cls)) {
          tiers.push({ tier, size, text });
        }
      }
      if (text.length > 0 && el.matches(FLOOR_SELECTOR)) {
        underFloor.push({ tag: el.tagName.toLowerCase(), size, text });
      }
    });

    return {
      raw,
      tiers,
      underFloor,
      // `body`, not `main`: the satellite windows are the same bundle without a
      // `<main>` — a root component of their own — and this is a liveness check.
      painted: (document.body?.innerText ?? "").trim().length,
    };
  }, Object.keys(TIER_PX));
}

/**
 * Every route the router composes, read from the files that declare them.
 *
 * `router.tsx` composes the tree by hand from `routes/*.tsx`, so the route files
 * *are* the app's own declaration of its screens. A file added without a line in
 * the visit plan fails the coverage test below rather than going unaudited.
 */
function declaredRoutePaths(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((name) => name.endsWith(".tsx") && name !== "__root.tsx")
    .map((name) => {
      const source = readFileSync(join(ROUTES_DIR, name), "utf8");
      const path = /\bpath:\s*"([^"]+)"/.exec(source)?.[1];
      if (!path) {
        throw new Error(`[type-scale] ${name} declares no path — has it moved?`);
      }
      return path;
    })
    .sort();
}

/**
 * Every satellite window the main process creates, read from the factories that
 * create them.
 *
 * Each loads this same renderer bundle with a `#window=<kind>` hash, which is what
 * `src/renderer/main.tsx` reads to choose the root component — so the hash constant
 * in the factory is the app's own statement that the window exists. The main
 * window carries no hash and is covered by the route sweep instead.
 */
function declaredWindowKinds(): string[] {
  return readdirSync(WINDOW_DIR)
    .filter((name) => name.endsWith(".ts"))
    .flatMap((name) => {
      const source = readFileSync(join(WINDOW_DIR, name), "utf8");
      return [...source.matchAll(/_HASH\s*=\s*"window=([a-z-]+)"/g)].map(
        (match) => match[1] ?? "",
      );
    })
    .filter(Boolean)
    .sort();
}

/** The top bar, which is where the destinations are and the only way to reach them. */
function topBar(win: Page): Locator {
  return win.getByRole("banner");
}

/** The catalog, which is the one route every other reach depends on. */
async function toCatalog(win: Page): Promise<void> {
  await topBar(win).getByRole("link", { name: /^AllTheRepos$/i }).click();
  await expect(win.locator("[data-repo-slug]").first()).toBeVisible({
    timeout: 15_000,
  });
}

/** A destination, clicked the way a person reaches it: the top bar's own link. */
async function toDestination(
  win: Page,
  label: RegExp,
  marker: () => Locator,
): Promise<void> {
  await topBar(win).getByRole("link", { name: label }).click();
  await expect(marker()).toBeVisible({ timeout: 15_000 });
}

/**
 * `/debug`, which is a route but not a destination (ATR-074), so the way in is the
 * command palette's dev-tools action. This run is an unpackaged build, which is the
 * build that offers it.
 */
async function toDebug(win: Page): Promise<void> {
  await toCatalog(win);
  await win.keyboard.press("Meta+K");
  const palette = win.getByRole("dialog", { name: /command palette/i });
  await expect(palette).toBeVisible({ timeout: 15_000 });
  await palette.getByPlaceholder(/run a command/i).fill("debug page");
  await expect(
    palette.getByText(/^open debug page$/i).first(),
    "the palette no longer carries the door to /debug — the page is now unreachable",
  ).toBeVisible({ timeout: 5_000 });
  await win.keyboard.press("Enter");
  await expect(palette).toBeHidden({ timeout: 5_000 });
  await expect(
    win.getByRole("heading", { name: /^\/debug — system\.ping$/i }),
  ).toBeVisible({ timeout: 15_000 });
}

/** The standalone repo page, through the affordances that open it. */
async function toRepoPage(win: Page): Promise<void> {
  await toCatalog(win);
  await win.locator("[data-repo-slug]").first().click();
  const openPage = win.getByRole("link", { name: "Open full detail page" });
  await expect(openPage).toBeVisible({ timeout: 15_000 });
  await openPage.click();
  await expect(win.getByRole("link", { name: /back to catalog/i })).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * The satellite windows, each opened the way it can be opened.
 *
 * The spotlight has a door that works in every build — the command palette's
 * `app.open-spotlight` action, which is the same code path the global accelerator
 * runs — so it is opened like any other destination. The tray popover has none:
 * main's tray click is the only path to it, so the sweep calls the handler main
 * publishes on `globalThis` for an `ATR_E2E` run. That is the one seam this spec
 * needs, and it is the app's real path rather than a second factory.
 */
const SATELLITES: Array<{
  kind: string;
  open: (ctx: { app: ElectronApplication; win: Page }) => Promise<void>;
  marker: (page: Page) => Locator;
}> = [
  {
    kind: "spotlight",
    open: async ({ win }) => {
      await win.keyboard.press("Meta+K");
      const palette = win.getByRole("dialog", { name: /command palette/i });
      await expect(palette).toBeVisible({ timeout: 15_000 });
      await palette.getByPlaceholder(/run a command/i).fill("open spotlight");
      await expect(
        palette.getByText(/^open spotlight$/i).first(),
        "the palette no longer carries the door to the spotlight — the window is now unreachable from the app",
      ).toBeVisible({ timeout: 5_000 });
      await win.keyboard.press("Enter");
      await expect(palette).toBeHidden({ timeout: 5_000 });
    },
    marker: (page) => page.getByLabel("Spotlight search"),
  },
  {
    kind: "tray-popover",
    open: async ({ app }) => {
      await app.evaluate(() => {
        (
          globalThis as { __atrE2EOpenTrayPopover?: () => void }
        ).__atrE2EOpenTrayPopover?.();
      });
    },
    marker: (page) => page.getByRole("button", { name: /^open spotlight/i }),
  },
];

/**
 * The Page behind a satellite window, once it exists and paints.
 *
 * The windows appear asynchronously — the spotlight is created lazily on its
 * first `show()`, and the popover on its first `showAt()` — so this polls the
 * app's own window list for the one whose URL carries the kind's hash.
 */
async function satellitePage(
  app: ElectronApplication,
  kind: string,
  marker: (page: Page) => Locator,
): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(
      () => {
        found = app
          .windows()
          .find((page) => page.url().includes(`#window=${kind}`));
        return found !== undefined;
      },
      {
        timeout: 20_000,
        message: `the ${kind} window never opened`,
      },
    )
    .toBe(true);

  const page = found as Page;
  await page.waitForLoadState("domcontentloaded");
  // Its own control, so the audit reads a painted screen rather than a blank one.
  await expect(marker(page)).toBeVisible({ timeout: 15_000 });
  return page;
}

/** The rest of the routes, each reached the way a person reaches it. */
const PLAN: Array<{ route: string; reach: (win: Page) => Promise<void> }> = [
  {
    route: "/graph",
    reach: (win) =>
      toDestination(win, /^map$/i, () =>
        win.getByRole("group", { name: "Relationship signals" }),
      ),
  },
  {
    route: "/claude",
    reach: (win) =>
      toDestination(win, /^claude$/i, () =>
        win.getByRole("heading", { name: /^Claude Usage$/i }),
      ),
  },
  {
    route: "/processes",
    reach: (win) =>
      toDestination(win, /^running/i, () =>
        win.getByRole("heading", { name: /^Processes$/i }),
      ),
  },
  {
    route: "/settings",
    reach: (win) =>
      toDestination(win, /^settings$/i, () =>
        win.getByRole("heading", { name: /^Settings$/i }),
      ),
  },
  { route: "/debug", reach: toDebug },
  { route: "/repos/$slug", reach: toRepoPage },
];

/**
 * Dismiss the satellite windows before the app is asked to quit.
 *
 * Both of them hide instead of closing — an `event.preventDefault()` on `close`,
 * which is what makes re-summoning them instant — so a graceful quit is left
 * waiting on windows that are never going to close, and the worker times out with
 * the app still up. `destroy()` is the only way past a handler that refuses, and
 * it is the test's business to do it: no other spec opens these windows.
 */
async function dismissSatellites(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents.getURL().includes("#window=")) window.destroy();
    }
  });
}

test.describe("type scale, on every screen", () => {
  test.setTimeout(240_000);

  test("every route the router composes is in the sweep", () => {
    const declared = declaredRoutePaths();
    expect(
      declared.length,
      "no routes were found — this walk is reading the wrong directory",
    ).toBeGreaterThan(5);

    const planned = [CATALOG, ...PLAN.map((screen) => screen.route)];
    expect(
      declared.filter((route) => !planned.includes(route)),
      "a route exists that this sweep never visits — add it to PLAN (a screen nobody audits is a screen a font size can hide on)",
    ).toEqual([]);
    expect(
      planned.filter((route) => !declared.includes(route)),
      "the plan visits a route the router does not compose",
    ).toEqual([]);
  });

  test("every satellite window main creates is opened and audited", () => {
    const kinds = declaredWindowKinds();
    expect(
      kinds.length,
      "no satellite windows were found — this walk is reading the wrong directory",
    ).toBeGreaterThan(1);

    // The same two-way agreement as the routes: a window added later cannot be
    // immune to a rule about every screen, and the sweep cannot open a window
    // that no longer exists.
    const opened = SATELLITES.map((satellite) => satellite.kind);
    expect(
      kinds.filter((kind) => !opened.includes(kind)),
      "main creates a window this sweep never opens — add it to SATELLITES",
    ).toEqual([]);
    expect(
      opened.filter((kind) => !kinds.includes(kind)),
      "the sweep opens a window kind main does not create",
    ).toEqual([]);
  });

  test("no screen names a font size, and every step is the size it claims", async () => {
    const { app, close } = await launchApp();

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });

      const findings: string[] = [];
      const stepsSeen = new Set<string>();
      /** Every screen this run actually audited, in order — asserted against the plan below. */
      const audited: string[] = [];

      /**
       * The rule, read off whatever is on screen and collected rather than thrown:
       * one run reports every screen that is wrong.
       */
      const auditScreen = async (
        screen: string,
        page: Page = win,
      ): Promise<void> => {
        audited.push(screen);
        const result = await audit(page);

        // An empty screen would satisfy every assertion below, so prove it painted.
        expect(
          result.painted,
          `${screen} rendered no text — the audit would pass on a blank screen`,
        ).toBeGreaterThan(0);

        for (const cls of result.raw) {
          findings.push(`${screen}: a raw font size on class "${cls}"`);
        }
        for (const hit of result.tiers) {
          stepsSeen.add(hit.tier);
          if (hit.size !== TIER_PX[hit.tier]) {
            findings.push(
              `${screen}: .${hit.tier} computes to ${hit.size}px, not ${TIER_PX[hit.tier]}px — "${hit.text}"`,
            );
          }
        }
        for (const el of result.underFloor) {
          if (el.size < FLOOR_PX) {
            findings.push(
              `${screen}: <${el.tag}> "${el.text}" is ${el.size}px, below the ${FLOOR_PX}px floor`,
            );
          }
        }
      };

      // ----- The catalog, as it opens. -----
      await auditScreen(CATALOG);

      // ----- Every other route, reached the way a person reaches it. -----
      // Before the view modes rather than after, because `/repos/$slug` is opened
      // by clicking a card: in the table view that row is a container and the repo
      // name is the control (ATR-066), so this is the order that walks through the
      // affordances the app actually offers.
      for (const screen of PLAN) {
        await screen.reach(win);
        await auditScreen(screen.route);
      }

      // ----- The catalog in every view mode it offers. -----
      // The modes are read from the toolbar rather than listed here, so the sweep
      // follows the app instead of a memory of it.
      await toCatalog(win);
      const modeGroup = win.getByRole("group", { name: "View mode" });
      await expect(modeGroup).toBeVisible({ timeout: 15_000 });
      const modes = (await modeGroup.getByRole("button").allInnerTexts())
        .map((label) => label.trim())
        .filter(Boolean);
      expect(
        modes.length,
        "the catalog offers fewer view modes than the toolbar used to carry",
      ).toBeGreaterThan(1);

      for (const mode of modes) {
        await modeGroup.getByRole("button", { name: mode, exact: true }).click();
        // Whichever mode is on, its hit areas are the thing that says it painted.
        await expect(win.locator("[data-repo-slug]").first()).toBeVisible({
          timeout: 15_000,
        });
        await auditScreen(`${CATALOG} — ${mode} view`);
      }

      // ----- The satellite windows: separate renderer roots, so separate screens
      // with their own type. -----
      for (const satellite of SATELLITES) {
        await satellite.open({ app, win });
        const page = await satellitePage(app, satellite.kind, satellite.marker);
        await auditScreen(`#window=${satellite.kind}`, page);
      }

      // A loop that never ran would pass every assertion above on nothing, so the
      // screens that were audited are compared with the plan they were meant to
      // follow — and that plan is itself held to the router by the test above.
      expect(
        audited,
        "the sweep did not audit the screens it planned to",
      ).toEqual([
        CATALOG,
        ...PLAN.map((screen) => screen.route),
        ...modes.map((mode) => `${CATALOG} — ${mode} view`),
        ...SATELLITES.map((satellite) => `#window=${satellite.kind}`),
      ]);

      expect(
        findings,
        `${findings.length} screen(s) break the type scale`,
      ).toEqual([]);

      // A step nothing draws is a step nobody is holding the app to: the tiers are
      // pinned in the stylesheet by the unit guard, and this is the half that says
      // each one is actually on a screen somewhere.
      expect(
        Object.keys(TIER_PX).filter((tier) => !stepsSeen.has(tier)),
        "a named step is defined but drawn on no screen of the app",
      ).toEqual([]);
    } finally {
      await dismissSatellites(app);
      await close();
    }
  });
});
