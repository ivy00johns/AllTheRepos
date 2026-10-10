/**
 * Launch the built app for an Electron E2E spec — against a private profile.
 *
 * Electron keys its single-instance lock on the userData directory. Launching
 * with the default one means the app finds the developer's own running copy
 * holding the lock, takes the `if (!gotSingleInstanceLock) app.quit()` branch
 * and exits 0 *before opening a window*. Playwright surfaces that only as
 * "Target page, context or browser has been closed", which reads like a crash
 * and sends you looking in the wrong place entirely — the app is fine, it just
 * refused to start twice.
 *
 * A fresh `--user-data-dir` per launch removes the collision, and has two
 * further benefits worth having: the suite no longer reads the developer's
 * real catalog (a passing test stops depending on whether they happen to have
 * scanned lately) and no longer writes to their settings and repos tables.
 * `curate-link-flow.spec.ts` has launched this way from the start.
 *
 * A private profile starts empty, though, and half the specs want a repo card
 * to click. `_global-setup.ts` therefore seeds one template profile per suite
 * and advertises it through {@link TEMPLATE_PROFILE_ENV}; every launch copies
 * the database out of it, so a spec starts with a small synthetic catalog
 * without paying for a migrate-and-seed boot of its own.
 *
 * `close()` — not `app.close()` — is what deletes the temp profile, and it is
 * also what makes teardown deterministic: it bounds the wait for the app to
 * quit and kills whatever is still standing afterwards, because
 * `app.close()` alone can wait forever on a window that will not close. See
 * {@link CLOSE_GRACE_MS}.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

/**
 * Set by `_global-setup.ts` to the seeded template profile. Lives here rather
 * than in the config because the directory does not exist until global setup
 * has built it.
 */
export const TEMPLATE_PROFILE_ENV = "ATR_E2E_TEMPLATE_PROFILE";

/**
 * What the template carries and a launch is willing to inherit. The `-wal` and
 * `-shm` sidecars come along when the boot that created the template left them
 * behind; `settings.json` keeps the copy from re-running the one-shot legacy
 * settings promotion.
 */
const INHERITED_PROFILE_FILES = [
  "alltherepos.db",
  "alltherepos.db-wal",
  "alltherepos.db-shm",
  "settings.json",
];

/** The one file whose presence means this profile has already been initialised. */
const PROFILE_DATABASE = "alltherepos.db";

let warnedAboutMissingTemplate = false;

/**
 * Copy the seeded catalog into a fresh profile. Returns true when anything was
 * copied — a launch with no template still works, it just starts empty.
 *
 * "Fresh" means the profile holds no database yet, not "this helper created the
 * directory". A spec that launches twice on one `profileDir` wants the second
 * launch to inherit what the first left — a database with the app's own writes
 * in it, and the window's remembered route beside it — so re-copying the
 * template over it would erase exactly the state under test. Gating on the
 * database rather than on who made the directory also keeps a developer's
 * hand-made profile from being silently overwritten.
 */
function inheritSeededProfile(profileDir: string): boolean {
  if (existsSync(join(profileDir, PROFILE_DATABASE))) {
    return false;
  }
  const template = process.env[TEMPLATE_PROFILE_ENV];
  if (!template) {
    if (!warnedAboutMissingTemplate) {
      warnedAboutMissingTemplate = true;
      console.warn(
        `[e2e] ${TEMPLATE_PROFILE_ENV} is unset — launching with an empty catalog. ` +
          "Run through Playwright (which runs _global-setup.ts) to get the seeded one.",
      );
    }
    return false;
  }

  let copied = false;
  for (const name of INHERITED_PROFILE_FILES) {
    const from = join(template, name);
    if (!existsSync(from)) continue;
    copyFileSync(from, join(profileDir, name));
    copied = true;
  }
  return copied;
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

/**
 * How long `app.close()` may take before the app is killed outright.
 *
 * `ElectronApplication.close()` is not bounded, and what it waits on is the
 * process exiting: Playwright asks the app to quit and then awaits that exit
 * with no timeout. An app that will not quit — a `before-quit` handler holding
 * a confirmation open, a window that never acknowledges — leaves that await
 * pending, and there is no path out of it. Measured while hammering the suite:
 * one stuck app spent the test's whole 60s budget, and then the worker spent a
 * second 60s failing to close it, reported as `Test timeout of 60000ms
 * exceeded` followed by `Worker teardown timeout of 60000ms exceeded` — two
 * timeouts, and no window named in either.
 *
 * The number is a compromise: longer than a well-behaved app takes to quit
 * (tens of milliseconds across this suite) and short enough that a stuck one
 * costs seconds rather than minutes.
 */
const CLOSE_GRACE_MS = 5_000;

/** How long a process that was just killed gets to actually disappear. */
const DEATH_GRACE_MS = 5_000;

/**
 * The pids this worker has launched and not yet seen die.
 *
 * A spec's `finally` is the normal way out, but it is not the only path: an
 * exception thrown before the `try` block, or a worker Playwright tears down
 * mid-test, skips it entirely and leaves the window open with nobody left to
 * close it. `close()` removes its own entry, and process exit reaps whatever
 * is left.
 */
const openAppPids = new Set<number>();

function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** Whether a pid still exists. Signal 0 asks without delivering anything. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and is not ours to signal.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Children of every process, from one snapshot of the table.
 *
 * Electron's window, GPU and utility processes are children of the app's main
 * process, so killing the main one on its own leaves the rest to notice their
 * parent is gone — which is how a run stopped mid-test ends up leaving a
 * handful of Electron processes behind. Windows has no `ps`; there the app is
 * killed by itself, which is what that platform's process model expects.
 */
function childrenByParent(): Map<number, number[]> {
  const children = new Map<number, number[]>();
  if (process.platform === "win32") return children;

  const table = execFileSync("ps", ["-Ao", "pid=,ppid="], { encoding: "utf8" });
  for (const line of table.split("\n")) {
    const [pidText, parentText] = line.trim().split(/\s+/);
    const pid = Number(pidText);
    const parent = Number(parentText);
    if (!Number.isInteger(pid) || !Number.isInteger(parent)) continue;
    const siblings = children.get(parent);
    if (siblings) siblings.push(pid);
    else children.set(parent, [pid]);
  }
  return children;
}

/**
 * SIGKILL a process and everything below it.
 *
 * Deepest first, so a child cannot be re-parented out of reach in between.
 * SIGKILL cannot be caught, blocked or deferred, which is the point: by the
 * time this runs, the app has already declined a polite request.
 */
function killProcessTree(rootPid: number): void {
  const children = childrenByParent();
  const pending = [rootPid];
  const seen = new Set<number>();
  const tree: number[] = [];

  while (pending.length > 0) {
    const pid = pending.pop() as number;
    if (seen.has(pid)) continue;
    seen.add(pid);
    tree.push(pid);
    for (const child of children.get(pid) ?? []) pending.push(child);
  }

  for (const pid of tree.reverse()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, or a pid that was never ours.
    }
  }
}

/**
 * Kill anything still open on the way out, synchronously.
 *
 * Registered on `exit` only, and deliberately not on `SIGTERM`/`SIGINT`:
 * listening for those suppresses Node's default termination for them, and
 * Playwright installs its own handling for exactly that case. Everything used
 * here is synchronous — `ps` and `kill` both are — so it can run from an exit
 * handler.
 */
process.once("exit", () => {
  for (const pid of openAppPids) killProcessTree(pid);
  openAppPids.clear();
});

/** Wait for a killed process to disappear, so the caller is not racing it. */
async function waitForDeath(pid: number): Promise<void> {
  const deadline = Date.now() + DEATH_GRACE_MS;
  while (isAlive(pid) && Date.now() < deadline) await delay(25);
}

/**
 * Close an app within a bound, and leave nothing of it running.
 *
 * On return the process is either gone — the graceful path resolves when
 * Playwright sees it exit — or was killed and confirmed dead. A caller can
 * therefore read "`close()` returned" as "no window from this launch is still
 * on the machine".
 */
async function closeApp(
  app: ElectronApplication,
  profileDir: string,
  options: { removeProfile: boolean },
): Promise<void> {
  const pid = app.process().pid;

  try {
    const closed = app.close().then(
      () => true,
      () => false,
    );
    const graceful = await Promise.race([
      closed,
      delay(CLOSE_GRACE_MS).then(() => false),
    ]);

    if (!graceful && pid !== undefined) {
      killProcessTree(pid);
      await waitForDeath(pid);
    }
  } finally {
    if (pid !== undefined) openAppPids.delete(pid);
    if (options.removeProfile) {
      rmSync(profileDir, { recursive: true, force: true });
    }
  }
}

export interface LaunchedApp {
  app: ElectronApplication;
  /** Close the app, then delete the temp profile it ran against. */
  close(): Promise<void>;
}

export interface LaunchOptions {
  /**
   * Run against this profile instead of a fresh one.
   *
   * For a spec that launches twice and needs the second launch to read what the
   * first one wrote — main remembers the window's route in the profile, so "does
   * the app come back where it was" is only answerable across two starts of the
   * same directory. A reused directory is never re-seeded from the template: the
   * first launch's database is the one under test, and copying the template over
   * it is exactly the state the second launch is supposed to inherit.
   */
  profileDir?: string;
  /**
   * Leave the profile on disk when the app closes. The spec that named the
   * directory removes it; nothing else does.
   */
  keepProfile?: boolean;
  /**
   * Extra environment for this one app process.
   *
   * Per launch rather than by assigning to `process.env`, which would leak the
   * setting into every later spec in the same worker. The specs that need this
   * are the ones driving a branch a normal launch cannot reach — `ATR_FORCE_PACKAGED`
   * (main's documented override, see `src/main/build-info.ts`) is the first, and it
   * has to apply to a single launch or the whole suite would run as a release.
   */
  env?: Record<string, string>;
}

export async function launchApp(
  options: LaunchOptions = {},
): Promise<LaunchedApp> {
  const ownsProfile = options.profileDir === undefined;
  const profileDir =
    options.profileDir ?? mkdtempSync(join(tmpdir(), "atr-e2e-profile-"));
  inheritSeededProfile(profileDir);

  let app: ElectronApplication;
  try {
    app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${profileDir}`],
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
        ...options.env,
      },
    });
  } catch (error) {
    // A launch that never produced an app should not leave *its own* profile
    // behind. One it was handed belongs to whoever asked for it.
    if (ownsProfile) rmSync(profileDir, { recursive: true, force: true });
    throw error;
  }

  const pid = app.process().pid;
  if (pid !== undefined) openAppPids.add(pid);

  return {
    app,
    async close(): Promise<void> {
      await closeApp(app, profileDir, {
        removeProfile: ownsProfile && options.keepProfile !== true,
      });
    },
  };
}
