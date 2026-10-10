/**
 * The shell's five click-and-keyboard blockers, measured in a real window.
 *
 * The [2026-10-07 UI/UX review](../../docs/audits/2026-10-07-ui-ux-review.md)
 * filed them (ATR-059, ATR-060, ATR-066, ATR-069, ATR-065) from a source read:
 * the review's own note on the first one says the sub-1024 case is "read from
 * source and CSS semantics, not measured — the window was not resized". All
 * five are the kind of bug a source read cannot settle, because what matters
 * is a property of the *rendered* result:
 *
 *   - **ATR-059** — below `lg` each top-bar destination rendered its label as
 *     `hidden lg:inline`. `display: none` removes text from the accessible
 *     name, so all five destinations became icon-only links with no name at
 *     all — and the window's minimum width is 800, so this is reachable by
 *     dragging its edge, not a hypothetical.
 *   - **ATR-060** — the catalog card was an `<article role="button">`
 *     containing real buttons (favourite, port chips, launchers). A button
 *     role cannot have interactive descendants: assistive tech flattens or
 *     skips them, and the nested controls stop being reachable.
 *   - **ATR-066** — in table view a `<tr>` carried `tabIndex={0}`, an
 *     `onClick` and an Enter-only `onKeyDown`. It was announced as a row, with
 *     no role to press and no name to press it with, and Space did nothing.
 *   - **ATR-069** — the map paints into cytoscape `<canvas>` elements, which
 *     cannot be focused or announced, so no node was reachable from the
 *     keyboard at all and the inspector — which *is* readable — could only
 *     describe a node somebody else had already selected.
 *   - **ATR-065** — the Claude range selector declared `role="radiogroup"` over
 *     four `role="radio"` buttons and implemented none of the pattern: every
 *     option was its own tab stop and the arrow keys did nothing. A screen
 *     reader was told "radio button" and handed a control that ignored the keys
 *     radios are expected to answer.
 *
 * So this spec launches the built app, resizes the actual `BrowserWindow` the
 * way a person drags its edge, and reads the answers back out of the
 * browser's own accessibility tree (`ariaSnapshot`). The top bar is checked on
 * `/` and then again on `/graph`, because those are the two routes the review
 * swept and they do not render through the same shell — only `/` gets the full
 * one (`__root.tsx` puts `/graph` inside `SimpleShell`) — so "named at 900px"
 * is asserted on both rather than assumed to carry over. The three keyboard
 * items are measured the same way in the routes that own them — the catalog in
 * table view, the map on `/graph`, the range selector on `/claude` — where
 * "press the key and read what the tree says" is the only way to tell a real
 * control from one that merely looks like it. Every assertion here is a property of what was rendered — a name, a role, a box the size of a
 * screen-reader-only span, a subtree, where the focus went — rather than of the
 * markup, which is what makes reverting any of these fixes turn one of them red.
 *
 * It shares the seeded template profile from `_global-setup.ts`, so it needs
 * no fixtures of its own.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { launchApp } from "./_launch-app";
import { resizeWindow } from "./_window";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

/**
 * Tailwind's `lg` (where the labels come back) and a width a person can drag
 * to — the main window's minimum is 800 (`src/main/window/main-window.ts`).
 * `height` is only here so the resize is a resize; nothing depends on it.
 */
const LG_BREAKPOINT = 1024;
const NARROW = { width: 900, height: 800 };

/** Every destination the top bar renders, in the order it renders them. */
const NAV_LABELS = ["Running", "Map", "Claude", "Settings", "Debug"] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test.describe("shell accessibility", () => {
  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test("every top-bar destination keeps its name at 900px, and its label stays collapsed", async () => {
    const { app, close } = await launchApp();

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });

      const topBar = win.getByRole("banner");
      const linkFor = (label: string) =>
        topBar.getByRole("link", {
          name: new RegExp(`^${escapeRegExp(label)}\\b`, "i"),
        });
      const labelBox = (label: string) =>
        linkFor(label).locator("span").first().boundingBox();

      // ----- (1) The width the app opens at: the labels are on screen. -----
      // Asserted so that a fix for the narrow case cannot be "show the labels
      // at every width" — the collapse below `lg` is the design.
      expect(await win.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(
        LG_BREAKPOINT,
      );
      for (const label of NAV_LABELS) {
        const box = await labelBox(label);
        expect(
          box?.width ?? 0,
          `${label}'s label should be on screen at this width`,
        ).toBeGreaterThan(20);
      }

      // ----- (2) The width a person can drag the edge to. -----
      await resizeWindow(app, win, NARROW);
      expect(await win.evaluate(() => window.innerWidth)).toBeLessThan(
        LG_BREAKPOINT,
      );

      for (const label of NAV_LABELS) {
        await expect(
          linkFor(label),
          `${label} should still be named at ${NARROW.width}px`,
        ).toHaveCount(1);

        // The label is still *rendered* here — clipped into a 1x1 box, which
        // is what keeps it in the accessible name. `display: none` takes it
        // out entirely, and that is precisely the bug.
        const box = await labelBox(label);
        expect(
          box?.width ?? 99,
          `${label}'s label should be collapsed at ${NARROW.width}px, not shown`,
        ).toBeLessThanOrEqual(2);
      }

      // ----- (3) What the browser's accessibility tree says. -----
      // The one thing a source read genuinely cannot tell you.
      const tree = await topBar.ariaSnapshot();
      for (const label of NAV_LABELS) {
        expect(
          tree,
          `the accessibility tree should name ${label}:\n${tree}`,
        ).toMatch(new RegExp(`link "${label}\\b`));
      }

      // ----- (4) The same bar on the other route the review swept. -----
      // `/graph` renders inside `SimpleShell` rather than the full one, so the
      // destinations have to be named there too. Navigating through the bar
      // itself keeps this the in-app path a person takes: the renderer uses
      // memory history, so a `goto` would not reach the route at all.
      await linkFor("Map").click();
      await expect(
        win.getByRole("img", { name: /linked by/i }),
        "the map summary is how this spec knows /graph mounted",
      ).toBeVisible({ timeout: 15_000 });

      for (const label of NAV_LABELS) {
        await expect(
          linkFor(label),
          `${label} should still be named on /graph at ${NARROW.width}px`,
        ).toHaveCount(1);
      }

      const graphTree = await topBar.ariaSnapshot();
      for (const label of NAV_LABELS) {
        expect(
          graphTree,
          `the accessibility tree should name ${label} on /graph:\n${graphTree}`,
        ).toMatch(new RegExp(`link "${label}\\b`));
      }
    } finally {
      await close();
    }
  });

  test("a catalog card stays a container, and its own controls remain reachable", async () => {
    const { app, close } = await launchApp();

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });

      // The seeded catalog's first card. The default density is the grid
      // (`stores/catalog-view.ts`), so this is an `<article>`, not a row.
      const card = win.locator("article[data-repo-slug]").first();
      await expect(card).toBeVisible({ timeout: 15_000 });

      // The blocker itself: a button role that contains buttons.
      await expect(card).not.toHaveAttribute("role", "button");

      // The card's one control is its title, and it is a real button carrying
      // the repo's name — the keyboard path the article used to fake with
      // `onKeyDown`, with Enter and Space supplied by the element instead.
      //
      // The match is a prefix rather than the whole name, because the shipped
      // button labels itself with the card's context as well (`<name>, <owned
      // by>, in <folder>, last touched <when>`). Requiring the name it shows to
      // *lead* its accessible name is the property that matters — WCAG 2.5.3,
      // label in name — and the count below still demands exactly one.
      const repoName = (await card.locator("h3").innerText()).trim();
      const title = card.getByRole("button", {
        name: new RegExp(`^${escapeRegExp(repoName)}\\b`),
      });
      await expect(title).toHaveCount(1);

      // The controls the old markup swallowed, each exposed in its own right.
      const tree = await card.ariaSnapshot();
      expect(
        tree,
        `the card's nested controls belong in the accessibility tree:\n${tree}`,
      ).toMatch(/button "(Pin|Unpin) /);
      await expect(card.getByRole("button", { name: /^(Pin|Unpin) / })).toHaveCount(
        1,
      );
      await expect(
        card.getByRole("button", { name: /^open in editor$/i }),
      ).toHaveCount(1);

      // The keyboard path: focus the title, press Enter, and the repo opens.
      await title.focus();
      await win.keyboard.press("Enter");

      await expect(
        win.getByRole("complementary", { name: /repo detail/i }),
      ).toBeVisible({ timeout: 10_000 });
      // Selection is still announced, as it was when the article carried it.
      await expect(title).toHaveAttribute("aria-pressed", "true");
    } finally {
      await close();
    }
  });

  test("a table row stays a container, and its project name is the control", async () => {
    const { app, close } = await launchApp();

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });

      // Table view, chosen the way a person chooses it — the toolbar's own
      // control — rather than by reaching into the store.
      await win.getByRole("button", { name: "Table" }).click();

      const row = win.locator("tr[data-repo-slug]").first();
      await expect(row).toBeVisible({ timeout: 15_000 });

      // The blocker itself: a row that was a fake tab stop — `tabIndex={0}` on
      // a `<tr>` — with no role to press and no name to press it with.
      expect(await row.getAttribute("tabindex")).toBeNull();
      expect(await row.getAttribute("role")).toBeNull();

      // The favourite star is still a real button, and it carries the repo's
      // name, which is how this spec learns what the row is called without
      // hard-coding a fixture:
      const star = row.getByRole("button", { name: /^(Pin|Unpin) / });
      await expect(star).toHaveCount(1);
      const repoName = (await star.getAttribute("aria-label") ?? "")
        .replace(/^(Pin|Unpin)\s+/, "")
        .trim();
      expect(repoName.length, "the star should name the repo").toBeGreaterThan(0);

      // The named, keyboard-reachable control the row now has instead: a real
      // button whose name is the project's own.
      const nameButton = row.getByRole("button", {
        name: new RegExp(`^${escapeRegExp(repoName)}$`),
      });
      await expect(nameButton).toHaveCount(1);

      // Space is the case that used to do nothing — the deleted `onKeyDown`
      // answered Enter only. A real button answers both keys, and selection
      // comes back out of it the way the row used to announce it.
      await nameButton.focus();
      await win.keyboard.press("Space");
      await expect(nameButton).toHaveAttribute("aria-pressed", "true");

      await expect(
        win.getByRole("complementary", { name: /repo detail/i }),
        "selecting by keyboard should put the repo on screen",
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await close();
    }
  });

  test("every graph node is reachable from the keyboard, and selecting one fills the inspector", async () => {
    const { app, close } = await launchApp();

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });

      // Through the bar, as a person gets there: the renderer uses memory
      // history, so a `goto` would not reach the route at all.
      await win
        .getByRole("banner")
        .getByRole("link", { name: /^Map\b/i })
        .click();
      await expect(
        win.getByRole("img", { name: /linked by/i }),
        "the map summary is how this spec knows /graph mounted",
      ).toBeVisible({ timeout: 15_000 });

      // The keyboard surface for the canvas: cytoscape paints into untitled
      // `<canvas>` elements, so these buttons are the only way in.
      const nodeList = win.locator("div.sr-only").filter({
        has: win.getByRole("heading", { name: "Repositories on the map" }),
      });
      await expect(nodeList).toHaveCount(1);

      const buttons = nodeList.getByRole("button");
      const total = await buttons.count();
      expect(total, "the map should offer every node").toBeGreaterThan(2);

      // One tab stop for the whole map rather than one per repository —
      // hundreds of tab stops is another way of being unreachable — with the
      // arrows moving between the rest.
      expect(await nodeList.locator('[tabindex="0"]').count()).toBe(1);
      expect(await nodeList.locator('[tabindex="-1"]').count()).toBe(total - 1);

      const stop = nodeList.locator('[tabindex="0"]');
      await stop.focus();
      const before = (await stop.innerText()).trim();

      await win.keyboard.press("ArrowDown");
      const landed = await win.evaluate(() =>
        (document.activeElement?.textContent ?? "").trim(),
      );
      expect(landed, "ArrowDown should move to the next node").not.toBe(before);
      expect(landed.length).toBeGreaterThan(0);

      // Moving the cursor is not the point; selecting is. The node the
      // keyboard lands on has to become the one the inspector describes —
      // which is what used to be impossible: that panel could only ever
      // describe a node the mouse had already picked.
      await win.keyboard.press("Enter");
      await expect
        .poll(() =>
          win.evaluate(() =>
            document.activeElement?.getAttribute("aria-pressed"),
          ),
        )
        .toBe("true");

      await expect(
        win.getByRole("heading", { name: landed, exact: true }).first(),
        "the inspector should describe the node the keyboard selected",
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await close();
    }
  });

  test("the Claude range selector is one tab stop that the arrows answer", async () => {
    const { app, close } = await launchApp();

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });

      // Through the bar, as a person gets there — the renderer uses memory
      // history, so a `goto` would not reach the route at all.
      await win
        .getByRole("banner")
        .getByRole("link", { name: /^Claude\b/i })
        .click();

      const group = win.getByRole("radiogroup", { name: "Date range" });
      await expect(group).toBeVisible({ timeout: 15_000 });
      await expect(group.getByRole("radio")).toHaveCount(4);

      const checked = () => group.locator('[role="radio"][aria-checked="true"]');
      const stop = () => group.locator('[role="radio"][tabindex="0"]');

      // The pattern's first half: one tab stop for the group, carried by the
      // option that is chosen. Before the fix all four were stops and none of
      // them owned the cursor.
      await expect(stop()).toHaveCount(1);
      await expect(group.locator('[role="radio"][tabindex="-1"]')).toHaveCount(3);
      await expect(stop()).toHaveAttribute("aria-checked", "true");
      await expect(checked()).toHaveText("30 days");

      // The second half: the keys a radio group is expected to answer, and the
      // choice following the cursor so the group stays one stop.
      await stop().focus();

      await win.keyboard.press("ArrowRight");
      await expect(checked()).toHaveText("90 days");
      expect(
        await win.evaluate(() => document.activeElement?.textContent?.trim()),
        "the cursor should follow the choice",
      ).toBe("90 days");
      await expect(stop()).toHaveText("90 days");

      // Wrapping at the end, and jumping with the keys that end a radio group.
      await win.keyboard.press("ArrowRight");
      await expect(checked()).toHaveText("All time");
      await win.keyboard.press("ArrowRight");
      await expect(checked()).toHaveText("7 days");
      await win.keyboard.press("End");
      await expect(checked()).toHaveText("All time");
      await win.keyboard.press("ArrowLeft");
      await expect(checked()).toHaveText("90 days");

      // And what the accessibility tree is actually told, rather than what the
      // markup asks for: a chosen radio in a named group.
      const tree = await group.ariaSnapshot();
      expect(
        tree,
        `the group should announce its chosen option:\n${tree}`,
      ).toMatch(/radio "90 days" \[checked\]/);
    } finally {
      await close();
    }
  });
});
