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
 * `close()` — not `app.close()` — is what deletes the temp profile.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

export interface LaunchedApp {
  app: ElectronApplication;
  /** Close the app, then delete the temp profile it ran against. */
  close(): Promise<void>;
}

export async function launchApp(): Promise<LaunchedApp> {
  const profileDir = mkdtempSync(join(tmpdir(), "atr-e2e-profile-"));

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
