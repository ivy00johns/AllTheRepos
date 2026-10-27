/**
 * Catalog screenshot regression — the catalog in every view mode it offers,
 * compared with a committed baseline, pixel by pixel.
 *
 * Why this exists next to `type-scale.spec.ts`, which already reads the same
 * screen: that sweep asks whether a class list names a size, and a class list can
 * be perfectly clean while the screen moves. A `gap-2` that becomes `gap-1`, a
 * padding step that quietly changes, a card that gains a line, a grid column that
 * stops filling its row — none of those carry a font size, a step or a name, and
 * every one of them is visible. This is the half that only a picture can hold.
 *
 * What it is not: a picture nobody reads. A failure here ends in an artifact that
 * says which mode moved and by how much (`test-results/`), and the run names the
 * mode in the test title, so the question a failure asks is "what changed in the
 * grid view" rather than "something is different somewhere".
 *
 * The second capture is the wide layout with a repo open: 1440 wide, the
 * detail panel takes its 380, and the catalog is left narrower than three
 * 340px posters. That is the one shape where a group of three has to leave its
 * last poster alone on a line, so the picture is the only place the full-width
 * trailing row is checked at the width the handoff targets. The test also
 * measures that row before taking the picture, because a baseline regenerated
 * from a broken layout would otherwise enshrine the half-row hole forever.
 *
 * The modes are read off the running toolbar rather than listed here, the same way
 * `type-scale.spec.ts` reads them, so a fourth view is covered the day it is
 * added instead of the day someone remembers this file.
 *
 * ## Why the baseline can be a picture at all
 *
 * A screenshot is only a test if two runs of the same code produce the same
 * pixels, so everything that could have varied is pinned or proved to be fixed:
 *
 *   - The window is resized to a fixed 1280x800 and the renderer is asked to
 *     agree before anything is captured, so the baseline is one shape.
 *   - The catalog is the seeded template profile (`_global-setup.ts`): three
 *     synthetic repos whose commit and open timestamps are null. Every recency
 *     phrase on every card therefore reads the same thing on every run ("never",
 *     "unknown"), where a real catalog's "3 days ago" would rot the baseline by
 *     itself.
 *   - Fonts are bundled with the renderer, and the capture waits for
 *     `document.fonts.ready`, so a first paint cannot be photographed half in
 *     fallback type.
 *   - The pointer is parked in the corner after the mode is chosen. A hover state
 *     left behind by the click, or by wherever the mouse happened to be resting
 *     on the developer's desktop, is not a property of the code.
 *   - Animations and the caret are off suite-wide, in the config's
 *     `expect.toHaveScreenshot` block.
 *   - The library's own path is masked. `_global-setup.ts` seeds the template
 *     under a temp root, and the app draws that root in the folder header, in the
 *     sidebar and on every card — a different string on every run of the suite,
 *     and a different length on CI than here. It is machine data rather than
 *     design, so it is painted out rather than compared; everything around it is
 *     still compared, which is where the type and the spacing live.
 *   - Cover art is gone from every density: the index, Posters and the table
 *     are type and data only. The selector that used to mark the art box is
 *     asserted to be absent, so a cover cannot quietly return to a baseline.
 *
 *   - And the process sweep is declared rather than observed. The top bar draws a
 *     count badge as soon as anything is listening, so a capture taken while a dev
 *     server of the developer's happened to be up carries a badge the next run
 *     does not draw. That is how this spec came to pass on the runner and flake on
 *     the laptop the same baseline was regenerated from. `_process-fixture.ts`
 *     states the sweep this run sees, and the declaration is asserted below rather
 *     than trusted — a fixture the app cannot read has to fail here loudly instead
 *     of quietly falling back to the host's own listeners.
 *
 * Owner: qe-agent (2026-10-08 UI/UX pass).
 */

import os from "node:os";

import {
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";

import { launchApp } from "./_launch-app";
import { NO_LISTENERS, processFixtureEnv } from "./_process-fixture";

/** The catalog, which is the route the app opens on and the one with view modes. */
const CATALOG = "/";

/** The window every capture is taken at, so the baseline is one shape. */
const WINDOW = { width: 1280, height: 800 } as const;

/** The handoff's wide layout, where the detail panel is part of the column. */
const WIDE_WINDOW = { width: 1440, height: 900 } as const;

/**
 * Resize the real BrowserWindow, then wait for the renderer to agree.
 *
 * The same helper `nav-card-a11y.spec.ts` uses, for the same reason: the window
 * size is what decides this layout, and a capture taken before the renderer has
 * re-laid out is a picture of the old one.
 */
async function resizeWindow(
  app: ElectronApplication,
  win: Page,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height);
  }, { width, height });

  await expect
    .poll(() => win.evaluate(() => window.innerWidth), {
      message: `the window never reached ${width}px`,
      timeout: 5_000,
    })
    .toBe(width);
}

/** The top bar, which is where the destinations are and how the catalog is reached. */
function topBar(win: Page): Locator {
  return win.getByRole("banner");
}

/** The catalog's own rows, whichever view mode is drawing them. */
function rows(win: Page): Locator {
  return win.locator("[data-repo-slug]");
}

/**
 * The seeded library's path, in every place the app draws it.
 *
 * `/…/T/atr-e2e-template-<random>/repos` is a property of this run's temp root,
 * not of the catalog's design, and it is on screen in four places at once: the
 * folder header above the rows, the sidebar's scan-root row with its count, and
 * the folder label on every card and table row.
 */
function machinePaths(win: Page): Locator {
  return win.getByText(/atr-e2e-template-[a-z0-9]+/i);
}

/**
 * The art box the redesign deleted.
 *
 * Kept as a selector rather than a comment because an absence is the one
 * property a picture cannot prove: a new cover would simply become part of a
 * fresh baseline. All three densities assert it stays gone.
 */
function covers(win: Page): Locator {
  return win.locator("[data-cover]");
}

/**
 * Everything that has to be true before a capture means anything.
 *
 * A blank page photographs identically on every run, so "the pixels matched" is
 * worth exactly as much as the screen it was taken from — these are what say there
 * is a catalog on it.
 */
async function settle(win: Page, expectedRows: number): Promise<void> {
  await expect(topBar(win).getByRole("link", { name: /^AllTheRepos$/i })).toBeVisible(
    { timeout: 15_000 },
  );
  await expect(rows(win).first()).toBeVisible({ timeout: 15_000 });
  // The seeded catalog is the whole list, so the count is the profile's and not a
  // number this spec picks: a view mode that dropped a row would shift everything
  // below it, and that shift is what the picture is for.
  await expect(rows(win)).toHaveCount(expectedRows);
  await win.evaluate(() => document.fonts.ready);
}

/** The view modes the toolbar offers, read off the running app. */
async function viewModes(win: Page): Promise<string[]> {
  const group = win.getByRole("group", { name: "View mode" });
  await expect(group).toBeVisible({ timeout: 15_000 });
  const modes = (await group.getByRole("button").allInnerTexts())
    .map((label) => label.trim())
    .filter(Boolean);
  expect(
    modes.length,
    "the catalog offers fewer view modes than the toolbar used to carry",
  ).toBeGreaterThan(1);
  return modes;
}

/**
 * The rasterizer this run will be compared against, as a file-name token.
 *
 * A screenshot baseline is only a test if the machine that produced it renders
 * the way this one does, and on macOS that is the OS version: CoreText
 * rasterizes text (and the compositor anti-aliases) slightly differently on
 * every major release. Measured on 2026-10-08, a baseline rendered on macOS 27
 * and compared on the `macos-14` runner differs over ~1% of pixels — every
 * view mode, uniformly, with the content identical (the row count and the cover
 * boxes both matched). That is *more* than the change this file exists to catch:
 * the `gap-3`→`gap-4` nudge it was proved against moved ~0.3% of pixels. The two
 * cannot be told apart by a tolerance, so the environment is part of the key
 * instead: each rasterizer gets its own committed baseline, and a rasterizer
 * with no baseline fails loudly rather than passing against another one's
 * picture.
 *
 * `os.release()` is the Darwin kernel version, whose major tracks the macOS
 * release (`23` is macOS 14, `27` is macOS 27), so the token reads as
 * `darwin27` here and `darwin23` on the runner. Adding an environment (a new
 * macOS on the CI runner, or a Linux leg) means generating its baseline with
 * `pnpm visual:baselines` and committing it — the same way this one was made.
 */
function renderEnvironment(): string {
  const [major] = os.release().split(".");
  return `${process.platform}${major}`;
}

/** A file-name-safe form of a mode's label, for the baseline it names. */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

test.describe("the catalog, as pictures", () => {
  test.setTimeout(180_000);

  test("every view mode matches its committed baseline", async () => {
    // Declared, not observed — see the last bullet of this file's header.
    const { app, close } = await launchApp({
      env: processFixtureEnv(NO_LISTENERS),
    });

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      /**
       * The declaration has to have arrived, or this spec is back to
       * photographing the host. The badge is absent when the sweep is empty, so
       * the top bar's own words are the assertion: the Running destination reads
       * "No running processes" until something is listening.
       */
      await expect(
        win.getByRole("link", { name: /no running processes/i }),
      ).toBeAttached();

      await resizeWindow(app, win, WINDOW.width, WINDOW.height);
      await settle(win, 3);

      const modes = await viewModes(win);
      const shots: string[] = [];

      for (const mode of modes) {
        await win
          .getByRole("group", { name: "View mode" })
          .getByRole("button", { name: mode, exact: true })
          .click();
        // Whichever mode is on, its rows are what says it painted.
        await expect(rows(win).first()).toBeVisible({ timeout: 15_000 });

        // Park the pointer: a hover ring the click left behind, or the one the
        // developer's own mouse is casting, is not a property of this code.
        await win.mouse.move(0, 0);
        // Two frames, so the capture is of a settled layout rather than of the
        // frame the click landed in.
        await win.evaluate(
          () =>
            new Promise<void>((done) =>
              requestAnimationFrame(() => requestAnimationFrame(() => done())),
            ),
        );

        // No density draws cover art after the redesign.
        expect(
          await covers(win).count(),
          `${mode} view drew cover art, but the redesign dropped it from every density`,
        ).toBe(0);

        const name = `catalog-${slugify(mode)}-${renderEnvironment()}.png`;
        shots.push(name);
        // `soft`, so a run names every mode that moved rather than stopping at
        // the first one — the same reason the type sweep collects its findings.
        await expect
          .soft(win, `${CATALOG} — ${mode} view`)
          .toHaveScreenshot(name, {
            mask: [machinePaths(win)],
          });
      }

      // A loop that never ran would compare nothing and pass, so the baselines
      // this run actually looked at are asserted to be one per view mode.
      const env = renderEnvironment();
      expect(shots).toEqual(modes.map((mode) => `catalog-${slugify(mode)}-${env}.png`));
    } finally {
      await close();
    }
  });

  test("Posters at 1440 gives an odd trailing row the full width", async () => {
    test.setTimeout(180_000);

    const { app, close } = await launchApp({
      env: processFixtureEnv(NO_LISTENERS),
    });

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await expect(
        win.getByRole("link", { name: /no running processes/i }),
      ).toBeAttached();

      await resizeWindow(app, win, WIDE_WINDOW.width, WIDE_WINDOW.height);
      await settle(win, 3);

      // Open a repo first: the panel is part of the layout at this width, so
      // the catalog loses its 380 and a three-poster group can no longer fit
      // on one line. This is the shape the trailing-row rule exists for.
      await rows(win).first().click();
      const panel = win.locator('aside[aria-label="Repo detail"]');
      await expect(panel).toHaveAttribute("aria-hidden", "false");
      await expect(
        panel.getByRole("button", { name: "Close detail panel" }),
      ).toBeVisible({ timeout: 15_000 });

      await win
        .getByRole("group", { name: "View mode" })
        .getByRole("button", { name: "Posters", exact: true })
        .click();
      await expect(rows(win).first()).toBeVisible({ timeout: 15_000 });

      // Measure before photographing. The panel width animates, so the first
      // read can still see the catalog at its pre-panel width; poll until the
      // two-row shape settles. A baseline regenerated from the broken shape
      // would otherwise look like a pass forever.
      await expect
        .poll(
          () =>
            win.evaluate(() => {
              const list = document.querySelector('[role="list"]');
              const items = [...document.querySelectorAll("[data-repo-slug]")];
              if (!list || items.length !== 3) return null;
              const listWidth = list.getBoundingClientRect().width;
              const tops = new Set<number>();
              let firstWidth = 0;
              let lastWidth = 0;
              items.forEach((item, index) => {
                const rect = item.getBoundingClientRect();
                tops.add(Math.round(rect.top));
                if (index === 0) firstWidth = rect.width;
                if (index === items.length - 1) lastWidth = rect.width;
              });
              return {
                rows: tops.size,
                firstIsTrack: firstWidth <= listWidth * 0.6,
                lastCoversList: lastWidth >= listWidth * 0.9,
              };
            }),
          {
            message:
              "the wide Posters layout never settled into two rows with a full-width trailing poster",
            timeout: 5_000,
          },
        )
        .toEqual({ rows: 2, firstIsTrack: true, lastCoversList: true });

      await win.mouse.move(0, 0);
      await win.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );

      expect(
        await covers(win).count(),
        "Posters view drew cover art, but the redesign dropped it from every density",
      ).toBe(0);

      await expect
        .soft(win, `${CATALOG} — Posters view, 1440 with the detail panel open`)
        .toHaveScreenshot(`catalog-posters-1440-detail-${renderEnvironment()}.png`, {
          mask: [machinePaths(win)],
        });
    } finally {
      await close();
    }
  });
});
