/**
 * The release workflow has two things a reader cannot see by reading it once.
 *
 * **It has to clean up after itself.** A run that dies between "assets uploaded"
 * and "notes attached" leaves its assets on a draft: invisible to
 * `releases/latest`, invisible to `GET /releases/tags/{tag}`, and reused by the
 * next run. `v0.1.1` sat in exactly that state until a person noticed the gap in
 * the version list, which is not a detection mechanism. The step that deletes it
 * must never touch a **published** release, because the verification steps
 * *after* the publish can fail too and that release is what people are
 * downloading.
 *
 * **It has to stay provable.** That cleanup is the failure path, so it runs only
 * when something has already gone wrong — which is exactly the code nothing ever
 * exercises. Its decisions therefore live in `scripts/discard-draft-release.mjs`
 * (with unit tests; see its own spec), and this workflow carries a `drill` job
 * that leaves a real draft in the releases repo and runs that script against it.
 *
 * This test asserts the wiring that makes both true: that the step is still
 * there and still gated, that the logic is genuinely in the tested script rather
 * than inlined here, that the drill exists and cannot hurt the update feed, and
 * that a manual dispatch cannot publish a release.
 *
 * Text-level on purpose: neither a YAML parser nor a shell belongs in an
 * assertion about which keys a step carries, and the repo has no YAML
 * dependency. The behaviour is asserted where the behaviour lives.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const workflow = fs.readFileSync(
  path.join(ROOT, ".github/workflows/release.yml"),
  "utf8",
);

const CLEANUP_STEP = "Discard the draft a failed run left behind";
const PUBLISH_STEP = "Attach the notes and publish the draft";
const LAUNCH_STEP = "Launch the build and check for updates against the live feed";
const DRILL_JOB = "drill";

const lines = workflow.split("\n");

/** The lines of one list item at `indent`, up to the next one at that indent. */
function blockAt(startIndex: number, indent: number): string {
  const block = [lines[startIndex]];
  for (const line of lines.slice(startIndex + 1)) {
    if (line.trim().length === 0) {
      block.push(line);
      continue;
    }
    if (line.search(/\S/) <= indent) break;
    block.push(line);
  }
  return block.join("\n");
}

/** The lines of one step, from its `- name:` to the next step or job. */
function stepBlock(name: string): string {
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  expect(start, `release.yml has no step named "${name}"`).toBeGreaterThan(-1);
  return blockAt(start, lines[start].search(/\S/));
}

/** The lines of one job, from `  <name>:` to the next job. */
function jobBlock(name: string): string {
  const start = lines.findIndex((line) => line === `  ${name}:`);
  expect(start, `release.yml has no job named "${name}"`).toBeGreaterThan(-1);
  return blockAt(start, 2);
}

/** Prose stripped, for assertions about what a file *does*. */
function commands(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

const cleanup = stepBlock(CLEANUP_STEP);
const drill = jobBlock(DRILL_JOB);
const releaseJob = jobBlock("release");
const SETTLE_STEP = "Settle the version, the tag, and whether this publishes";
const settle = stepBlock(SETTLE_STEP);

const SIGNING_STEP = "Resolve the signing identity";
const PACKAGE_STEP = "Package and upload as a draft";
const VERIFY_SIGNED_STEP = "Verify what was signed";

const signing = stepBlock(SIGNING_STEP);
const packageStep = stepBlock(PACKAGE_STEP);
const verifySigned = stepBlock(VERIFY_SIGNED_STEP);

/** Where a step sits in the release job, so ordering can be asserted. */
function stepIndex(name: string): number {
  const index = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  expect(index, `release.yml has no step named "${name}"`).toBeGreaterThan(-1);
  return index;
}

/** The `on:` block, which ends where the top-level `permissions:` begins. */
const on = workflow.slice(
  workflow.indexOf("\non:"),
  workflow.indexOf("\npermissions:"),
);

describe("the draft cleanup step", () => {
  test("exists, and runs only when the build failed or was cancelled", () => {
    expect(cleanup).toContain(`- name: ${CLEANUP_STEP}`);
    expect(cleanup).toMatch(/if:.*failure\(\)/);
    expect(cleanup).toMatch(/if:.*cancelled\(\)/);
  });

  test("carries the credential it needs to delete anything", () => {
    expect(cleanup).toContain("GH_TOKEN: ${{ secrets.RELEASES_TOKEN }}");
  });

  test("runs after the publish, so it is the last thing to clean up", () => {
    const names = [...workflow.matchAll(/^\s+- name: (.+)$/gm)].map((m) => m[1]);
    expect(names, "the publish step is gone from release.yml").toContain(
      PUBLISH_STEP,
    );
    expect(names.indexOf(CLEANUP_STEP)).toBeGreaterThan(names.indexOf(PUBLISH_STEP));
  });

  test("keeps its decisions in the tested script, not inline", () => {
    // The step is a call. If the branching were inlined here, this file would be
    // the only place it was ever exercised — and it is the failure path, so it
    // would never be exercised at all.
    expect(cleanup).toContain("run: node scripts/discard-draft-release.mjs");
    expect(cleanup).not.toContain("gh release delete");
    expect(cleanup).not.toContain("isDraft");
  });

  test("does not try to delete the source repo's tag", () => {
    // `--cleanup-tag` here would aim at the releases repo while the tag lives in
    // the source repo. The script's own spec asserts it never passes the flag,
    // and the drill's *own* scratch tags are a different matter (see below).
    expect(cleanup).not.toContain("--cleanup-tag");
  });
});

describe("the workflow can prove the cleanup on demand", () => {
  test("a plain dispatch cannot even reach the release job", () => {
    // The `rehearse` input is the only door from a dispatch into that job, and
    // what it does once inside is a rehearsal — see the block below. The weekly
    // schedule is the third way in, and it rehearses too.
    expect(workflow).toMatch(/^  workflow_dispatch:/m);
    expect(workflow).toMatch(/^      rehearse:/m);
    expect(releaseJob).toMatch(
      /if: github\.event_name == 'push' \|\| github\.event_name == 'schedule' \|\| github\.event\.inputs\.rehearse == 'true'/,
    );
  });

  test("the drill exists, and only runs when dispatched", () => {
    expect(drill).toContain(`${DRILL_JOB}:`);
    expect(drill).toMatch(/if: github\.event_name == 'workflow_dispatch'/);
  });

  test("the drill leaves a real draft and runs the same script", () => {
    expect(drill).toContain("gh release create");
    expect(drill).toContain("--draft");
    expect(drill).toContain("gh release upload");
    expect(drill).toContain("node scripts/discard-draft-release.mjs");
    // ... and then checks that it is actually gone.
    expect(drill).toMatch(/if gh release view .*DRILL_DRAFT.*; then/);
  });

  test("the drill aims the cleanup with --tag, not an env var GitHub ignores", () => {
    // The first version of this job exported `GITHUB_REF_NAME` from each step.
    // GitHub dropped it on the floor — the log printed the value while the
    // process read the real one (`main`, the branch a dispatch runs on) — so the
    // cleanup reported "no release tagged main" and the assertion above found
    // the draft still there. A flag is the only way across that boundary.
    expect(drill).toContain(
      'node scripts/discard-draft-release.mjs --tag "$DRILL_DRAFT"',
    );
    expect(drill).toContain(
      'node scripts/discard-draft-release.mjs --tag "$DRILL_PUBLISHED"',
    );
    expect(commands(drill)).not.toMatch(/GITHUB_REF_NAME:/);
  });

  test("the drill proves a published release is left alone", () => {
    expect(drill).toContain("--prerelease");
    expect(drill).toMatch(/Assert the published release was left alone/);
    expect(drill).toMatch(/if ! gh release view .*DRILL_PUBLISHED/);
  });

  test("the drill's scratch releases cannot reach the update feed", () => {
    // `releases/latest` skips pre-releases, so a drill can never become the
    // release the app offers — which matters, because the drill publishes one.
    expect(drill).toContain("--prerelease");
  });

  test("the drill deletes its scratch releases even when it fails", () => {
    const cleanupStep = commands(drill).slice(commands(drill).indexOf("if: always()"));
    expect(cleanupStep).toContain("gh release delete");
    expect(cleanupStep).toContain("--cleanup-tag");
  });

  test("the drill only --cleanup-tag's the scratch release that has a tag", () => {
    // A release created with `--draft` is stored under a placeholder tag
    // (`untagged-2da6…`), so aiming `--cleanup-tag` at the scratch name asks
    // GitHub to delete a ref that was never created and comes back 422 — which
    // is how the drill's first dispatch failed, *after* the cleanup it was
    // proving had already passed.
    const cleanupStep = commands(drill).slice(commands(drill).indexOf("if: always()"));
    const draftBranch = cleanupStep.slice(0, cleanupStep.indexOf("--cleanup-tag"));
    expect(draftBranch).toContain("isDraft");
    expect(draftBranch).toContain('gh release delete "$tag" --repo "$RELEASES_REPO" --yes');
    // The pre-release does own a tag, so that one still cleans it up.
    expect(cleanupStep).toContain("--yes --cleanup-tag");
  });

  test("the drill's scratch tags are namespaced so nothing else can match them", () => {
    expect(drill).toMatch(/DRILL_DRAFT: drill-draft-\$\{\{ github\.run_id \}\}/);
    expect(drill).toMatch(
      /DRILL_PUBLISHED: drill-published-\$\{\{ github\.run_id \}\}/,
    );
  });
});

describe("rehearsing a release without publishing one", () => {
  const publish = stepBlock(PUBLISH_STEP);

  test("runs on a weekly clock, so a break is found before the next tag is", () => {
    // A pipeline is otherwise only exercised by releasing, which is the one time
    // a failure costs a version that is already tagged and pushed.
    expect(on).toMatch(/- cron: "0 14 \* \* 1"/);
    expect(releaseJob).toMatch(/github\.event_name == 'schedule'/);
  });

  test("only a tag push can publish, whatever else may trigger this", () => {
    // The fail-safe direction, and the whole reason a schedule here is safe:
    // inside this job "rehearse" means only "not a push", and `--draft=false` is
    // reachable exclusively from the push branch of the step that sets it. A
    // trigger added to this workflow later rehearses by accident rather than
    // publishing by accident.
    expect(releaseJob).toContain("REHEARSE: ${{ github.event_name != 'push' }}");
  });

  test("a scheduled rehearsal cleans up after itself like a dispatched one", () => {
    // The schedule is a rehearsal that started on a clock, so everything keyed to
    // being a rehearsal has to key on that rather than on the event name — or a
    // weekly run would leave a scratch release behind every Monday.
    const rehearsalCleanup = stepBlock(
      "Delete the scratch release a rehearsal created",
    );
    expect(rehearsalCleanup).toMatch(/REHEARSE/);
    expect(rehearsalCleanup).not.toContain("workflow_dispatch");
  });

  test("the draft flag is the one thing that decides whether anything shows", () => {
    // One flag, set in one place, one value per branch: `true` for a rehearsal,
    // `false` for a tag push. Nothing else about the two runs differs.
    const [rehearsal, push] = settle.split("\n          else\n");

    expect(rehearsal).toContain("DRAFT=true");
    expect(rehearsal).not.toContain("DRAFT=false");
    expect(push).toContain("DRAFT=false");
    expect(push).not.toContain("DRAFT=true");

    expect(publish).toContain('--draft="$DRAFT"');
    expect(publish).not.toContain("--draft=false");
  });

  test("a rehearsal's version is one no install would ever be offered", () => {
    // `0.0.0`: valid semver, below every `0.1.x` this project has released and
    // below every version there could ever be an install of. Even the runaway
    // case — a scratch release somehow escaping into `releases/latest` — could
    // not be offered to an install as an update.
    expect(releaseJob).toMatch(/SCRATCH_VERSION: 0\.0\.0$/m);
  });

  test("... and it is not a pre-release, which the updater reads as a channel", () => {
    // The version lost its `-rehearse.<run id>` suffix for this reason, and it is
    // not cosmetic. `electron-updater` reads a build whose own version carries a
    // pre-release tag as being on *that* pre-release's channel, so
    // `0.0.0-rehearse.7` goes looking for releases tagged for `rehearse`, finds
    // none, and reports "No published versions on GitHub" — and the launch check
    // below would be asserting an error instead of the feed.
    expect(releaseJob).not.toMatch(/SCRATCH_VERSION: 0\.0\.0-/);
  });

  test("is the same pipeline, not a copy of it", () => {
    // A rehearsal that ran its own steps could drift from the ones that ship,
    // which is the thing it exists to prevent. It runs this job, and this job
    // names the version and the tag in one place.
    const afterSettle = releaseJob.slice(
      releaseJob.indexOf(settle) + settle.length,
    );

    expect(afterSettle).not.toContain("GITHUB_REF_NAME");
    expect(afterSettle).not.toContain("require('./package.json').version");
    // Stamping the build is what aims the upload at a scratch channel instead
    // of at the tag a real release would be using.
    expect(releaseJob).toContain('-c.extraMetadata.version="$BUILD_VERSION"');
  });

  test("verifies its own draft, and never the release that is live", () => {
    expect(stepBlock("Verify the draft has all three assets")).toContain(
      'release:verify --allow-draft --tag "$TAG" --version "$BUILD_VERSION"',
    );
    // `releases/latest` still points at the previous release, so asserting on it
    // during a rehearsal would be asserting on somebody else's work.
    expect(stepBlock("Verify the published release")).toMatch(/if:.*REHEARSE/);
  });

  test("launches the build it just made, and makes it read the live feed", () => {
    // Every other step verifies the upload. This is the only one that runs the
    // app a person installs, and it is the updater's whole path: a real bundle,
    // an anonymous feed read, a version comparison, the UI that reports it.
    const launch = commands(stepBlock(LAUNCH_STEP));

    expect(launch).toContain("pnpm test:packaged-update");
    // ... the check a developer runs by hand, told what to expect rather than
    // given a second copy of the assertion.
    expect(launch).toContain(
      'ATR_PACKAGED_UPDATE_BEHIND_BUNDLE="release/mac-arm64/AllTheRepos.app"',
    );
    expect(launch).toContain('ATR_PACKAGED_UPDATE_EXPECT="current"');
  });

  test("expects the opposite answer on each of the two ways in", () => {
    // A rehearsal's build is stamped below every release, so the check it can
    // assert is that an update is offered. A tag push has just published the
    // version it built, so the check it can assert is that the app is on the
    // latest release. Sending the wrong one is a red run about nothing.
    const launch = commands(stepBlock(LAUNCH_STEP));
    const [rehearsal, push] = launch.split("else");

    expect(rehearsal).toMatch(/if \[ "\$REHEARSE" = "true" \]/);
    expect(rehearsal).toContain("ATR_PACKAGED_UPDATE_BEHIND_BUNDLE");
    expect(rehearsal).not.toContain("ATR_PACKAGED_UPDATE_EXPECT");

    expect(push).toContain('ATR_PACKAGED_UPDATE_EXPECT="current"');
    expect(push).not.toContain("ATR_PACKAGED_UPDATE_BEHIND_BUNDLE");
  });

  test("launches a bundle that exists, and a release that is already live", () => {
    // The launch needs a packaged app on disk, which the packaging step above is
    // what puts there; and the push half asserts on `releases/latest`, which the
    // publish step is what makes this run's tag — so it has to come after both.
    const names = [...workflow.matchAll(/^\s+- name: (.+)$/gm)].map((m) => m[1]);
    expect(names.indexOf(LAUNCH_STEP)).toBeGreaterThan(
      names.indexOf("Package and upload as a draft"),
    );
    expect(names.indexOf(LAUNCH_STEP)).toBeGreaterThan(names.indexOf(PUBLISH_STEP));
  });

  test("takes its scratch release away whether it passed or failed", () => {
    const rehearsalCleanup = stepBlock(
      "Delete the scratch release a rehearsal created",
    );

    expect(rehearsalCleanup).toMatch(/if:.*always\(\)/);
    expect(rehearsalCleanup).toMatch(/REHEARSE/);
    expect(rehearsalCleanup).toContain("gh release delete");
    // The draft lesson again: a release the drill creates with `--draft` has no
    // tag of its own, and `--cleanup-tag` on one answers 422.
    expect(commands(rehearsalCleanup)).not.toContain("--cleanup-tag");
  });
});

describe("where the update feed check lives", () => {
  test("not here any more — it has a workflow that can also run on a clock", () => {
    // `release.yml` is tag-push and dispatch, so a schedule here would wake the
    // whole release workflow weekly to fire one job. The check, and the
    // reasoning for every assertion that used to be in this file, moved to
    // `tests/unit/workflows/updater-feed.spec.ts` with it.
    expect(workflow).not.toMatch(/^  feed:/m);
    expect(workflow).not.toContain("check-updater-feed");
    expect(workflow).toContain(".github/workflows/updater-feed.yml");
  });
});

/**
 * Signing is a promise a release makes about itself.
 *
 * Without a certificate the build is ad-hoc signed and the DMG is the way to
 * install it. With one, the release says "notarised" in its notes, offers the
 * app an installer that updates itself, and Gatekeeper has to agree. The two
 * are different products, so the workflow has to decide *before* it builds,
 * and it must not be able to land in between: a `CSC_LINK` that fails to
 * import has to stop the run, not quietly produce an ad-hoc build that every
 * later step still describes as signed.
 */
describe("signing and notarising a release", () => {
  test("decides what signs the build before it builds anything", () => {
     expect(stepIndex(SIGNING_STEP)).toBeLessThan(stepIndex(PACKAGE_STEP));
    expect(stepIndex(SIGNING_STEP)).toBeGreaterThan(
      stepIndex("Rebuild natives for Electron and bundle the app"),
    );
  });

  test("stops the run when CSC_LINK cannot be imported", () => {
    const body = commands(signing);
    // `set -euo pipefail` rather than the runner's implicit `-e`: every later
    // claim depends on a failure here stopping the job.
     expect(body).toContain("set -euo pipefail");
    expect(body).toContain("::error::CSC_LINK could not be imported");
    // The import is what must not be walked past.
    expect(body).toMatch(/if ! security import[\s\S]*?exit 1/);
  });

  test("refuses to sign with anything but a Developer ID certificate", () => {
    const body = commands(signing);
    // `--require` makes the resolver exit non-zero instead of printing `-`,
    // and the `if !` is what turns that into a failed step.
    expect(body).toContain("signing-identity.mjs --keychain");
    expect(body).toContain("--require");
    expect(body).toContain("holds no Developer ID Application identity");
    // Signing with a certificate that cannot be notarised is the failure this
    // whole step exists to prevent.
    expect(body).toMatch(/if ! IDENTITY=[\s\S]*?exit 1/);
  });

  test("keeps the certificate-less path, and says what it costs", () => {
    const body = commands(signing);
    expect(body).toContain("::warning::");
    expect(body).toContain("SIGNING=ad-hoc");
    expect(body).toContain("IDENTITY=-");
    expect(body).toContain("ATR_NOTARIZE=skip");
    // The warning has to name the consequence, not just the missing secret — and
    // it names it without carrying a second copy of it. The sentence is rendered
    // from `scripts/first-launch.mjs`, the same source as the file inside the DMG
    // and the release-note paragraph below; the consequence itself is asserted in
    // that script's own spec, so this asserts the wiring rather than the wording.
    expect(body).toContain("node scripts/first-launch.mjs --print warning");
    expect(signing).not.toMatch(/cannot install its own updates/);
  });

  test("requires notarisation exactly on the path that claims to be signed", () => {
    const bodies = commands(signing);
    expect(bodies).toContain("SIGNING=developer-id");
    expect(bodies).toContain("ATR_NOTARIZE=require");
    // Both values are written, and only ever by the branch that earned it.
    expect(signing.indexOf("SIGNING=developer-id")).toBeLessThan(
      signing.indexOf("ATR_NOTARIZE=require"),
    );
    expect(signing.indexOf("ATR_NOTARIZE=skip")).toBeLessThan(
      signing.indexOf("SIGNING=developer-id"),
    );
  });

  test("packages with the identity it resolved, not the ad-hoc fallback", () => {
    expect(commands(packageStep)).toContain('-c.mac.identity="$IDENTITY"');
    // The publish flag, so this is still the step that uploads the draft.
    expect(commands(packageStep)).toContain("--publish always");
  });

  test("hands the notarisation hook a credential it can actually use", () => {
    const body = commands(packageStep);
    expect(body).toContain("ATR_NOTARIZE: ${{ env.ATR_NOTARIZE }}");
    for (const name of [
      "APPLE_API_KEY",
      "APPLE_API_KEY_ID",
      "APPLE_API_ISSUER",
      "APPLE_ID",
      "APPLE_APP_SPECIFIC_PASSWORD",
      "APPLE_TEAM_ID",
    ]) {
      // Built by concatenation: `${{ … }}` inside a template literal is an
      // interpolation, not the GitHub expression that has to appear here.
      const wired = `${name}: ` + "${" + `{ secrets.${name} }}`;
      expect(body, `the package step never passes ${name}`).toContain(wired);
    }
    // Presence is not enough — they have to arrive in the step's environment,
    // which is where electron-builder's afterSign hook reads them.
    expect(body).toContain("CSC_KEYCHAIN: ${{ env.CSC_KEYCHAIN }}");
  });

  test("verifies the bundle it just built, after building it", () => {
    expect(stepIndex(VERIFY_SIGNED_STEP)).toBeGreaterThan(stepIndex(PACKAGE_STEP));
    // ...and before the release becomes visible, so a failure leaves a draft.
    expect(stepIndex(VERIFY_SIGNED_STEP)).toBeLessThan(stepIndex(PUBLISH_STEP));
  });

  test("checks the signature and the ticket, not just that codesign exited 0", () => {
    const body = commands(verifySigned);
    expect(body).toContain("codesign --verify --deep --strict");
    expect(body).toContain("Developer ID Application:");
    expect(body).toContain("::error::");
    // The ticket is what Gatekeeper actually reads: a signature Apple would
    // accept and no staple is the state that fails on a stranger's machine.
    expect(body).toContain("xcrun stapler validate");
    expect(body).toContain("spctl --assess");
    // The Developer-ID assertions only apply to the run that resolved one.
    expect(body).toMatch(/if \[ "\$SIGNING" != "developer-id" \]/);
  });

  test("cannot describe a signature the build does not have", () => {
    const notes = stepBlock(PUBLISH_STEP);
    expect(notes).toMatch(/if \[ "\$SIGNING" = "developer-id" \]/);
    // "checks only" survives, but only inside the branch that is true for an
    // ad-hoc build — never as an unconditional sentence in the notes.
    const bodies = commands(notes).split("if [ \"$SIGNING\" = \"developer-id\" ]");
    expect(bodies.length, "the notes do not branch on SIGNING").toBeGreaterThan(1);
    expect(bodies[0]).not.toContain("checks only");
  });

  test("renders the ad-hoc instructions instead of writing its own copy", () => {
    const notes = stepBlock(PUBLISH_STEP);

    // The paragraph a person reads before they download anything comes from the
    // same source as the file inside the DMG and the warning above. Written out
    // here is precisely how the three came to disagree once already: the mirror
    // inside the DMG said right-click → Open, and so did this step, for several
    // releases, after Apple had removed that override in macOS 15.
    expect(notes).toContain("node scripts/first-launch.mjs --print release-note");
    expect(commands(notes)).not.toContain("right-click");
    // ... and no second copy of the procedure either, which is what a hand-written
    // paragraph here would inevitably grow back.
    expect(commands(notes)).not.toContain("Open Anyway");
  });
});

/**
 * The DMG is the artifact a person installs, and for a long time it was the one
 * thing the pipeline never opened.
 *
 * `release:verify` reads the three assets back from GitHub and "Verify what was
 * signed" runs `codesign` against the bundle on the runner, so both halves of
 * the upload were covered — and neither of them looks *inside* the disk image.
 * `dmg.contents` replaces electron-builder's defaults, so dropping the
 * `READ-ME-FIRST.txt` entry there ships a DMG missing the only instructions that
 * exist before the app can run, and nothing would say so. It was found by hand.
 */
describe("what a published DMG has to contain", () => {
  const DMG_STEP = "Verify what the DMG contains";

  test("the step exists, and names the image it is checking", () => {
    const contents = stepBlock(DMG_STEP);
    expect(commands(contents)).toContain("pnpm verify:dmg");
    expect(commands(contents)).toContain(
      "AllTheRepos-${BUILD_VERSION}-arm64.dmg",
    );
  });

  test("it runs before the release can be seen, and after the image exists", () => {
    // After packaging, because there is nothing to open until then — and before
    // the publish, so a DMG that lost its instructions fails the job while the
    // release is still a draft nobody can download.
    expect(stepIndex(DMG_STEP)).toBeGreaterThan(stepIndex(PACKAGE_STEP));
    expect(stepIndex(DMG_STEP)).toBeLessThan(stepIndex(PUBLISH_STEP));
  });

  test("it is told which version to expect, because a rehearsal builds a scratch one", () => {
    // `package.json` still carries the real version during a rehearsal, so a
    // check that read it would compare the 0.0.0 bundle against it and fail
    // every rehearsal — which is the only place this step gets exercised before
    // it matters.
    expect(commands(stepBlock(DMG_STEP))).toContain('--version "$BUILD_VERSION"');
  });

  test("the image it opens is the one `verify-dmg.mjs` would default to", () => {
    // The workflow names the path because a rehearsal builds under a scratch
    // version, so it cannot use the default — but the two have to be the same
    // file, or somebody running `pnpm verify:dmg` by hand would be checking a
    // different image than the pipeline checks.
    const contents = commands(stepBlock(DMG_STEP));
    const image = /--dmg "([^"]+)"/.exec(contents)?.[1] ?? "";

    expect(image).toBe("release/AllTheRepos-${BUILD_VERSION}-arm64.dmg");
    // ... and that shape is electron-builder's own: `dmg` is configured for
    // arm64 only, and its default artifact name is `${productName}-${version}-
    // ${arch}.dmg`, which is what the released assets are called.
    const builder = fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8");
    expect(builder).toMatch(/^\s*-\s*target: dmg$/m);
    expect(image.endsWith("-arm64.dmg")).toBe(true);
  });
});

describe("the mac build configuration", () => {
  const builder = fs.readFileSync(
    path.join(ROOT, "electron-builder.yml"),
    "utf8",
  );

  test("runs notarisation through the hook that can decline to", () => {
    // Anchored to column zero on purpose: `afterSign` is a **root** property,
    // and nesting it under `mac:` is rejected by electron-builder's own
    // validation — the whole build fails with "unknown property 'afterSign'"
    // rather than quietly skipping notarisation.
    expect(builder).toMatch(/^afterSign: scripts\/notarize\.mjs$/m);
    expect(builder).not.toMatch(/^\s+afterSign:/m);
    // Required for notarisation, and the reason a release cannot be signed
    // without it.
    expect(builder).toMatch(/^  hardenedRuntime: true$/m);
  });

  test("leaves ad-hoc as the fallback a certificate-less machine builds", () => {
    // Not a hard-coded Developer ID: the identity arrives on the command line
    // so a laptop with no certificate can run the same build command. Comments
    // are stripped first — the file *documents* the override precisely because
    // it must not apply one by itself.
    expect(builder).toMatch(/^  identity: "-"$/m);
    expect(commands(builder)).not.toMatch(/Developer ID Application:/);
  });
});
