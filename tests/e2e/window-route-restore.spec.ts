/**
 * The window comes back where it was left, across a quit.
 *
 * The address carries the map's whole view state — which group is open, which
 * repo is selected, which signals are switched off (see `renderer/router.tsx`)
 * — and a *reload* has been pinned since that landed (`catalog-flow.spec.ts`).
 * A quit was still a reset: closing the app and opening it again put you back
 * on the catalog, and on a machine with a few hundred repos that is a long way
 * from a group you had opened.
 *
 * This spec asks the question the feature answers, which is only askable across
 * two launches of the **same profile**: main remembers the fragment in the
 * profile, so a spec that shares one launch cannot tell "restored" from "never
 * left". Hence `profileDir` and `keepProfile` on `launchApp` — the second start
 * is the assertion.
 *
 * What it cannot cover here: the group level. The seeded template profile's
 * three repos relate to nothing, so the map offers no groups to open and there
 * is no `cluster=` to carry. A selected repo and a switched-off filter are the
 * two thirds of that state this profile can produce, and they are the two the
 * address also carries.
 *
 * The second half of "where was I" is the window's shape, and it is asserted the
 * same way and for the same reason: main writes the size and position beside the
 * route, so the only honest test of it is a second launch of the same profile.
 * A window that was stretched for two panes and a window at the 1280×800 default
 * are different apps to come back to, and neither the route nor the screen can
 * tell you which one you got — only the frame can.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

import { launchApp } from "./_launch-app";

/** The fragment the app is on right now, as a string. */
function hashOf(win: Page): string {
  return new URL(win.url()).hash;
}

/**
 * The main window's frame, as the main process sees it.
 *
 * The renderer's `window.innerWidth` is the viewport, which is a consequence of
 * the frame and not the same number — on macOS the title bar and the window's own
 * chrome sit between them. The thing being remembered and restored is the frame,
 * so that is what this asks for, from the same process that wrote it down.
 */
async function frameOf(
  app: ElectronApplication,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error("the app has no window to measure");
    return win.getBounds();
  });
}

/** Wait for the shell, whichever route it painted. */
async function expectShell(win: Page): Promise<void> {
  await expect(win.getByRole("link", { name: /^AllTheRepos$/i })).toBeVisible({
    timeout: 20_000,
  });
}

/** The map's own rail — the only keyboard-or-pointer way onto a node. */
async function openMap(win: Page) {
  await win
    .getByRole("banner")
    .getByRole("link", { name: /^map$/i })
    .click();
  const listbox = win.getByRole("listbox", {
    name: "Repositories on the map",
  });
  /*
   * Wait for an option, not for the container.
   *
   * The rail paints its frame before the catalog read lands, and until it does
   * the listbox is there, empty and zero-height — which Playwright calls hidden,
   * so waiting on the container fails on a map that is loading perfectly
   * normally. "The map is up" is an option being visible, and the degree the
   * rail puts beside each name is what makes it worth having.
   */
  await expect(listbox.getByRole("option").first()).toBeVisible({
    timeout: 20_000,
  });
  return listbox;
}

test("a quit comes back to the map, and to the repo and filter it was on", async () => {
  const profile = mkdtempSync(join(tmpdir(), "atr-window-restore-"));

  try {
    // ----- Launch one: get somewhere worth returning to, then quit. -----
    const first = await launchApp({ profileDir: profile, keepProfile: true });
    let address: string;
    let name: string;
    try {
      const win = await first.app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await expectShell(win);

      const listbox = await openMap(win);
      const options = listbox.getByRole("option");
      await expect(options).toHaveCount(3, { timeout: 20_000 });

      // The degree rides on the option's text, as the ATR-069 spec found first.
      const chosen = options.nth(1);
      name = (await chosen.innerText()).replace(/\s*\d+$/, "").trim();
      await chosen.click();

      const signal = win
        .getByRole("group", { name: "Relationship signals" })
        .getByRole("button", { name: /name family/i });
      await signal.click();
      await expect(signal).toHaveAttribute("aria-pressed", "false");

      address = hashOf(win);
      expect(
        address,
        "the map wrote no address for a later launch to come back to",
      ).toContain("repo=");
      expect(address).toContain("off=");
    } finally {
      await first.close();
    }

    // ----- Launch two: the same profile, and no clicks at all. -----
    const second = await launchApp({ profileDir: profile, keepProfile: true });
    try {
      const win = await second.app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      // The address, not the screen, is the claim: main built the load URL from
      // what the last launch remembered, and nothing in the renderer writes to
      // the address until a person clicks something.
      expect(
        hashOf(win),
        "the second launch did not open on the address the first one left",
      ).toBe(address);

      // And the screen followed: the same repo described, the same filter off.
      await expectShell(win);
      await expect(
        win.getByRole("heading", { name }).first(),
        "the restored map does not describe the repo it was left on",
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        win
          .getByRole("group", { name: "Relationship signals" })
          .getByRole("button", { name: /name family/i }),
        "the restored map lost the signal that was switched off",
      ).toHaveAttribute("aria-pressed", "false");
    } finally {
      await second.close();
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

test("a quit comes back at the shape the window was left in", async () => {
  const profile = mkdtempSync(join(tmpdir(), "atr-window-shape-"));

  try {
    // ----- Launch one: stretch the window somewhere specific, then quit. -----
    const first = await launchApp({ profileDir: profile, keepProfile: true });
    const target = {
      x: 0,
      y: 0,
      width: 1000,
      height: 700,
    };
    try {
      const win = await first.app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await expectShell(win);

      /*
       * A shape the app would never have chosen by itself.
       *
       * The default is 1280×800, placed by the window manager — so a frame that
       * comes back as 1000×700 somewhere off-centre is the memory doing it, and
       * a launch that restored nothing fails on the size alone. The position is
       * derived from the display rather than hard-coded: a runner reports its own
       * work area, and a window placed at a fixed point on a hypothetical screen
       * is a test that passes only where the author was sitting.
       */
      const area = await first.app.evaluate(({ screen }) =>
        screen.getPrimaryDisplay().workArea,
      );
      target.x = Math.round(area.x + 30);
      target.y = Math.round(area.y + 30);
      await first.app.evaluate(({ BrowserWindow }, shape) => {
        BrowserWindow.getAllWindows()[0]?.setBounds(shape);
      }, target);

      // Settled before it is measured: a frame captured mid-resize is a
      // statement about a window that no longer exists.
      await expect
        .poll(() => frameOf(first.app), {
          message: `the window never reached ${target.width}×${target.height}`,
          timeout: 5_000,
        })
        .toEqual(target);
    } finally {
      await first.close();
    }

    // ----- Launch two: nothing resized, and the shape is the one left. -----
    const second = await launchApp({ profileDir: profile, keepProfile: true });
    try {
      const win = await second.app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      // Read before anything else happens: this is the shape the window was
      // *created* at, not one it grew into, and main is the only thing that could
      // have chosen it.
      expect(
        await frameOf(second.app),
        "the second launch did not open at the shape the first one left",
      ).toEqual(target);

      // And the shell is there, so this is a window that opened and not a frame
      // reported by a process that never painted.
      await expectShell(win);
    } finally {
      await second.close();
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

test("a first launch still opens on the catalog", async () => {
  // The control. Without it, a launch that appended a route to every window
  // would satisfy the test above and open a stale map for somebody who had
  // never been there. A fresh profile has nothing remembered, so the catalog is
  // where it must land — the address is empty or the bare route the renderer
  // normalises to.
  const { app, close } = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await expectShell(win);

    expect(
      ["", "#/"].includes(hashOf(win)),
      `a first launch opened on ${win.url()} instead of the catalog`,
    ).toBe(true);
  } finally {
    await close();
  }
});
