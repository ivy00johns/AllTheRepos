/**
 * The two doors into the scan list, and the one write behind them.
 *
 * Adding a folder is `settings:addScanPath`: it resolves the path, checks it is
 * a folder, refuses a duplicate or a folder an existing root already covers, and
 * starts a scan of what it accepted. The Settings box used to append whatever
 * was typed straight to `settings:update` — a wholesale array write with no
 * rules behind it — so a relative path became a root that can never hold
 * anything: the rail drew the row, `countUnder` said 0, and no scan would ever
 * fill it. It calls the same channel as the rail now.
 *
 * Both doors are driven here, because a rule that holds at one and not the
 * other is the bug this spec is about. The box is typed into — it is the entry a
 * person uses most, and the only one reachable with keystrokes. The rail's `Add
 * folder to scan` opens a native folder picker, which a driver cannot operate, so
 * its answer is supplied from the main process: the same `dialog.showOpenDialog`
 * the picker handler calls, replaced for that launch with one that returns the
 * fixture. The rail's button is then clicked for real and its refusal is read
 * from the notice strip it draws.
 *
 * The added folders hold real repos, so what each walk claims is measured rather
 * than inferred. Adding a path scans it, which puts its repo on the grid; removing
 * the path from the Settings screen keeps the repo — the rail's own menu is where
 * the forget-or-keep question lives — so the card has to survive and move to
 * `Outside scan folders`, the row whose whole job is to say no future scan will
 * refresh it. A second root stays behind, because that row only exists when some
 * root remains and some repo lies outside it; with no roots at all the rail shows
 * one tree over the whole catalog and there is nothing for the repo to move out
 * of.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { expect, test } from "@playwright/test";

import { launchApp, TEMPLATE_PROFILE_ENV } from "./_launch-app";

const ADDED_ROOT = "settings-added-root";
const KEPT_REPO = "repo-inside-the-added-root";
const OTHER_ROOT = "settings-root-that-stays";
const RAIL_ROOT = "rail-added-root";
const RAIL_REPO = "repo-inside-the-rail-root";

/**
 * The folder the template profile's own repos live in.
 *
 * A fixture created anywhere else would be outside the profile's world; the
 * template's `settings.json` starts with no scan paths at all, so a folder here
 * is a root the app has to accept rather than one it already covers.
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
 * `--allow-empty` rather than a file: `.git` is all the scanner needs, and an
 * empty commit keeps the fixture free of the "is this dirty" question the
 * catalog also draws.
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

test("the Settings box refuses a relative path, adds a folder, and keeps what it found", async () => {
  const dir = join(templateReposDir(), ADDED_ROOT);
  initRepo(join(dir, KEPT_REPO));
  const otherDir = join(templateReposDir(), OTHER_ROOT);
  mkdirSync(otherDir, { recursive: true });
  const { app, close } = await launchApp();

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await expect(win.getByRole("link", { name: /^AllTheRepos$/i })).toBeVisible(
      { timeout: 20_000 },
    );

    await win
      .getByRole("banner")
      .getByRole("link", { name: /^Settings\b/i })
      .click();

    const field = win.getByLabel("New scan path");
    await expect(field).toBeVisible({ timeout: 20_000 });
    const roots = win.getByRole("button", { name: /^Remove scan path / });
    // The shell rail lists roots too, so a path assertion has to name the
    // Settings block it belongs to rather than matching both surfaces.
    const scanBlock = win
      .getByRole("heading", { name: "Scan paths" })
      .locator("xpath=ancestor::section[1]");
    // The template profile ships with none, so every count below is the count
    // this test made.
    await expect(roots).toHaveCount(0);

    // ----- A relative path -----
    //
    // The desktop resolves it against the app's own folder, finds nothing
    // there, and refuses. Stored verbatim it would be a root no repo can be
    // under, which is exactly what the box used to do.
    await field.fill("repos");
    await win.getByRole("button", { name: "Add folder", exact: true }).click();
    await expect(win.getByRole("alert")).toContainText("doesn't exist", {
      timeout: 15_000,
    });
    await expect(roots, "a refused path must not reach the list").toHaveCount(
      0,
    );
    // The text stays put so it can be corrected rather than retyped.
    await expect(field).toHaveValue("repos");

    // ----- Two real folders -----
    //
    // The first holds a repo, so adding it has to find that repo. The second is
    // empty and stays behind, since "Outside scan folders" needs a root to be
    // outside of.
    for (const path of [dir, otherDir]) {
      await field.fill(path);
      await win
        .getByRole("button", { name: "Add folder", exact: true })
        .click();
      await expect(scanBlock.getByText(path, { exact: true })).toBeVisible({
        timeout: 20_000,
      });
    }
    await expect(roots, "both accepted paths have to be listed").toHaveCount(2);
    await expect(win.getByRole("alert")).toHaveCount(0);
    await expect(field).toHaveValue("");

    // ----- And they are roots the rail knows about -----
    //
    // The two doors share one write now, so the entries have to arrive in the
    // rail without a reload — a root listed here and missing there would mean
    // the box still had a path of its own into settings.
    await win
      .getByRole("banner")
      .getByRole("link", { name: /^AllTheRepos$/i })
      .click();
    const sidebar = win.locator("#catalog-sidebar");
    const addedRow = sidebar.getByRole("button", {
      name: `Actions for scan folder ${dir}`,
    });
    const otherRow = sidebar.getByRole("button", {
      name: `Actions for scan folder ${otherDir}`,
    });
    await expect(addedRow).toHaveCount(1, { timeout: 20_000 });
    await expect(otherRow).toHaveCount(1);

    // The add scanned the folder it accepted: four cards, the fourth being the
    // repo that lives inside it. Three repos sit outside every root here, which
    // is the number the stray row has to gain one by the end.
    await expect(win.locator("[data-repo-slug]")).toHaveCount(4, {
      timeout: 60_000,
    });
    await expect(
      win.locator("[data-repo-slug]", { hasText: KEPT_REPO }),
    ).toHaveCount(1);
    const strays = sidebar.getByRole("button", {
      name: /^Outside scan folders/,
    });
    await expect(strays).toContainText("3");

    // ----- Removing the path from the same screen -----
    //
    // This button drops the path and keeps whatever was found there, which is
    // why the rail's menu asks the forget-or-keep question and this one does
    // not. So the root goes, the card stays, and the repo relocates.
    await win
      .getByRole("banner")
      .getByRole("link", { name: /^Settings\b/i })
      .click();
    const remove = win.getByRole("button", { name: `Remove scan path ${dir}` });
    await expect(remove).toBeVisible({ timeout: 20_000 });
    await remove.click();

    await expect(
      roots,
      "the removed path has to leave the list, and the other one stay",
    ).toHaveCount(1, { timeout: 20_000 });
    await expect(scanBlock.getByText(dir, { exact: true })).toHaveCount(0);
    await expect(scanBlock.getByText(otherDir, { exact: true })).toBeVisible();

    // ----- The rail loses the root and keeps the repo -----
    await win
      .getByRole("banner")
      .getByRole("link", { name: /^AllTheRepos$/i })
      .click();
    await expect(addedRow).toHaveCount(0, { timeout: 20_000 });
    await expect(otherRow).toHaveCount(1);
    await expect(
      win.locator("[data-repo-slug]"),
      "removing a path keeps the repos it found",
    ).toHaveCount(4, { timeout: 20_000 });
    await expect(
      win.locator("[data-repo-slug]", { hasText: KEPT_REPO }),
    ).toHaveCount(1);
    // The card did not merely survive: it moved to the row that says no future
    // scan will refresh it, which is what "kept, not scanned" looks like.
    await expect(strays).toContainText("4", { timeout: 20_000 });
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(otherDir, { recursive: true, force: true });
  }
});

/**
 * The rail's own door: the button in the sidebar, through a stubbed picker.
 *
 * Everything after the picker is the real flow — the handler resolves the
 * folder, refuses it if it is already a root, writes the array and starts a
 * scan — so this is the only place a click on `Add folder to scan` is exercised
 * end to end. The refusal matters as much as the add: the rail draws it as a
 * notice strip rather than a dialog, and a second row for a folder already being
 * scanned is exactly what the duplicate rule exists to prevent.
 */
test("the rail's Add folder to scan adds and scans the picked folder", async () => {
  const dir = join(templateReposDir(), RAIL_ROOT);
  initRepo(join(dir, RAIL_REPO));
  const { app, close } = await launchApp();

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await expect(win.getByRole("link", { name: /^AllTheRepos$/i })).toBeVisible(
      { timeout: 20_000 },
    );

    // A native sheet cannot be operated by a driver, so the answer comes from
    // the main process. This is the `dialog.showOpenDialog` the handler calls —
    // the bundled IPC module and this patch hold the same object — so the click
    // below runs the real resolve/validate/write/scan path from here on.
    await app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [picked],
      })) as unknown as typeof dialog.showOpenDialog;
    }, dir);

    const sidebar = win.locator("#catalog-sidebar");
    const add = sidebar.getByRole("button", { name: "Add folder to scan" });
    await expect(add).toBeVisible({ timeout: 20_000 });
    await expect(win.locator("[data-repo-slug]")).toHaveCount(3, {
      timeout: 20_000,
    });

    await add.click();
    const rootRow = sidebar.getByRole("button", {
      name: `Actions for scan folder ${dir}`,
    });
    await expect(rootRow).toHaveCount(1, { timeout: 20_000 });

    // One click is add-and-scan, so the repo inside the folder has to reach the
    // grid without anything else being touched.
    await expect(win.locator("[data-repo-slug]")).toHaveCount(4, {
      timeout: 60_000,
    });
    await expect(
      win.locator("[data-repo-slug]", { hasText: RAIL_REPO }),
    ).toHaveCount(1);

    // Picking the same folder again is refused by the rules the box shares, and
    // the rail says why rather than drawing a second row for one folder.
    await add.click();
    await expect(
      win.getByText("That folder is already being scanned."),
    ).toBeVisible({ timeout: 20_000 });
    await expect(rootRow).toHaveCount(1);
    await expect(win.locator("[data-repo-slug]")).toHaveCount(4);

    // And the box lists what the rail added, with no reload: one list, two
    // doors, so a root the rail accepts cannot be missing from Settings.
    await win
      .getByRole("banner")
      .getByRole("link", { name: /^Settings\b/i })
      .click();
    await expect(
      win.getByRole("button", { name: `Remove scan path ${dir}` }),
    ).toHaveCount(1, { timeout: 20_000 });
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});
