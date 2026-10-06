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
 * ## Where the feed lives
 *
 * Releases are published to a **public** repo (`alltherepos-releases`) while
 * the source stays private, so checking for an update needs no credentials:
 * one anonymous request to the GitHub API. That is what lets the check work
 * for anyone who installs the app, rather than only on the machine that
 * built it.
 *
 * The feed target appears twice — here, and in `electron-builder.yml`'s
 * `publish` block, which is what writes `app-update.yml` into the bundle.
 * `tests/unit/main/services/updater-feed.spec.ts` fails if the two disagree,
 * because a mismatch means every install quietly checks the wrong repo.
 */

import { app } from "electron";
import electronUpdater from "electron-updater";

import type { UpdateStatus } from "@shared/types";

import { openExternalAllowlisted } from "@main/security/allowlist";

/** `electron-updater` is CJS; this is the documented interop dance. */
const { autoUpdater } = electronUpdater;

/**
 * Where the DMG and `latest-mac.yml` are published.
 *
 * Public on purpose, and deliberately not this source repo: the app reads the
 * feed anonymously, so anyone who installs it can check for updates. Keep in
 * lockstep with `publish` in `electron-builder.yml`.
 */
const FEED_OWNER = "ivy00johns";
const FEED_REPO = "alltherepos-releases";

/** Wait this long after launch before checking — boot should feel instant. */
const STARTUP_DELAY_MS = 8000;

export type UpdateStatusListener = (status: UpdateStatus) => void;

/**
 * Turn an updater failure into something a person can act on.
 *
 * electron-updater surfaces raw `HttpError`s complete with every response
 * header and a stack trace — useful in a log, useless in a UI. The cases
 * below are the ones that actually happen, and each has a different fix.
 *
 * The feed is public, so a 404 means exactly one thing: nothing is published
 * yet — the updater asks for `releases/latest`, which skips drafts and
 * pre-releases. The rate-limit branch exists because the check is anonymous:
 * GitHub allows 60 requests an hour per address, shared with whatever else
 * is using the connection.
 */
function describeError(error: unknown): Partial<UpdateStatus> {
  const raw = error instanceof Error ? error.message : String(error);

  if (raw.includes("404")) {
    return { state: "unavailable", message: "No releases published yet." };
  }
  if (raw.includes("ENOTFOUND") || raw.includes("ECONNREFUSED")) {
    return { state: "unavailable", message: "No network connection." };
  }
  if (raw.includes("401") || raw.includes("403") || raw.includes("429")) {
    return {
      state: "unavailable",
      message:
        "GitHub refused the request — an anonymous check is rate-limited. Try again later.",
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
        releaseUrl: `https://github.com/${FEED_OWNER}/${FEED_REPO}/releases/tag/v${info.version}`,
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
   * generic failure — "you're running from source" and "nothing is published
   * yet" are completely different problems, with different fixes.
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

    this.wire();
    // No token, no `private` flag: the feed is public. `setFeedURL` is used
    // rather than leaning on the generated `app-update.yml` so the target is
    // legible in the source — the drift guard keeps the two honest.
    autoUpdater.setFeedURL({
      provider: "github",
      owner: FEED_OWNER,
      repo: FEED_REPO,
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
