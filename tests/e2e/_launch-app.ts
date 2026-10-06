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
 * `close()` — not `app.close()` — is what deletes the temp profile.
 */

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

let warnedAboutMissingTemplate = false;

/**
 * Copy the seeded catalog into a fresh profile. Returns true when anything was
 * copied — a launch with no template still works, it just starts empty.
 */
function inheritSeededProfile(profileDir: string): boolean {
  const template = process.env[TEMPLATE_PROFILE_ENV];
  if (!template) {
    if (!warnedAboutMissingTemplate) {
      warnedAboutMissingTemplate = true;
      // eslint-disable-next-line no-console
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

export interface LaunchedApp {
  app: ElectronApplication;
  /** Close the app, then delete the temp profile it ran against. */
  close(): Promise<void>;
}

export async function launchApp(): Promise<LaunchedApp> {
  const profileDir = mkdtempSync(join(tmpdir(), "atr-e2e-profile-"));
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
      },
    });
  } catch (error) {
    // A launch that never produced an app should not leave its profile behind.
    rmSync(profileDir, { recursive: true, force: true });
    throw error;
  }

  return {
    app,
    async close(): Promise<void> {
      try {
        await app.close();
      } finally {
        rmSync(profileDir, { recursive: true, force: true });
      }
    },
  };
}
