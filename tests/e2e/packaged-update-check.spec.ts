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
 *
 * A tag push runs the *other* half, by naming the expectation instead
 * (`ATR_PACKAGED_UPDATE_EXPECT=current`): it has just published the version the
 * app reports, so the check has to come back "you're on the latest release" —
 * and the feed it reads is seconds old, which is why that half waits for the
 * feed to catch up rather than failing on the first read.
 *
 * The last describe leaves the app's status aside and walks the whole install
 * path: the archive `latest-mac.yml` names, downloaded, hashed against the
 * digest it promises, unpacked, and handed to `codesign`. An update that hashes
 * correctly and cannot be launched is still a broken update, and that is the
 * failure nobody sees until the download has finished.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

/**
 * `current` when the caller is the release workflow on a tag push, and it means
 * the opposite of naming a bundle: the app under test is the release just
 * published, so the check must come back "you're on the latest release" rather
 * than offer anything. Empty — the default — is the local run, which decides for
 * itself and skips the branch its build cannot serve.
 */
const EXPECTED = process.env.ATR_PACKAGED_UPDATE_EXPECT ?? "";

/** The manifest the updater reads, named as the scripts name it. */
const MANIFEST_ASSET = "latest-mac.yml";

/** The request a shipped copy makes: the GitHub API, anonymously. */
const ANONYMOUS: Record<string, string> = {
  accept: "application/vnd.github+json",
  "user-agent": "alltherepos-e2e",
};

/** How long a tag push waits for `releases/latest` to catch up with the publish. */
const FEED_SETTLE_MS = 120_000;
const FEED_POLL_MS = 5_000;

function binaryIn(bundle: string): string {
  return resolve(bundle, "Contents", "MacOS", "AllTheRepos");
}

/**
 * `owner/repo` for the feed, and the anonymity assertion where it can be made.
 *
 * The bundle's own `app-update.yml` is what ships, so it is read first — but a
 * `--dir` build (`pnpm electron:pack`, which is what the local instructions run)
 * does not carry one: electron-builder writes it on the way to publishing, which
 * is why the workflow's own launch check has it and a laptop's build does not.
 * The publish block it is generated from is the fallback, and the `private:`
 * assertion is only meaningful on the generated file itself.
 */
function feedRepo(): string {
  const path = resolve(CURRENT_BUNDLE, "Contents", "Resources", "app-update.yml");
  const yaml = existsSync(path) ? readFileSync(path, "utf8") : null;

  if (yaml !== null) {
    expect(
      yaml,
      "the packaged app's app-update.yml must not carry `private:` — a private feed cannot be read anonymously",
    ).not.toMatch(/^\s*private:/m);
  }

  const source =
    yaml ?? readFileSync(resolve(REPO_ROOT, "electron-builder.yml"), "utf8");
  const owner = /^\s*owner:\s*(\S+)/m.exec(source)?.[1];
  const repo = /^\s*repo:\s*(\S+)/m.exec(source)?.[1];
  expect(
    owner && repo,
    `no owner/repo in ${path} or electron-builder.yml`,
  ).toBeTruthy();
  return `${owner}/${repo}`;
}

interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface LatestRelease {
  status: number;
  tag: string | null;
  assets: ReleaseAsset[];
}

/**
 * `releases/latest`, asked for with no credentials at all — the same request a
 * shipped copy makes, which is the property under test.
 *
 * Returns the status rather than asserting it, so a caller still waiting for a
 * publish to appear can ask again instead of failing the first read.
 */
async function fetchLatest(repo: string): Promise<LatestRelease> {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/releases/latest`,
    { headers: ANONYMOUS },
  );
  if (response.status !== 200) {
    return { status: response.status, tag: null, assets: [] };
  }
  const body = (await response.json()) as {
    tag_name?: string;
    assets?: ReleaseAsset[];
  };
  return {
    status: 200,
    tag: body.tag_name ?? null,
    assets: body.assets ?? [],
  };
}

/** The same read, with the missing release named as the failure it is. */
async function latestRelease(repo: string): Promise<LatestRelease> {
  const release = await fetchLatest(repo);
  expect(
    release.status,
    `${repo} has no readable published release (HTTP ${release.status}) — publish one before running this`,
  ).toBe(200);
  expect(release.tag, "the release has no tag_name").toBeTruthy();
  return release;
}

async function publishedVersion(repo: string): Promise<string> {
  const release = await latestRelease(repo);
  return (release.tag ?? "").replace(/^v/, "");
}

/**
 * Wait for the feed to name `version`.
 *
 * A tag push runs this seconds after it published that release, and
 * `releases/latest` is served through a cache, so reading it straight back is a
 * race the release workflow would lose once per release. Waiting turns "not yet"
 * into a wait — and into a failure only if it never arrives, which is then a
 * release nobody would be offered rather than an impatient check.
 */
async function waitForFeedToName(
  version: string,
): Promise<{ ok: boolean; note: string }> {
  const deadline = Date.now() + FEED_SETTLE_MS;
  let note = "the feed did not answer";

  for (;;) {
    try {
      const release = await fetchLatest(feedRepo());
      const tag = (release.tag ?? "").replace(/^v/, "");
      if (release.status === 200 && tag === version) {
        return { ok: true, note: `releases/latest names ${version}` };
      }
      note = `releases/latest answers HTTP ${release.status}${tag ? ` with ${tag}` : ""}`;
    } catch (error) {
      note = error instanceof Error ? error.message : String(error);
    }

    if (Date.now() >= deadline) {
      return {
        ok: false,
        note: `${note}, ${FEED_SETTLE_MS / 1000}s after the release was published — an install would still be told there is nothing newer, so this release is not the one being offered`,
      };
    }
    await new Promise((done) => setTimeout(done, FEED_POLL_MS));
  }
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

/** Every way the section answers a check, so a wait can end on any of them. */
const OUTCOMES =
  /you're on the latest release|refused the request|no releases published|no network connection|not a packaged build/i;

/**
 * Ask the app to check, and take "could not check" for an answer only after
 * asking again.
 *
 * Two very different things look the same from out here: a feed that has not
 * caught up with a release published seconds ago, and a release that is fine.
 * Neither is worth a red run, so a check that ends without a verdict is retried,
 * and the assertions after it have the last word.
 */
async function checkUntilSettled(page: Page, attempts: number): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await checkForUpdates(page);
    // Whatever it decided, the section says so in text. Waiting for a verdict at
    // all — rather than for the one this test wants — is what stops a "could not
    // check" from spending a minute here before it can be retried.
    await expect(updatesSection(page).getByText(OUTCOMES)).toBeVisible({
      timeout: 60_000,
    });

    if (await updatesSection(page).getByText(/you're on the latest release/i).count()) {
      return;
    }
    if (attempt < attempts) await new Promise((done) => setTimeout(done, 10_000));
  }
}

/**
 * The three fields this spec needs out of `latest-mac.yml`.
 *
 * Text, not the scripts' parser: that one is ESM JavaScript the Playwright
 * config does not build, and three keys are not worth a second entry point. The
 * `files:` entry is what the updater follows, so the *indented* `sha512` and
 * `size` are the ones that count — the top-level pair says the same thing and is
 * not what an install checks against.
 */
function parseManifest(text: string): {
  version: string;
  url: string;
  sha512: string;
  size: number | null;
} {
  const size = /^\s+size:\s*(\d+)/m.exec(text)?.[1];
  return {
    version: /^version:\s*(\S+)/m.exec(text)?.[1] ?? "",
    url:
      /^\s*-\s*url:\s*(\S+)/m.exec(text)?.[1] ??
      /^path:\s*(\S+)/m.exec(text)?.[1] ??
      "",
    sha512: /^\s+sha512:\s*(\S+)/m.exec(text)?.[1] ?? "",
    size: size === undefined ? null : Number(size),
  };
}

/** What electron-updater compares a download against, base64 and all. */
function sha512Base64(bytes: Buffer): string {
  return createHash("sha512").update(bytes).digest("base64");
}

/** One anonymous download of a release asset, as bytes. */
async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { accept: "application/octet-stream", "user-agent": "alltherepos-e2e" },
  });
  expect(
    response.status,
    `${url} did not download (HTTP ${response.status})`,
  ).toBe(200);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * What macOS makes of the signature on the bundle inside the archive.
 *
 * Deliberately not `spctl`: this build is ad-hoc signed and **not notarised**, so
 * Gatekeeper refuses a downloaded copy by design — that is the documented
 * right-click → Open on first launch, not rot. What is verified here is the
 * signature, which is what makes the copy run once it is out of quarantine.
 */
function codesignVerify(bundle: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync(
      "codesign",
      ["--verify", "--deep", "--strict", "--verbose=2", bundle],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, output: output.trim() };
  } catch (error) {
    const thrown = error as { stderr?: string; message?: string };
    return { ok: false, output: String(thrown.stderr ?? thrown.message ?? error).trim() };
  }
}

/** The version macOS would report for a bundle, from its own Info.plist. */
function bundleVersion(bundle: string): string {
  return execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleShortVersionString", join(bundle, "Contents", "Info.plist")],
    { encoding: "utf8" },
  ).trim();
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

    const { app, page, cleanup } = await launchPackagedApp(CURRENT_BUNDLE);

    try {
      const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());

      if (EXPECTED === "current") {
        // The release workflow's half, on a tag push: it published this version
        // moments ago, so the feed has to have caught up before the app can be
        // expected to agree with it.
        const feed = await waitForFeedToName(version);
        expect(feed.ok, feed.note).toBe(true);
        await checkUntilSettled(page, 4);
      } else {
        // The local two-step: only the build that was released serves this branch.
        const latest = await publishedVersion(feedRepo());
        test.skip(
          version !== latest,
          `the packaged build is ${version} but the feed's latest release is ${latest} — this branch needs the build that was released`,
        );

        await checkForUpdates(page);
      }

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
    test.skip(EXPECTED === "current", "the caller expects this build to be current, not behind");

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

/**
 * The other half of "would an update work": not what the app says, but what it
 * would download.
 *
 * `scripts/check-updater-feed.mjs` already hashes that archive, anonymously, on
 * its own weekly clock. This goes the step further that needs macOS — unpacking
 * it and verifying the signature — because a download that hashes correctly and
 * cannot be launched is still a broken update, and it is the failure nobody sees
 * until the hundred megabytes are already on disk.
 *
 * It needs no packaged app on disk: it is about the release the live feed offers,
 * whoever built it. That is why it is its own describe rather than a third test
 * beside the launches — and why a tag push can lean on it, since the archive it
 * downloads then is the one that run just published.
 */
test.describe("the archive the feed offers", () => {
  test.skip(!process.env.ATR_PACKAGED_UPDATE_E2E, "opt-in — run `pnpm test:packaged-update`");
  // A ~125 MB download, a hash of all of it, and an unpack.
  test.setTimeout(900_000);

  test("downloads, matches its manifest, and unpacks to a signed bundle", async () => {
    const repo = feedRepo();
    const release = await latestRelease(repo);

    const asset =
      release.assets.find((entry) => entry.name === MANIFEST_ASSET) ?? null;
    if (asset === null) {
      throw new Error(
        `${repo}'s latest release (${release.tag}) carries no ${MANIFEST_ASSET} — an update check has nothing to read`,
      );
    }

    const manifestResponse = await fetch(asset.browser_download_url, {
      headers: ANONYMOUS,
    });
    expect(
      manifestResponse.status,
      `${MANIFEST_ASSET} did not download (HTTP ${manifestResponse.status})`,
    ).toBe(200);
    const manifest = parseManifest(await manifestResponse.text());

    expect(manifest.version, `${MANIFEST_ASSET} names no version`).toBe(
      (release.tag ?? "").replace(/^v/, ""),
    );

    const archive =
      release.assets.find((entry) => entry.name === manifest.url) ?? null;
    if (archive === null) {
      throw new Error(
        `${MANIFEST_ASSET} names ${manifest.url}, which is not attached to ${release.tag} — the download would 404`,
      );
    }

    const bytes = await download(archive.browser_download_url);
    expect(
      sha512Base64(bytes),
      `the bytes of ${manifest.url} are not the ones ${MANIFEST_ASSET} promises — every install would download all of it and then refuse it`,
    ).toBe(manifest.sha512);
    if (manifest.size !== null) {
      expect(bytes.length, `${MANIFEST_ASSET} promises ${manifest.size} bytes`).toBe(
        manifest.size,
      );
    }

    const workDir = mkdtempSync(join(tmpdir(), "atr-feed-archive-"));
    try {
      const zip = join(workDir, manifest.url);
      writeFileSync(zip, bytes);
      execFileSync("unzip", ["-q", "-o", zip, "-d", join(workDir, "unpacked")], {
        stdio: "pipe",
      });

      const unpacked = readdirSync(join(workDir, "unpacked"));
      const app = unpacked.find((entry) => entry.endsWith(".app")) ?? null;
      if (app === null) {
        throw new Error(
          `${manifest.url} unpacks to ${unpacked.join(", ")}, with no .app bundle in it`,
        );
      }
      const bundle = join(workDir, "unpacked", app);

      const verified = codesignVerify(bundle);
      expect(
        verified.ok,
        `codesign refused the bundle in ${manifest.url}: ${verified.output}`,
      ).toBe(true);
      expect(
        bundleVersion(bundle),
        `the bundle inside ${manifest.url} is not the version ${MANIFEST_ASSET} promises`,
      ).toBe(manifest.version);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
