import { test, expect } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { ensureSchemaAndSeed, resetDb } from "./fixtures/seed.js";

/**
 * Catalog happy-path E2E. Requires the dev server to boot with a predictable
 * ATR_DATA_DIR. Playwright's webServer config doesn't currently inject that,
 * so we seed the default ~/.alltherepos/ DB unless ATR_DATA_DIR is set in the
 * environment.
 */

test.beforeAll(() => {
  if (!process.env.ATR_DATA_DIR) {
    const rand = crypto.randomBytes(4).toString("hex");
    process.env.ATR_DATA_DIR = path.join(os.tmpdir(), `atr-e2e-${rand}`);
  }
  resetDb();
  ensureSchemaAndSeed([
    {
      name: "example-one",
      fullPath: "/tmp/example-one",
      primaryLanguage: "TypeScript",
      description: "fixture repo one",
      tags: ["next", "react"],
    },
    {
      name: "example-two",
      fullPath: "/tmp/example-two",
      primaryLanguage: "Rust",
      description: "fixture repo two",
      tags: ["rust", "cli"],
    },
  ]);
});

test.describe("catalog", () => {
  test("homepage renders AllTheRepos heading", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /alltherepos/i }).first(),
    ).toBeVisible();
  });

  test("seeded repos appear as cards or list items", async ({ page }) => {
    await page.goto("/");
    // Accept any rendering: card, list item, or heading with the repo name.
    await expect(page.getByText("example-one")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("example-two")).toBeVisible();
  });

  test("clicking a repo navigates to detail page", async ({ page }) => {
    await page.goto("/");
    const target = page.getByText("example-one").first();
    await target.click();
    await page.waitForLoadState("networkidle");
    // Acceptance: URL changes to /repos/[slug] OR a detail panel opens.
    const url = page.url();
    const atDetail = /\/repos\//.test(url);
    const panelVisible = await page
      .getByRole("complementary")
      .first()
      .isVisible()
      .catch(() => false);
    expect(atDetail || panelVisible).toBe(true);
  });
});
