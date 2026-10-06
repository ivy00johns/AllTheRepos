/**
 * Update checking.
 *
 * ## Why this checks but does not install
 *
 * macOS applies updates through Squirrel.Mac, which refuses to install
 * anything that isn't validly code-signed. This app currently ships
 * unsigned (there's no Apple Developer certificate on the build machine),
 * so a silent auto-update would fail at the last step — after downloading
 * a hundred megabytes — with an error the user can do nothing about.
 *
 * Pretending otherwise would be worse than not offering it. So the
 * updater does the half that genuinely works: it asks GitHub whether a
 * newer release exists and tells you, with a link. Downloading and
 * installing stay manual.
 *
 * Everything needed for real auto-update is already in place —
 * `electron-updater`, the feed, the version comparison. When a signing
 * certificate exists, flipping `autoDownload` on and calling
 * `quitAndInstall` is the whole change; see `docs/RELEASING.md`.
 *
 * ## Private repositories
 *
 * The release feed lives on a private repo, so reading it needs a token.
 * Rather than embedding one in the shipped app — which would hand every
 * user a credential — the token is resolved at runtime from the
 * environment or the `gh` CLI already authenticated on this machine.
 * With no token the updater reports `unavailable` and explains why,
 * instead of failing with an opaque 404.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { app } from "electron";
import electronUpdater from "electron-updater";

import type { UpdateStatus } from "@shared/types";

import { openExternalAllowlisted } from "@main/security/allowlist";

const execFileAsync = promisify(execFile);

/** `electron-updater` is CJS; this is the documented interop dance. */
const { autoUpdater } = electronUpdater;

const REPO_OWNER = "ivy00johns";
const REPO_NAME = "AllTheRepos";

/** Wait this long after launch before checking — boot should feel instant. */
const STARTUP_DELAY_MS = 8000;

export type UpdateStatusListener = (status: UpdateStatus) => void;

let cachedToken: string | null | undefined;

/**
 * Find a GitHub token without shipping one.
 *
 * Order matters: an explicit environment variable is the deliberate
 * choice, and the `gh` CLI is the convenient fallback for a machine
 * that's already logged in.
 */
async function resolveToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;

  const fromEnv = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? null;
  if (fromEnv) {
    cachedToken = fromEnv;
    return cachedToken;
  }

  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], {
      timeout: 5000,
    });
    const token = stdout.trim();
    cachedToken = token.length > 0 ? token : null;
  } catch {
    // `gh` missing or not logged in — a normal state, not an error.
    cachedToken = null;
  }
  return cachedToken;
}

/**
 * Turn an updater failure into something a person can act on.
 *
 * electron-updater surfaces raw `HttpError`s complete with every response
 * header and a stack trace — useful in a log, useless in a UI. The cases
 * below are the ones that actually happen, and each has a different fix.
 *
 * GitHub deliberately answers 404 rather than 403 for an unauthorised
 * private repo, so "no releases yet" and "token can't see this repo" are
 * indistinguishable from the status code alone — the message says so
 * instead of guessing.
 */
function describeError(error: unknown): Partial<UpdateStatus> {
  const raw = error instanceof Error ? error.message : String(error);

  if (raw.includes("404")) {
    return {
      state: "unavailable",
      message:
        "No releases published yet — or this token can't see them. GitHub returns 404 for both.",
    };
  }
  if (raw.includes("ENOTFOUND") || raw.includes("ECONNREFUSED")) {
    return { state: "unavailable", message: "No network connection." };
  }
  if (raw.includes("401") || raw.includes("403")) {
    return {
      state: "unavailable",
      message: "GitHub rejected the token. Try `gh auth login`.",
    };
  }

  // Unrecognised: keep the first line, drop the header dump and stack.
  return { state: "error", message: raw.split("\n")[0].slice(0, 200) };
}

class UpdaterService {
  private listeners = new Set<UpdateStatusListener>();
  private status: UpdateStatus = {
    state: "idle",
    currentVersion: app.getVersion(),
    newVersion: null,
    releaseUrl: null,
    message: null,
    checkedAt: null,
  };
  private wired = false;

  onStatus(listener: UpdateStatusListener): () => void {
    this.listeners.add(listener);
    // Replay immediately so a late subscriber isn't blank until the next
    // check.
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  current(): UpdateStatus {
    return this.status;
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) {
      try {
        listener(this.status);
      } catch (error) {
        console.error("[updater] listener threw", error);
      }
    }
  }

  private wire(): void {
    if (this.wired) return;
    this.wired = true;

    // Checking only — see the file header for why installing is off.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = null;

    autoUpdater.on("checking-for-update", () => {
      this.set({ state: "checking", message: null });
    });

    autoUpdater.on("update-available", (info) => {
      this.set({
        state: "available",
        newVersion: info.version,
        releaseUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${info.version}`,
        message: null,
        checkedAt: new Date().toISOString(),
      });
    });

    autoUpdater.on("update-not-available", () => {
      this.set({
        state: "current",
        newVersion: null,
        message: null,
        checkedAt: new Date().toISOString(),
      });
    });

    autoUpdater.on("error", (error) => {
      this.set({
        ...describeError(error),
        checkedAt: new Date().toISOString(),
      });
    });
  }

  /**
   * Check for a newer release.
   *
   * Every "can't check" path reports a specific reason rather than a
   * generic failure — "you're running from source" and "no GitHub token"
   * are completely different problems.
   */
  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) {
      this.set({
        state: "unavailable",
        message:
          "Update checks only run in a packaged build — you're running from source.",
      });
      return this.status;
    }

    const token = await resolveToken();
    if (!token) {
      this.set({
        state: "unavailable",
        message:
          "No GitHub token found. Releases live on a private repo — run `gh auth login`, or set GH_TOKEN.",
      });
      return this.status;
    }

    this.wire();
    autoUpdater.setFeedURL({
      provider: "github",
      owner: REPO_OWNER,
      repo: REPO_NAME,
      private: true,
      token,
    });

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      // `checkForUpdates` rejects AND emits `error`, so this must classify
      // the failure the same way the event handler does — otherwise the
      // rejection lands last and overwrites a good diagnosis with a raw
      // stack trace.
      this.set({ ...describeError(error), checkedAt: new Date().toISOString() });
    }
    return this.status;
  }

  /**
   * Open the release page for the pending update.
   *
   * The URL comes from our own status rather than from the caller, so
   * this can only ever open a release page we published.
   */
  async openRelease(): Promise<{ opened: boolean; reason: string | null }> {
    const url = this.status.releaseUrl;
    if (!url) return { opened: false, reason: "No update to open." };
    const result = await openExternalAllowlisted(url);
    return { opened: result.ok, reason: result.ok ? null : (result.reason ?? null) };
  }

  /**
   * Check once shortly after launch.
   *
   * Deliberately delayed and failure-tolerant: an update check is never
   * worth slowing a cold start or surfacing an error dialog over.
   */
  scheduleStartupCheck(): void {
    if (!app.isPackaged) return;
    setTimeout(() => {
      void this.check().catch((error) => {
        console.error("[updater] startup check failed", error);
      });
    }, STARTUP_DELAY_MS).unref?.();
  }
}

export const updaterService = new UpdaterService();
