/**
 * The packaged app's update check — the one path the rest of the suite cannot
 * reach (ATR-048).
 *
 * `updaterService.check()` returns early when `!app.isPackaged` ("Update checks
 * only run in a packaged build — you're running from source"), and every other
 * Electron spec launches `out/main/index.js` from source. So the feed — the
 * whole point of publishing to a public repo — had never been exercised by
 * anything automated. This spec launches the real bundle instead.
 *
 * **Opt-in, on purpose**, because it needs things an ordinary run does not
 * have, and a red suite on a machine without them would be a lie:
 *
 *   1. a packaged build — `pnpm electron:pack`
 *   2. a published release — `releases/latest` has to answer
 *   3. the network — this really does call the GitHub API
 *
 *     pnpm test:packaged-update
 *
 * The two branches are decided by a version comparison the app does against the
 * feed, and that comparison cannot be faked from outside: `electron-updater`
 * reads `app.getVersion()` **once**, in `AppUpdater`'s constructor
 * (`this.currentVersion` has exactly one assignment, via
 * `ElectronAppAdapter.version`), which runs when the main process imports the
 * updater. By the time a test can reach into the running process it is too late
 * — a spoofed version is simply never read. So each branch is served by the
 * build that genuinely has that version:
 *
 *   - **up to date** — the current bundle (`pnpm electron:pack`), whose version
 *     is the published one. Skipped with a reason if the feed has moved on.
 *   - **available** — a second bundle built one version behind with
 *     `pnpm electron:pack-older`, which passes `-c.extraMetadata.version` so
 *     `app.getVersion()` really reports `0.0.1`. Skipped with a reason if that
 *     build has not been made.
 *
 * The feed address is read from the bundle's own `app-update.yml` rather than
 * written down a fourth time, so this spec cannot drift from what ships.
 *
 * The release rehearsal runs this spec too, against the build it just made, and
 * names that bundle with `ATR_PACKAGED_UPDATE_BEHIND_BUNDLE`: a rehearsal's
 * version is a scratch one below every release, so that build is genuinely
 * behind the live feed and serves the branch below. A bundle named that way has
 * to exist, and has to be behind the feed — the caller asked for this branch by
 * name, so a skip there would report success without having asserted anything.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";

const REPO_ROOT = resolve(__dirname, "..", "..");
const CURRENT_BUNDLE = resolve(REPO_ROOT, "release", "mac-arm64", "AllTheRepos.app");
const OLDER_BUNDLE = resolve(REPO_ROOT, "release", "older", "mac-arm64", "AllTheRepos.app");

/**
 * A bundle to serve the "behind the feed" branch, instead of the local
 * `pnpm electron:pack-older` one — the release rehearsal points this at the
 * build it just made, which is exactly the build whose update check should be
 * exercised. `null` means nobody named one.
 */
const NAMED_BEHIND_BUNDLE = process.env.ATR_PACKAGED_UPDATE_BEHIND_BUNDLE
  ? resolve(REPO_ROOT, process.env.ATR_PACKAGED_UPDATE_BEHIND_BUNDLE)
  : null;
const BEHIND_BUNDLE = NAMED_BEHIND_BUNDLE ?? OLDER_BUNDLE;

function binaryIn(bundle: string): string {
  return resolve(bundle, "Contents", "MacOS", "AllTheRepos");
}

/**
 * `owner/repo` from the current bundle's `app-update.yml`, plus the anonymity
 * assertion. Read from *that* bundle, not the one under test: the file is
 * written by the publishing build, and a `--dir` build (`pnpm
 * electron:pack-older`) carries none, so pointing this at the bundle under test
 * would break the local flow for a file that says the same thing either way.
 */
function feedRepo(): string {
  const path = resolve(CURRENT_BUNDLE, "Contents", "Resources", "app-update.yml");
  const yaml = readFileSync(path, "utf8");
  expect(
    yaml,
    "the packaged app's app-update.yml must not carry `private:` — a private feed cannot be read anonymously",
  ).not.toMatch(/^\s*private:/m);

  const owner = /^\s*owner:\s*(\S+)/m.exec(yaml)?.[1];
  const repo = /^\s*repo:\s*(\S+)/m.exec(yaml)?.[1];
  expect(owner && repo, `no owner/repo in ${path}`).toBeTruthy();
  return `${owner}/${repo}`;
}

/**
 * `releases/latest`, asked for with no credentials at all — the same request a
 * shipped copy makes, which is the property under test.
 */
async function publishedVersion(repo: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "alltherepos-e2e",
    },
  });
  expect(
    response.status,
    `${repo} has no readable published release (HTTP ${response.status}) — publish one before running this`,
  ).toBe(200);

  const body = (await response.json()) as { tag_name?: string };
  expect(body.tag_name, "the release has no tag_name").toBeTruthy();
  return (body.tag_name ?? "").replace(/^v/, "");
}

/** The numeric triple, and whether a pre-release tag follows it. */
function parseVersion(version: string): {
  numbers: readonly [number, number, number];
  prerelease: boolean;
} {
  const [core, ...suffix] = version.split("-");
  const numbers = core.split("+")[0].split(".").map(Number);
  return {
    numbers: [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0],
    prerelease: suffix.length > 0,
  };
}

/**
 * Plain semver "is a before b" — enough for x.y.z and a pre-release of it, and
 * no new dependency. The pre-release half is not decoration: a scratch build is
 * `0.0.0-rehearse.7`, which is below `0.1.6` and used to be reported as ahead of
 * it by a comparison that read `0-rehearse` as `NaN`.
 */
function isOlder(a: string, b: string): boolean {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < 3; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) {
      return left.numbers[index] < right.numbers[index];
    }
  }
  // Equal triples: a pre-release sorts below the release it belongs to, and
  // build metadata (`0.0.0+rehearse`) changes nothing at all.
  return left.prerelease && !right.prerelease;
}

/** Launch a packaged bundle, isolated, with no credentials in its environment. */
async function launchPackagedApp(bundle: string): Promise<{
  app: ElectronApplication;
  page: Page;
  cleanup: () => void;
}> {
  const profile = mkdtempSync(resolve(tmpdir(), "atr-packaged-update-"));

  // The ambient environment minus anything that could authenticate the
  // request: with no token anywhere, a 200 from the feed is only possible
  // because it is public. (Playwright wants every value to be a string, so
  // undefined entries are dropped rather than passed through.)
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.NODE_ENV = "test";
  for (const key of ["GH_TOKEN", "GITHUB_TOKEN", "RELEASES_TOKEN"]) {
    delete env[key];
  }

  const app = await electron.launch({
    executablePath: binaryIn(bundle),
    args: [`--user-data-dir=${profile}`],
    cwd: REPO_ROOT,
    env,
    timeout: 180_000,
  });
  const page = await app.firstWindow({ timeout: 180_000 });

  // Settings is the only place the check can be triggered from; the router uses
  // memory history, so there is no URL to navigate to.
  await page.getByRole("banner").getByRole("link", { name: /^settings$/i }).click();
  await page.getByRole("heading", { name: /^settings$/i }).waitFor({ timeout: 120_000 });

  return {
    app,
    page,
    cleanup: () => {
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

function updatesSection(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^updates$/i }) });
}

async function checkForUpdates(page: Page): Promise<void> {
  await updatesSection(page).getByRole("button", { name: /check for updates/i }).click();
}

test.describe("the packaged app's update check", () => {
  test.skip(!process.env.ATR_PACKAGED_UPDATE_E2E, "opt-in — run `pnpm test:packaged-update`");
  test.skip(
    !existsSync(binaryIn(CURRENT_BUNDLE)),
    `no packaged app at ${CURRENT_BUNDLE} — build one with \`pnpm electron:pack\``,
  );
  // A packaged launch boots every service before the window exists (ATR-055),
  // and the feed round-trip is a real network call.
  test.setTimeout(300_000);

  test("reaches the public feed anonymously and reports up to date", async () => {
    test.skip(
      NAMED_BEHIND_BUNDLE !== null,
      "a bundle was named for the other branch — this run is about that one",
    );

    const latest = await publishedVersion(feedRepo());
    const { app, page, cleanup } = await launchPackagedApp(CURRENT_BUNDLE);

    try {
      const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
      test.skip(
        version !== latest,
        `the packaged build is ${version} but the feed's latest release is ${latest} — this branch needs the build that was released`,
      );

      await checkForUpdates(page);

      // This string renders only for the `current` state, which is reached only
      // by fetching the feed, parsing the manifest and finding it equal. A 404
      // renders "No releases published yet." and an unpackaged build "Update
      // checks only run in a packaged build" — so this one assertion covers the
      // feed, the network and the packaging.
      await expect(
        updatesSection(page).getByText(/you're on the latest release/i),
      ).toBeVisible({ timeout: 120_000 });
      await expect(
        updatesSection(page).getByText(/no releases published|refused the request|not a packaged build/i),
      ).toHaveCount(0);
    } finally {
      await app.close();
      cleanup();
    }
  });

  test("offers the published release when the build is behind it", async () => {
    if (NAMED_BEHIND_BUNDLE === null) {
      test.skip(
        !existsSync(binaryIn(BEHIND_BUNDLE)),
        `no older build at ${BEHIND_BUNDLE} — make one with \`pnpm electron:pack-older\``,
      );
    } else {
      // Named by the caller, so a missing bundle is a failure and not a skip:
      // this branch was asked for by name, and skipping it would report success
      // without having asserted anything.
      expect(
        existsSync(binaryIn(BEHIND_BUNDLE)),
        `no packaged app at ${BEHIND_BUNDLE} — a bundle was named for this branch`,
      ).toBe(true);
    }

    const latest = await publishedVersion(feedRepo());
    const { app, page, cleanup } = await launchPackagedApp(BEHIND_BUNDLE);

    try {
      const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
      expect(
        isOlder(version, latest),
        `the build under test reports ${version}, which is not behind the feed's ${latest} — a build below the release is the point of this branch`,
      ).toBe(true);

      await checkForUpdates(page);

      // Both affordances the status drives: the panel's button, and the top
      // bar's chip (matched by title, which does not hide at narrow widths).
      await expect(
        updatesSection(page).getByRole("button", { name: new RegExp(`^Get ${latest}$`) }),
      ).toBeVisible({ timeout: 120_000 });
      await expect(
        page.getByTitle(new RegExp(`^Version ${latest} is available`)),
      ).toBeVisible();
    } finally {
      await app.close();
      cleanup();
    }
  });
});
