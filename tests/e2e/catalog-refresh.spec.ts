/**
 * Writes the renderer cannot see reach the grid: a scan that finishes, and a
 * scan root that is removed — once forgetting its repos, once keeping them, and
 * once where the root is a repo itself.
 *
 * All three are the same failure underneath. A scan writes straight to SQLite in
 * the main process, and removing a root edits rows there, so nothing the
 * renderer is querying changes on its own — the hooks have to invalidate the
 * right query key afterwards. Both invalidation sites named the `["catalog"]`
 * root long after every repo query had moved under `["repos"]`, so they matched
 * nothing: the scan left the count from before it, and the removal left the
 * cards it had just forgotten.
 *
 * This spec exists because that failure is silent: no error, no empty state, just
 * a stale grid, and the unit suite cannot see it (renderer hooks are not rendered
 * there). Every test drives the real main process and then reads the rendered
 * catalog, so a wrong key fails it and a right one passes.
 *
 * The parts a driver cannot click are replaced, not faked: the scan is started
 * through the bridge because the rail's "Add folder to scan" opens a native
 * folder picker, and the scan root is added the same way. What each test asserts
 * starts after that, and the removal itself goes through the rail's own menu and
 * confirmation dialog.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { expect, test } from "@playwright/test";

import { launchApp, TEMPLATE_PROFILE_ENV } from "./_launch-app";

const NEW_REPO = "scan-arrival";
const DOOMED_ROOT = "root-removal-root";
const DOOMED_REPO = "doomed-repo";
const KEPT_ROOT = "root-kept-root";
const KEPT_REPO = "kept-repo";
const OTHER_ROOT = "root-that-stays";
const SELF_REPO = "root-that-is-a-repo";
const NESTED_ROOT = "root-that-holds-projects";
const NESTED_CHILD = "child-project";
const NESTED_DEEP = "deep-project";

/**
 * The folder the template profile's own repos live in.
 *
 * A fixture created anywhere else would be outside the profile's world, and the
 * tests below need the scanner to treat it like any other repo on this machine.
 */
function templateReposDir(): string {
  const template = process.env[TEMPLATE_PROFILE_ENV];
  if (!template) {
    throw new Error(
      `${TEMPLATE_PROFILE_ENV} is unset — this spec needs the suite's template profile.`,
    );
  }
  return join(dirname(template), "repos");
}

/**
 * Make `dir` a real git repo.
 *
 * `--allow-empty` rather than a file: the scanner only needs `.git` to recognise
 * a folder as a repository, and an empty commit keeps the fixture free of the
 * "is this dirty" question the catalog also draws.
 */
function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync(
    "git",
    [
      "-c",
      "user.email=e2e@example.com",
      "-c",
      "user.name=E2E",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "seed",
    ],
    { cwd: dir },
  );
}

test("a scan that finishes fills the grid without a reload", async () => {
  const dir = join(templateReposDir(), NEW_REPO);
  initRepo(dir);
  const { app, close } = await launchApp();

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    // The catalog as the window found it. Three, not four: the new folder is on
    // disk but has never been scanned, which is the state a scan is for.
    await expect(win.locator("[data-repo-slug]")).toHaveCount(3, {
      timeout: 20_000,
    });
    await expect(win.getByText("3 repos")).toBeVisible({ timeout: 15_000 });

    const started = await win.evaluate(async (path) => {
      const result = await window.atr!.scan.start({ paths: [path] });
      return result.status;
    }, dir);
    expect(started, "scan:start refused to run").toBe("running");

    // No reload, no palette refresh, no re-navigation: the grid has to arrive at
    // the new row on the strength of the scan events alone.
    await expect(win.locator("[data-repo-slug]")).toHaveCount(4, {
      timeout: 60_000,
    });
    await expect(win.getByText("4 repos")).toBeVisible({ timeout: 30_000 });
    await expect(
      win.locator(`[data-repo-slug]`, { hasText: NEW_REPO }),
    ).toHaveCount(1);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removing a scan root forgets its repos, and the grid drops them", async () => {
  /*
   * The repo sits INSIDE the root: the ordinary layout, and the one the scan
   * walks. A root that is a repository itself is a different row shape — its
   * `full_path` IS the root path — and has its own walk below.
   */
  const root = join(templateReposDir(), DOOMED_ROOT);
  initRepo(join(root, DOOMED_REPO));
  const { app, close } = await launchApp();

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    const sidebar = win.locator("#catalog-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 20_000 });
    await expect(win.locator("[data-repo-slug]")).toHaveCount(3, {
      timeout: 20_000,
    });

    // ----- A root to remove, and a repo in it -----
    //
    // Adding a root writes settings, which the rail reads through its own query;
    // this goes through the bridge rather than the Settings form, so the window
    // reloads once here to pick it up. Everything this test is about happens
    // after that reload.
    const added = await win.evaluate(async (path) => {
      const result = await window.atr!.settings.addScanPath({ path });
      return result.added;
    }, root);
    expect(added, "the scan root was not added").toBe(true);

    await win.reload();
    await win.waitForLoadState("domcontentloaded");
    await expect(win.locator("[data-repo-slug]")).toHaveCount(3, {
      timeout: 20_000,
    });

    await win.evaluate(async (path) => {
      await window.atr!.scan.start({ paths: [path] });
    }, root);
    await expect(win.locator("[data-repo-slug]")).toHaveCount(4, {
      timeout: 60_000,
    });
    await expect(win.getByText("4 repos")).toBeVisible({ timeout: 30_000 });

    // ----- Remove it through the rail -----
    //
    // The path is the row's own label, so this also checks the root is drawn
    // where the app says it is — a removal test against the wrong row would
    // otherwise pass by removing nothing.
    const rootMenu = sidebar.getByRole("button", {
      name: `Actions for scan folder ${root}`,
    });
    await expect(rootMenu).toHaveCount(1, { timeout: 15_000 });
    await rootMenu.click();
    await win.getByRole("menuitem", { name: "Stop scanning…" }).click();

    const dialog = win.getByRole("dialog", {
      name: "Stop scanning this folder",
    });
    await expect(dialog).toBeVisible();
    // What the confirmation promises it will forget is the count this repo makes;
    // the option is checked by default, so confirming "Stop scanning" forgets it.
    await expect(
      dialog.getByText("Also forget the 1 repo found here"),
    ).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: "Stop scanning" }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // ----- The row, the card and the count are gone, with no reload -----
    await expect(win.locator("[data-repo-slug]")).toHaveCount(3, {
      timeout: 20_000,
    });
    await expect(win.getByText("3 repos")).toBeVisible({ timeout: 20_000 });
    await expect(rootMenu).toHaveCount(0);
    await expect(
      win.locator(`[data-repo-slug]`, { hasText: DOOMED_REPO }),
    ).toHaveCount(0);
  } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * The other option in the same dialog: stop scanning, keep the repos.
 *
 * This is the half that makes the confirmation a choice rather than a warning.
 * The root goes away and the cards stay, but they do not stay where they were —
 * the rail has no root to file them under any more, so they move to "Outside
 * scan folders", the row whose whole job is to say these will not be refreshed
 * by a future scan. That move is the assertion: a version that forgot them would
 * lose the cards, and a version that left them silently orphaned would leave the
 * rail claiming a root that no longer exists.
 */
test('removing a scan root with "Keep them" leaves its repos outside scan folders', async () => {
  const root = join(templateReposDir(), KEPT_ROOT);
  initRepo(join(root, KEPT_REPO));
  /*
   * A second root that survives the removal. "Outside scan folders" only exists
   * when some root remains and some repo lies outside it — with no roots at all
   * the rail falls back to one tree over the whole catalog and there is nothing
   * for the stray row to be outside of.
   */
  const otherRoot = join(templateReposDir(), OTHER_ROOT);
  mkdirSync(otherRoot, { recursive: true });
  const { app, close } = await launchApp();

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    const sidebar = win.locator("#catalog-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 20_000 });
    await expect(win.locator("[data-repo-slug]")).toHaveCount(3, {
      timeout: 20_000,
    });

    // ----- A root to remove, and a repo in it -----
    const added = await win.evaluate(async (paths) => {
      const first = await window.atr!.settings.addScanPath({ path: paths[0] });
      const second = await window.atr!.settings.addScanPath({ path: paths[1] });
      return first.added && second.added;
    }, [root, otherRoot]);
    expect(added, "a scan root was not added").toBe(true);

    await win.reload();
    await win.waitForLoadState("domcontentloaded");

    // The three seeded repos live outside both roots, which is the row this test
    // is about — it starts at three and gains the kept repo at the end.
    const strays = sidebar.getByRole("button", {
      name: /^Outside scan folders/,
    });
    await expect(strays).toHaveCount(1, { timeout: 15_000 });
    await expect(strays).toContainText("3");

    await win.evaluate(async (path) => {
      await window.atr!.scan.start({ paths: [path] });
    }, root);
    await expect(win.locator("[data-repo-slug]")).toHaveCount(4, {
      timeout: 60_000,
    });

    const rootMenu = sidebar.getByRole("button", {
      name: `Actions for scan folder ${root}`,
    });
    await expect(rootMenu).toHaveCount(1, { timeout: 15_000 });
    await rootMenu.click();
    await win.getByRole("menuitem", { name: "Stop scanning…" }).click();

    // ----- Keep the repo -----
    const dialog = win.getByRole("dialog", {
      name: "Stop scanning this folder",
    });
    await expect(dialog).toBeVisible();
    // The dialog's count describes the repo this root holds; "Keep" is the
    // second radio, so picking it is a real choice rather than the default.
    await expect(
      dialog.getByText("Also forget the 1 repo found here"),
    ).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("radio", { name: /Keep them in the catalog/ }).check();
    await dialog.getByRole("button", { name: "Stop scanning" }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // ----- The root is gone, the repo is not, and the rail says where it went -----
    await expect(rootMenu).toHaveCount(0);
    await expect(win.locator("[data-repo-slug]")).toHaveCount(4, {
      timeout: 20_000,
    });
    await expect(win.getByText("4 repos")).toBeVisible({ timeout: 20_000 });
    await expect(
      win.locator(`[data-repo-slug]`, { hasText: KEPT_REPO }),
    ).toHaveCount(1);

    // Without a root to belong to, the repo joins the strays: same grid, new
    // row, and the row's count says the move happened rather than merely that
    // the root vanished.
    await expect(strays).toContainText("4", { timeout: 20_000 });
    // The root that was left alone is still there, so the removal took exactly
    // one entry off the list.
    await expect(
      sidebar.getByRole("button", {
        name: `Actions for scan folder ${otherRoot}`,
      }),
    ).toHaveCount(1);
  } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
    rmSync(otherRoot, { recursive: true, force: true });
  }
});

/**
 * A root that is itself a repository, removed with "forget".
 *
 * Pointing the app at `~/Repos/my-project` catalogues that folder as a repo, so
 * its `full_path` is the root path exactly. Both halves of the removal used to
 * ask `full_path LIKE 'root/%'`, which never matches the root itself: the
 * confirmation said "No repos have been catalogued here" about the one repo it
 * was obviously about, and choosing to forget left its card behind under
 * Outside scan folders. A prefix comparison that size is invisible in a unit
 * test of the dialog and only shows up next to a real scan, which is why this
 * walk exists beside the service-level one.
 *
 * The same shape reaches the rail, where it is read twice more: the tree files
 * a repo whose path IS the root, and the "directly in this folder" row filters
 * with a comparison of its own. Both are asserted here before the removal,
 * because a rail that draws phantom folders or an empty row beside a repo it
 * was told about is the same bug in a quieter place.
 */
test("removing a scan root that is itself a repo forgets it", async () => {
  const root = join(templateReposDir(), SELF_REPO);
  // The root is the repo: no child folder, no nested `.git`.
  initRepo(root);
  const { app, close } = await launchApp();

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    const sidebar = win.locator("#catalog-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 20_000 });
    await expect(win.locator("[data-repo-slug]")).toHaveCount(3, {
      timeout: 20_000,
    });

    const added = await win.evaluate(async (path) => {
      const result = await window.atr!.settings.addScanPath({ path });
      return result.added;
    }, root);
    expect(added, "the scan root was not added").toBe(true);

    await win.reload();
    await win.waitForLoadState("domcontentloaded");
    await expect(win.locator("[data-repo-slug]")).toHaveCount(3, {
      timeout: 20_000,
    });

    await win.evaluate(async (path) => {
      await window.atr!.scan.start({ paths: [path] });
    }, root);
    await expect(win.locator("[data-repo-slug]")).toHaveCount(4, {
      timeout: 60_000,
    });
    const card = win.locator(`[data-repo-slug]`, { hasText: SELF_REPO });
    await expect(card).toHaveCount(1, { timeout: 20_000 });

    /*
     * The rail files it in the root itself. Its parent lies outside every
     * scan root, so a tree walk that derived the folder from the absolute path
     * would draw phantom folders under the root — one per path segment, each
     * with its own menu. One folder row, and a "directly in this folder" row
     * holding the repo, says the repo is where it belongs.
     */
    await expect(
      sidebar.getByRole("button", { name: /^Actions for scan folder/ }),
    ).toHaveCount(1, { timeout: 15_000 });
    // The rail opens the folders it was showing before the root existed, so
    // this one starts collapsed; its rows are only drawn when it is open.
    await sidebar.getByRole("button", { name: `Expand ${SELF_REPO}` }).click();
    const exactlyHere = sidebar.getByTitle(
      `Show the 1 repos directly in ${root}`,
    );
    await expect(exactlyHere).toHaveCount(1, { timeout: 15_000 });

    // Opening that row has to keep the repo the row counted: the count and the
    // filter behind it are two different path comparisons.
    await exactlyHere.click();
    await expect(win.locator("[data-repo-slug]")).toHaveCount(1, {
      timeout: 20_000,
    });
    await expect(card).toHaveCount(1);
    await exactlyHere.click();
    await expect(win.locator("[data-repo-slug]")).toHaveCount(4, {
      timeout: 20_000,
    });

    const rootMenu = sidebar.getByRole("button", {
      name: `Actions for scan folder ${root}`,
    });
    await expect(rootMenu).toHaveCount(1, { timeout: 15_000 });
    await rootMenu.click();
    await win.getByRole("menuitem", { name: "Stop scanning…" }).click();

    // The count is the fix: this repo is at the root, not beneath it, and the
    // dialog has to say so rather than offer to forget nothing.
    const dialog = win.getByRole("dialog", {
      name: "Stop scanning this folder",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Also forget the 1 repo found here"),
    ).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: "Stop scanning" }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Forgotten means gone: not on the grid, not under Outside scan folders.
    await expect(win.locator("[data-repo-slug]")).toHaveCount(3, {
      timeout: 20_000,
    });
    await expect(win.getByText("3 repos")).toBeVisible({ timeout: 20_000 });
    await expect(rootMenu).toHaveCount(0);
    await expect(card).toHaveCount(0);
  } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A scan root that is a repository indexes the projects *beneath* it too.
 *
 * The native walker stops at the first `.git` it meets: it records the
 * directory and never queues that directory's children. That is the right
 * answer for a folder of projects and the wrong one for the folder itself — so
 * pointing the app at `~/Repos` after an accidental `git init` there catalogued
 * exactly one repository, drew a green "done · 1 repos", and hid every project
 * below it (ATR-033, audit SC-1). The blob is not an error, which is why only a
 * scan of this shape can show it.
 *
 * The fixture has both depths on purpose: a project directly inside the root,
 * and one under a plain folder, because the fix is the root's expansion and a
 * fix that only looked at direct children would pass with the second missing.
 * Before it, this scan found one card; the assertion is six (three seeded plus
 * the root's own repository and both projects).
 */
test("a scan root that is itself a repo indexes the projects beneath it", async () => {
  const root = join(templateReposDir(), NESTED_ROOT);
  initRepo(root);
  initRepo(join(root, NESTED_CHILD));
  initRepo(join(root, "work", NESTED_DEEP));
  const { app, close } = await launchApp();

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    await expect(win.locator("[data-repo-slug]")).toHaveCount(3, {
      timeout: 20_000,
    });

    const started = await win.evaluate(async (path) => {
      const result = await window.atr!.scan.start({ paths: [path] });
      return result.status;
    }, root);
    expect(started, "scan:start refused to run").toBe("running");

    // Six: the three seeded repos, the root's own repository, and both
    // projects — the scan that used to find one finds all three of its own.
    await expect(win.locator("[data-repo-slug]")).toHaveCount(6, {
      timeout: 60_000,
    });
    await expect(win.getByText("6 repos")).toBeVisible({ timeout: 30_000 });

    // By path, not by card text: every card under this root draws the root's
    // name in its folder label, so a text match cannot tell the three apart.
    const paths = await win.evaluate(async () => {
      const result = await window.atr!.catalog.list({ limit: 200 });
      return result.items.map((item) => item.fullPath);
    });
    for (const name of [NESTED_ROOT, NESTED_CHILD, NESTED_DEEP]) {
      expect(
        paths.some((repoPath) => repoPath.endsWith(`/${name}`)),
        `${name} is missing from the catalog`,
      ).toBe(true);
    }
  } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
});
