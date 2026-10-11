/**
 * Actual Electron clicks, preload, IPC, catalog lookup and remote parsing.
 * Only the final OS shell calls are intercepted: this proves dispatch, not
 * that Finder/the browser/editor visually opened. Clipboard is real and restored.
 */
import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { launchApp } from "./_launch-app";

test("launcher clicks dispatch real repo paths and normalized remotes through Electron", async () => {
  const { app, close } = await launchApp();
  let priorClipboard: string | undefined;
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    const card = win.locator("[data-repo-slug]").first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    const slug = await card.getAttribute("data-repo-slug");
    expect(slug).toBeTruthy();
    const repo = await win.evaluate(async (target) => {
      const result = await window.atr!.catalog.get({ slug: target! });
      if (!result) throw new Error("seeded repo missing");
      return result;
    }, slug);

    const remote = spawnSync("git", ["remote", "add", "origin", "git@github.com:atr-e2e/launcher-fixture.git"], { cwd: repo.fullPath, encoding: "utf8" });
    expect(remote.status, remote.stderr).toBe(0);

    priorClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
    await app.evaluate(({ shell }) => {
      const state = globalThis as unknown as { __launcherCalls: Array<{ kind: string; value: string }> };
      state.__launcherCalls = [];
      shell.showItemInFolder = (value) => { state.__launcherCalls.push({ kind: "finder", value }); };
      shell.openExternal = async (value) => { state.__launcherCalls.push({ kind: "external", value }); };
    });
    const calls = () => app.evaluate(() => (globalThis as unknown as { __launcherCalls: Array<{ kind: string; value: string }> }).__launcherCalls);

    for (const name of ["Open in editor", "Open in terminal", "Reveal in Finder", "Open remote (origin)", "Copy path"]) {
      await expect(card.getByRole("button", { name, exact: true })).toBeAttached();
    }
    await card.hover();
    await card.getByRole("button", { name: "Reveal in Finder", exact: true }).click();
    await expect.poll(calls).toContainEqual({ kind: "finder", value: repo.fullPath });
    await card.getByRole("button", { name: "Open remote (origin)", exact: true }).click();
    await expect.poll(calls).toContainEqual({ kind: "external", value: "https://github.com/atr-e2e/launcher-fixture" });
    await card.getByRole("button", { name: "Copy path", exact: true }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(repo.fullPath);
    console.log("[launcher-flow] Finder and GitHub dispatch verified (OS shell intercepted); clipboard round trip real.");
  } finally {
    if (priorClipboard !== undefined) {
      await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), priorClipboard);
    }
    await close();
  }
});

test("launcher failures remain visible on inline catalog cards", async () => {
  const { app, close } = await launchApp();
  try {
    const win = await app.firstWindow();
    const card = win.locator("[data-repo-slug]").first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("launcher:openInFinder");
      ipcMain.handle("launcher:openInFinder", () => ({ ok: false, reason: "test launcher refused" }));
    });
    await card.hover();
    await card.getByRole("button", { name: "Reveal in Finder", exact: true }).click();
    await expect(card.getByRole("status")).toContainText("test launcher refused");
  } finally {
    await close();
  }
});
