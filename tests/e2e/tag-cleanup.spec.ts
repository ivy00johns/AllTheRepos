/**
 * Tag cleanup in the real Electron app.
 *
 * The seeded fixtures already match the rules, so the test plants a real signal
 * first: a `Dockerfile` in a fixture repo. The rules then propose adding
 * `docker`, which the stored tags lack. Each test checks the outcome the user
 * sees and what a rescan does with it.
 */
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp } from "./_launch-app";

async function repoSlugs(win: Page): Promise<string[]> {
  const slugs = await win
    .locator("[data-repo-slug]")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-repo-slug") ?? ""),
    );
  return [...new Set(slugs.filter(Boolean))];
}

/** Read one repo from the catalog; fails loudly if the slug is unknown. */
async function getRepo(win: Page, slug: string) {
  const repo = await win.evaluate(
    (s) => window.atr!.catalog.get({ slug: s }),
    slug,
  );
  if (!repo) throw new Error(`repo not found (slug=${slug})`);
  return repo;
}

/** Plant a Dockerfile in a fixture repo and return the path so it can be removed. */
async function plantDockerfile(win: Page, slug: string): Promise<string> {
  const repo = await getRepo(win, slug);
  const planted = join(repo.fullPath, "Dockerfile");
  expect(existsSync(planted), "fixture already has a Dockerfile").toBe(false);
  writeFileSync(planted, "FROM node:20\n");
  return planted;
}

test("an accepted proposal is written, and survives a rescan", async () => {
  const { app, close } = await launchApp();
  let planted: string | null = null;
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await expect(win.locator("[data-repo-slug]").first()).toBeVisible({
      timeout: 20_000,
    });
    const [slug] = await repoSlugs(win);

    planted = await plantDockerfile(win, slug);
    const before = await win.evaluate(() =>
      window.atr!.catalog.tagCleanupPreview(),
    );
    const target = before.proposals.find((p) => p.slug === slug);
    expect(
      target?.added,
      "the rules propose docker for the planted repo",
    ).toContain("docker");

    await win.getByRole("button", { name: "Tag cleanup" }).click();
    const dialog = win.getByRole("dialog", { name: "Review tag changes" });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("group", { name: `Decision for ${target!.name}` })
      .getByRole("button", { name: "Accept" })
      .click();
    await dialog.getByRole("button", { name: "Apply 1 decision" }).click();
    await expect(dialog).toBeHidden();

    const written = await getRepo(win, slug);
    expect(written.tags.map((t) => t.value)).toContain("docker");

    await win.evaluate((s) => window.atr!.catalog.rescan({ slug: s }), slug);
    const rescanned = await getRepo(win, slug);
    expect(rescanned.tags.map((t) => t.value)).toContain("docker");

    const after = await win.evaluate(() =>
      window.atr!.catalog.tagCleanupPreview(),
    );
    expect(after.proposals.map((p) => p.slug)).not.toContain(slug);
  } finally {
    if (planted) rmSync(planted, { force: true });
    await close();
  }
});

test("a rejected proposal is remembered, so a rescan does not add the tag", async () => {
  const { app, close } = await launchApp();
  let planted: string | null = null;
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await expect(win.locator("[data-repo-slug]").first()).toBeVisible({
      timeout: 20_000,
    });
    const slugs = await repoSlugs(win);
    const slug = slugs[1] ?? slugs[0];

    planted = await plantDockerfile(win, slug);
    const before = await win.evaluate(() =>
      window.atr!.catalog.tagCleanupPreview(),
    );
    const target = before.proposals.find((p) => p.slug === slug);
    expect(target?.added).toContain("docker");

    await win.getByRole("button", { name: "Tag cleanup" }).click();
    const dialog = win.getByRole("dialog", { name: "Review tag changes" });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("group", { name: `Decision for ${target!.name}` })
      .getByRole("button", { name: "Keep current" })
      .click();
    await dialog.getByRole("button", { name: "Apply 1 decision" }).click();
    await expect(dialog).toBeHidden();

    await win.evaluate((s) => window.atr!.catalog.rescan({ slug: s }), slug);
    const rescanned = await getRepo(win, slug);
    expect(rescanned.tags.map((t) => t.value)).not.toContain("docker");

    const after = await win.evaluate(() =>
      window.atr!.catalog.tagCleanupPreview(),
    );
    expect(after.proposals.map((p) => p.slug)).not.toContain(slug);
  } finally {
    if (planted) rmSync(planted, { force: true });
    await close();
  }
});
