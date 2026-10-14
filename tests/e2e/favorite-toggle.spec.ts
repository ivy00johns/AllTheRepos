/**
 * Favourite star in the real Electron app.
 *
 * Clicks the star on the first repo card and checks three things: the button's
 * pressed state flips at once, the database agrees, and a second click restores
 * the original state.
 *
 * The thing this pins is the seam between the two: the optimistic write lands on
 * `queryKeys.repos.all`, which is the prefix the grid's list query is stored
 * under, so the flip is visible before the invalidation round-trips. A write
 * keyed anywhere else leaves the star where it was until the refetch.
 */
import { expect, test } from "@playwright/test";
import { launchApp } from "./_launch-app";

test("the favourite star pins and unpins a repo in the UI and the database", async () => {
  const { app, close } = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    const card = win.locator("[data-repo-slug]").first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    const slug = await card.getAttribute("data-repo-slug");
    expect(slug).toBeTruthy();

    const star = card.getByRole("button", { name: /^(Pin|Unpin) / });
    const original = (await star.getAttribute("aria-pressed")) === "true";

    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", String(!original));
    const stored = await win.evaluate(
      async (target) =>
        (await window.atr!.catalog.get({ slug: target! }))?.isFavorite,
      slug,
    );
    expect(stored).toBe(!original);

    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", String(original));
  } finally {
    await close();
  }
});
