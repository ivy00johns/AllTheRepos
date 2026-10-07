/**
 * Playwright Electron E2E global setup.
 *
 * Three concerns the Electron specs share at boot:
 *
 *  1. The native `.node` binaries (better-sqlite3, find-git-repositories)
 *     must match Electron's ABI (NODE_MODULE_VERSION 135 for Electron 36;
 *     `pnpm test` rebuilds them for host Node instead — 127 on Node 22, and
 *     Electron reports the mismatch as ERR_DLOPEN_FAILED), which leaves the
 *     tree in the wrong state for an Electron launch.
 *  2. `out/main/index.js` (and friends) must exist.
 *  3. Each spec needs a catalog with repos in it (see below).
 *
 * This setup runs `pnpm electron:rebuild` (force `electron-rebuild -f`)
 * and `pnpm electron:build` once per suite, so the user can run
 * `pnpm exec playwright test --config playwright.electron.config.ts`
 * directly without remembering the dance.
 *
 * ## The seeded template profile
 *
 * `_launch-app.ts` gives every launch its own `--user-data-dir`, which is what
 * stops the suite colliding with a copy of the app the developer already has
 * open — and also means every launch starts from an empty catalog. Specs that
 * want to click a repo card then fall through to their empty-state branches,
 * so the interesting half of `launcher-flow` and `claude-flow` never ran.
 *
 * So the suite builds one profile here, seeds it, and hands the path to the
 * specs through {@link TEMPLATE_PROFILE_ENV}; each launch copies the database
 * out of it. Doing this once per suite rather than once per spec matters: the
 * migrate-then-seed-then-boot dance costs an extra app boot, and repeating it
 * in ten specs would double the run.
 *
 * The profile is deliberately cut off from the developer's real data first
 * (`MIGRATED` + `__legacyPromoted`, see {@link buildTemplateProfile}), so the
 * three demo repos are the whole catalog — the same on a laptop and on a
 * fresh CI runner.
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { _electron as electron } from "@playwright/test";

import { TEMPLATE_PROFILE_ENV } from "./_launch-app";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");
const SEED_SCRIPT = resolve(REPO_ROOT, "tests", "e2e", "_seed-catalog.mjs");

// The electron package's index.js exports the path to its binary — the same
// runtime the app boots, borrowed as plain Node for the seeder.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronBinary = require("electron") as string;

/**
 * Repos the template profile carries. Deliberately, obviously synthetic: if
 * one of these ever shows up in a screenshot or a failure artifact, nobody has
 * to wonder whose library it was.
 */
const SEEDED_REPOS = ["Demo Web", "Demo CLI", "Demo Library"] as const;

function run(cmd: string, args: string[]): void {
  // eslint-disable-next-line no-console
  console.log(`[e2e setup] > ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: REPO_ROOT,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `[e2e setup] ${cmd} ${args.join(" ")} exited ${result.status ?? "null"}`,
    );
  }
}

/**
 * Give a seeded repo just enough Claude Code presence that the Claude tab
 * renders its populated state — the four section headings and the launch
 * button — instead of the empty state.
 *
 * Every seeded repo gets this, not just one: the specs click
 * `data-repo-slug`'s `.first()`, which is whichever repo the catalog's
 * default sort puts on top, so seeding one of three would make the state the
 * spec asserts depend on the sort.
 */
function seedClaudeArtifacts(dir: string): void {
  const skillDir = join(dir, ".claude", "skills", "demo-skill");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(dir, "CLAUDE.md"),
    "# Demo Web\n\nSeeded by the Electron E2E suite.\n",
  );
  writeFileSync(
    join(skillDir, "SKILL.md"),
    "---\nname: demo-skill\ndescription: Seeded by the Electron E2E suite.\n---\n\n# Demo skill\n",
  );
}

/** A real git repo, so the catalog's branch and dirty reads have an answer. */
function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync(
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

/**
 * Migrate an empty database into a throwaway profile, seed repos into it, and
 * return the directory. The caller deletes the whole temp root afterwards.
 */
async function buildTemplateProfile(): Promise<{
  profileDir: string;
  root: string;
}> {
  // Canonicalise the temp root before anything is seeded into it. macOS
  // hands out `/var/folders/...` while the kernel reports `/private/var/...`
  // — and the process panel matches a listener's cwd (always canonical, the
  // kernel resolves it) against the catalog's stored path. Seeding the
  // unresolved form would make every seeded repo unmatchable, which is a
  // fixture artifact: a developer's own repos sit under canonical paths.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atr-e2e-template-")));
  const profileDir = join(root, "profile");
  const libraryDir = join(root, "repos");
  mkdirSync(profileDir, { recursive: true });

  const repos = SEEDED_REPOS.map((name) => {
    const dir = join(libraryDir, name.toLowerCase().replace(/\s+/g, "-"));
    initRepo(dir);
    seedClaudeArtifacts(dir);
    return { name, dir };
  });

  // 0. Claim both one-shot legacy imports before the app ever boots here.
  //    Without the `MIGRATED` sentinel a fresh profile copies the developer's
  //    real `~/.alltherepos/` database in, so the "seeded" catalog would be
  //    their whole library plus three demo rows — and the suite would depend
  //    on whose machine it ran on, which is the thing a private profile was
  //    meant to end. `__legacyPromoted` is the settings half of the same
  //    trap: the app would otherwise treat settings.json as un-migrated,
  //    overwrite it from the SQLite settings row, and scan the paths those
  //    defaults imply. `scripts/make-readme-shots.mjs` claims both for the
  //    same reason.
  writeFileSync(join(profileDir, "MIGRATED"), new Date().toISOString());
  writeFileSync(
    join(profileDir, "settings.json"),
    `${JSON.stringify({ scanPaths: [], __legacyPromoted: true }, null, 2)}\n`,
  );

  // 1. Boot once so the app migrates an empty database into the profile —
  //    schema, FTS triggers and all. The seeder fills an existing DB, it does
  //    not create one, because the app owns that DDL.
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profileDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
  } finally {
    await app.close();
  }

  // 2. Seed the rows. `ELECTRON_RUN_AS_NODE` borrows the app's own runtime
  //    because the natives are built for Electron's ABI, which the Playwright
  //    worker (host Node) cannot load.
  const seeded = spawnSync(
    electronBinary,
    [
      SEED_SCRIPT,
      join(profileDir, "alltherepos.db"),
      ...repos.flatMap((repo) => [repo.name, repo.dir]),
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
    },
  );
  if (seeded.status !== 0) {
    throw new Error(
      `[e2e setup] seeding the template profile failed (exit ${seeded.status ?? "null"})\n${seeded.stdout ?? ""}${seeded.stderr ?? ""}`,
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `[e2e setup] template profile seeded with ${repos.length} repos — every launch copies it`,
  );

  return { profileDir, root };
}

export default async function globalSetup(): Promise<(() => void) | undefined> {
  run("pnpm", ["electron:rebuild"]);
  // Build is fast; always run to pick up source edits since last run.
  run("pnpm", ["electron:build"]);

  const { profileDir, root } = await buildTemplateProfile();
  process.env[TEMPLATE_PROFILE_ENV] = profileDir;

  return () => {
    rmSync(root, { recursive: true, force: true });
  };
}
