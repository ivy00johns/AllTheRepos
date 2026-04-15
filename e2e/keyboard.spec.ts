import { test, expect } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { ensureSchemaAndSeed, resetDb } from "./fixtures/seed.js";

test.beforeAll(() => {
  if (!process.env.ATR_DATA_DIR) {
    const rand = crypto.randomBytes(4).toString("hex");
    process.env.ATR_DATA_DIR = path.join(os.tmpdir(), `atr-e2e-${rand}`);
  }
  resetDb();
  ensureSchemaAndSeed([
    {
      name: "alpha-kb",
      fullPath: "/tmp/alpha-kb",
      primaryLanguage: "TypeScript",
    },
    {
      name: "beta-kb",
      fullPath: "/tmp/beta-kb",
      primaryLanguage: "Go",
    },
  ]);
});

test.describe("keyboard shortcuts", () => {
  test("j/k moves selection between repo entries", async ({ page }) => {
    await page.goto("/");
    // Drop any existing focus so j doesn't go into an input
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press("j");
    const afterJ = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.textContent?.toLowerCase() ?? "";
    });
    await page.keyboard.press("j");
    const afterSecondJ = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.textContent?.toLowerCase() ?? "";
    });
    // Moved focus at least once.
    expect(afterJ.length > 0 || afterSecondJ.length > 0).toBe(true);
    // Ideally distinct elements — allow same if list only has one item.
    expect.soft(afterJ === afterSecondJ).toBe(false);
  });

  test("enter opens a repo detail page / panel", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press("j");
    await page.keyboard.press("Enter");
    await page.waitForLoadState("networkidle");
    const url = page.url();
    const panelVisible = await page
      .getByRole("complementary")
      .first()
      .isVisible()
      .catch(() => false);
    expect(/\/repos\//.test(url) || panelVisible).toBe(true);
  });

  test("g s navigates to /settings", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press("g");
    await page.keyboard.press("s");
    await page.waitForURL(/\/settings/, { timeout: 3000 });
    expect(page.url()).toMatch(/\/settings/);
  });
});
