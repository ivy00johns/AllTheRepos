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
 *   3. Settings route is reachable via in-app navigation. The router keeps
 *      its route in the URL hash, so `#/settings` resolves, but the link is
 *      what a person clicks.
 *   4. No red console errors during catalog load + nav. Yellow / info
 *      messages are tolerated.
 *   5. A reload comes back where it was — the route, and the map's own state
 *      (the repo it was describing, the signal that was switched off). That
 *      is the promise the hash history was adopted for, and it is the one
 *      nothing else asserts; two specs in `workstream-b.spec.ts` depended on
 *      the *opposite* behaviour (a reload resetting the router to `/`, which
 *      is how memory history worked) and only CI noticed when it changed.
 *   6. The empty grid is honest about itself: it names the filter that emptied
 *      it, the grid and the count's strip name the same one, and a search that
 *      matched nothing offers the repos closest to what was typed. The
 *      real-data walkthrough asserts the same behaviour against a developer's
 *      own catalog; this one asserts it against the three seeded repos, so the
 *      behaviour is guarded on a machine that has no catalog to walk.
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
      // `/debug` is deliberately not a destination (ATR-074). The dev-only door to
      // it does exist in an unpackaged run, beside the nav rather than in it — so
      // the claim here is the one that matters: no destination is Debug. The other
      // half (a packaged build draws no affordance anywhere) is asserted in
      // `workstream-c.spec.ts`.
      await expect(
        win.locator("header nav").getByRole("link", { name: /^debug/i }),
        "Debug is a destination again",
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

  /**
   * The other half of (3): the address is not just resolvable on the way in,
   * it is what the window comes back to.
   *
   * Asserted on the running app rather than read off `router.tsx` because the
   * claim is about a real `location` in a real window: `createHashHistory`
   * only keeps the route if Electron hands the renderer a URL it can write a
   * fragment to, which is exactly what changed the day this was adopted.
   */
  test("a reload comes back on the same route, with the map's state", async () => {
    const { app, close } = await launchApp();
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      const appTitle = win.getByRole("link", { name: /^AllTheRepos$/i });
      await expect(appTitle).toBeVisible({ timeout: 20_000 });
      const banner = win.getByRole("banner");

      // ----- A route with no state: the route itself survives. -----
      await banner.getByRole("link", { name: /^settings$/i }).click();
      const settingsHeading = win.getByRole("heading", { name: /^Settings$/i });
      await expect(settingsHeading).toBeVisible({ timeout: 15_000 });

      await win.reload();
      await win.waitForLoadState("domcontentloaded");

      expect(
        new URL(win.url()).hash.startsWith("#/settings"),
        `the reload did not come back to settings — the address is ${win.url()}`,
      ).toBe(true);
      await expect(settingsHeading).toBeVisible({ timeout: 20_000 });

      // ----- The map: the address it writes is the state it comes back to. -----
      await banner.getByRole("link", { name: /^map$/i }).click();
      const listbox = win.getByRole("listbox", {
        name: "Repositories on the map",
      });
      await expect(listbox).toBeVisible({ timeout: 20_000 });
      const options = listbox.getByRole("option");
      await expect(options).toHaveCount(3, { timeout: 20_000 });

      // The degree rides on the option's text, as the ATR-069 spec found first.
      const chosen = options.nth(1);
      const name = (await chosen.innerText()).replace(/\s*\d+$/, "").trim();
      await chosen.click();

      const signal = win
        .getByRole("group", { name: "Relationship signals" })
        .getByRole("button", { name: /name family/i });
      await signal.click();
      await expect(signal).toHaveAttribute("aria-pressed", "false");

      const address = new URL(win.url()).hash;
      expect(
        address,
        "the map wrote no address for the reload to come back to",
      ).toContain("repo=");
      expect(address).toContain("off=");

      await win.reload();
      await win.waitForLoadState("domcontentloaded");

      // The same address...
      expect(new URL(win.url()).hash).toBe(address);
      // ...and the same screen: the inspector still describes the repo that was
      // selected, and the signal that was switched off is still off.
      await expect(
        win.getByRole("heading", { name }).first(),
        "the map did not come back describing the repo it was on",
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        win
          .getByRole("group", { name: "Relationship signals" })
          .getByRole("button", { name: /name family/i }),
        "the signal filter did not survive the reload",
      ).toHaveAttribute("aria-pressed", "false");
    } finally {
      await close();
    }
  });

  /**
   * A blank grid is the last place the catalog has to be honest about itself.
   *
   * It used to shrug — "Try a different search, or clear the filters" — which
   * sends the reader hunting the rail, the chips and the search box for
   * whichever control emptied the screen. It now names the filter responsible,
   * derived from the same ranked reasons the count's strip shows, and when the
   * search is what emptied it, offers the repos nearest what was typed.
   *
   * The two halves pull in opposite directions and both matter: a filter that
   * is hiding everything must be named *without* a list of "closest" repos
   * (nothing is close — the repos are right there, hidden), and a search that
   * matched nothing must find the repo behind a one-letter typo without a trip
   * through the toolbar.
   */
  test("an empty grid names the filter that emptied it, and the nearest repos", async () => {
    const { app, close } = await launchApp();
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      const cards = win.locator("[data-repo-slug]");
      const empty = win.locator("[data-empty-state]");
      const culprit = win.locator("[data-empty-culprit]");
      const searchBox = win
        .getByRole("searchbox", { name: /search repos/i })
        .first();

      await expect(win.getByRole("link", { name: /^AllTheRepos$/i })).toBeVisible({
        timeout: 20_000,
      });
      await expect(cards, "the seeded catalog is not on screen").toHaveCount(3, {
        timeout: 20_000,
      });

      // ----- A search that matches nothing names the search. -----
      await searchBox.click();
      // One letter out from a seeded repo's name: the case the suggestion list
      // exists for, and one no prefix search can reach.
      await searchBox.fill("demo liberary");
      await expect(cards).toHaveCount(0, { timeout: 15_000 });
      await expect(empty).toBeVisible();
      await expect(empty).toContainText("Nothing matches “demo liberary”");
      await expect(empty).toContainText("Hidden by search “demo liberary”");
      await expect(culprit).toHaveCount(1);
      await expect(culprit).toHaveAttribute("data-empty-culprit", "search");

      // The count's strip is the same explanation in another place, so it has
      // to name the same filter and the same number of repos.
      await win
        .getByRole("button", { name: /of 3 repos shown/i })
        .click();
      const reason = win.locator('[data-hidden-reason="search"]');
      await expect(reason).toHaveCount(1);
      await expect(reason).toHaveAttribute("data-hidden-count", "3");
      expect(
        await culprit.getAttribute("data-empty-culprit"),
        "the grid and the count's strip name different filters for one blank screen",
      ).toBe(await reason.getAttribute("data-hidden-reason"));

      // ----- And it offers the repo the typo was reaching for. -----
      const suggestions = win.locator("[data-near-miss]");
      await expect(suggestions).toHaveCount(1);
      await expect(suggestions.first()).toHaveAttribute(
        "data-near-miss",
        /^demo-library-/,
      );

      // Picking one has to put it back on screen, not just be a label.
      await suggestions.first().click();
      await expect(searchBox).toHaveValue("Demo Library");
      await expect(win.locator('[data-repo-slug^="demo-library-"]')).toHaveCount(1, {
        timeout: 15_000,
      });

      // ----- The grid's own button clears the filter it named. -----
      await searchBox.fill("demo liberary");
      await expect(culprit).toBeVisible({ timeout: 15_000 });
      await culprit.click();
      await expect(cards).toHaveCount(3, { timeout: 15_000 });

      // ----- A filter that empties the grid is named instead, with no list. -----
      // Nothing is "close" to a query here: three repos are hidden by a control
      // the reader turned on, and listing them as suggestions would be a
      // second, contradictory account of the same blank screen.
      const rail = win.getByRole("navigation", {
        name: /catalog filters and folders/i,
      });
      await rail.getByRole("button", { name: /^Favourites/ }).click();
      await expect(cards).toHaveCount(0, { timeout: 15_000 });
      await expect(culprit).toHaveAttribute("data-empty-culprit", "favorites");
      await expect(empty).toContainText("Hidden by Favourites only");
      await expect(suggestions).toHaveCount(0);

      // Clearing the named filter is what brings the catalog back.
      await culprit.click();
      await expect(cards).toHaveCount(3, { timeout: 15_000 });
    } finally {
      await close();
    }
  });
});
