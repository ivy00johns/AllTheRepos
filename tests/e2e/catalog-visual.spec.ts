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
 *   - And the cover art is masked, with its box measured instead: that art is a
 *     rotated SVG at a fractional scale, which rasterizes a fraction of a pixel
 *     differently between runs. See {@link COVER_BOX} — a mask is exactly the
 *     kind of thing that can hide a real change, which is why the number is
 *     asserted rather than trusted.
 *
 * Owner: qe-agent (2026-10-08 UI/UX pass).
 */

import {
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";

import { launchApp } from "./_launch-app";

/** The catalog, which is the route the app opens on and the one with view modes. */
const CATALOG = "/";

/** The window every capture is taken at, so the baseline is one shape. */
const WINDOW = { width: 1280, height: 800 } as const;

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
 * The cover art box, which the comparison masks and measures instead.
 *
 * The generated cover is a rotated SVG sliced into a fractional scale, and a
 * fraction of a pixel rasterizes differently between two runs of the same code:
 * an A/B pair of runs put 7409 pixels of this repository's own art on the diff,
 * as outlines around one card's motif, with nothing else changed. So the art is
 * painted out of the comparison and its box is asserted as numbers — which is
 * what a change to this element's size actually is.
 */
function covers(win: Page): Locator {
  return win.locator("[data-cover]");
}

/**
 * The art box's size in each view mode, in CSS px.
 *
 * Stated here rather than derived, because the mask is what makes it necessary:
 * a cover that quietly changed size is no longer visible in the picture.
 */
const COVER_BOX: Record<string, { width: number; height: number }> = {
  gallery: { width: 321, height: 127 },
  grid: { width: 44, height: 44 },
  table: { width: 32, height: 32 },
};

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

/** Every cover box on screen, as a size. */
async function coverBoxes(
  win: Page,
): Promise<Array<{ width: number; height: number }>> {
  return win.evaluate(() =>
    Array.from(document.querySelectorAll("[data-cover]")).map((el) => {
      const box = el.getBoundingClientRect();
      return { width: Math.round(box.width), height: Math.round(box.height) };
    }),
  );
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
    const { app, close } = await launchApp();

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

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

        // The art's size, before it is masked out of the picture below.
        const boxes = await coverBoxes(win);
        const expected = COVER_BOX[slugify(mode)];
        expect(
          boxes.length,
          `${mode} view drew no covers to measure`,
        ).toBeGreaterThan(0);
        for (const box of boxes) {
          expect
            .soft(
              box,
              `${mode} view's cover art is ${box.width}x${box.height}, not ${expected.width}x${expected.height} — the mask hides this, so it is asserted`,
            )
            .toEqual(expected);
        }

        const name = `catalog-${slugify(mode)}.png`;
        shots.push(name);
        // `soft`, so a run names every mode that moved rather than stopping at
        // the first one — the same reason the type sweep collects its findings.
        await expect
          .soft(win, `${CATALOG} — ${mode} view`)
          .toHaveScreenshot(name, {
            mask: [machinePaths(win), covers(win)],
          });
      }

      // A loop that never ran would compare nothing and pass, so the baselines
      // this run actually looked at are asserted to be one per view mode.
      expect(shots).toEqual(modes.map((mode) => `catalog-${slugify(mode)}.png`));
    } finally {
      await close();
    }
  });
});
