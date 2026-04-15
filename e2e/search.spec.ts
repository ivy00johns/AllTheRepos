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
      name: "react-hub",
      fullPath: "/tmp/react-hub",
      primaryLanguage: "TypeScript",
      description: "react hub fixture",
    },
    {
      name: "rust-cli",
      fullPath: "/tmp/rust-cli",
      primaryLanguage: "Rust",
      description: "rust fixture",
    },
  ]);
});

test.describe("search keyboard UX", () => {
  test("/ focuses search input", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("/");
    // Any focusable search control — role=searchbox or input[type=search]
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return {
        tag: el?.tagName.toLowerCase() ?? "",
        role: el?.getAttribute("role") ?? "",
        type: (el as HTMLInputElement | null)?.type ?? "",
        placeholder:
          (el as HTMLInputElement | null)?.placeholder?.toLowerCase() ?? "",
      };
    });
    const looksLikeSearch =
      focused.role === "searchbox" ||
      focused.type === "search" ||
      /search/.test(focused.placeholder) ||
      focused.tag === "input";
    expect(looksLikeSearch).toBe(true);
  });

  test("typing a query filters the visible cards within 2s", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.press("/");
    await page.keyboard.type("react", { delay: 20 });
    await expect(page.getByText("react-hub")).toBeVisible({ timeout: 2000 });
    // rust-cli should be filtered out (best-effort — tolerant if hidden vs removed)
    const rustVisible = await page
      .getByText("rust-cli")
      .isVisible()
      .catch(() => false);
    expect(rustVisible).toBe(false);
  });

  test("Escape clears search and restores full list", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("/");
    await page.keyboard.type("react");
    await page.keyboard.press("Escape");
    await expect(page.getByText("react-hub")).toBeVisible();
    await expect(page.getByText("rust-cli")).toBeVisible();
  });
});
