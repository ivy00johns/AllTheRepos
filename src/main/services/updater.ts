/**
 * Update checking, and — where macOS permits it — updating.
 *
 * ## Why the install half is conditional
 *
 * macOS applies updates through Squirrel.Mac, which refuses to install
 * anything that isn't validly code-signed by a Developer ID certificate and
 * accepted by Gatekeeper. An ad-hoc signed build — every build this project
 * can produce without a paid Apple Developer membership — can therefore
 * download an update but cannot apply one.
 *
 * Pretending otherwise would be worse than not offering it: the failure
 * arrives after a hundred megabytes, with an error the user can do nothing
 * about. So the build asks what it is allowed to do, and offers only that:
 *
 *   - A Developer-ID signed, notarised, Gatekeeper-accepted build turns
 *     `autoDownload` on, reports progress, and offers **Restart to
 *     install**. That is a real update.
 *   - Anything else keeps `autoDownload` off and behaves exactly as it did
 *     before: check, report, and open the release page. `canInstall` and
 *     `signature` in the status say why, in words the UI can show.
 *
 * The question is answered by `@main/services/signing`, which reads the
 * signature off the *running bundle* rather than off the build config —
 * those differ exactly when it matters.
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

import type { InstallUpdateResult, UpdateStatus } from "@shared/types";

import {
  probeSigning,
  type SigningAssessment,
} from "@main/services/signing";
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
    // The capability is filled in by `assess()`, which is deliberately not
    // called here: this object is built while the module graph loads, and
    // probing shells out to `codesign`.
    canInstall: false,
    signature: "unknown",
    progress: null,
  };
  private wired = false;
  private capability: SigningAssessment | null = null;

  onStatus(listener: UpdateStatusListener): () => void {
    this.listeners.add(listener);
    // Replay immediately so a late subscriber isn't blank until the next
    // check.
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  current(): UpdateStatus {
    // `current()` is the renderer's first read on mount, so it is also where
    // the capability gets resolved — the answer has to be in the status
    // before the UI can decide whether to offer an install.
    this.assess();
    return this.status;
  }

  /** Probe once, publish the answer, and return it. */
  private assess(): SigningAssessment {
    if (!this.capability) {
      this.capability = probeSigning();
      this.set({
        canInstall: this.capability.canInstall,
        signature: this.capability.signature,
      });
    }
    return this.capability;
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

    // Downloading is what separates a real update from a check, so it rides
    // on the capability: a build macOS will refuse to update must not spend
    // the user's bandwidth proving it.
    const installable = this.assess().canInstall;
    autoUpdater.autoDownload = installable;
    autoUpdater.autoInstallOnAppQuit = installable;
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

    // Only reachable on an installable build — `autoDownload` is off
    // everywhere else, so these never fire there.
    autoUpdater.on("download-progress", (progress) => {
      this.set({
        state: "downloading",
        progress:
          typeof progress?.percent === "number"
            ? Math.max(0, Math.min(100, Math.round(progress.percent)))
            : null,
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      this.set({
        state: "ready",
        newVersion: info.version,
        progress: 100,
        message: null,
        checkedAt: new Date().toISOString(),
      });
    });

    autoUpdater.on("update-not-available", () => {
      this.set({
        state: "current",
        newVersion: null,
        message: null,
        progress: null,
        checkedAt: new Date().toISOString(),
      });
    });

    autoUpdater.on("error", (error) => {
      this.set({
        ...describeError(error),
        progress: null,
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
   * Download and apply the pending update, then relaunch.
   *
   * Refuses — with a reason, not an error — whenever this build cannot
   * install, which is most builds. The caller is expected to show that
   * reason, so a refusal is a normal answer rather than a failure.
   *
   * Idempotent by state: called while the download is already in flight it
   * just asks again (electron-updater de-duplicates), and called once the
   * download has finished it quits and installs.
   */
  async install(): Promise<InstallUpdateResult> {
    const capability = this.assess();
    if (!capability.canInstall) {
      return { started: false, reason: capability.reason };
    }
    if (!app.isPackaged) {
      return {
        started: false,
        reason: "Only a packaged build can install an update.",
      };
    }

    this.wire();

    if (this.status.state === "ready") {
      // Deferred so this reply reaches the renderer before the process
      // starts going away — `quitAndInstall` tears the app down.
      setImmediate(() => {
        try {
          autoUpdater.quitAndInstall();
        } catch (error) {
          this.set({
            ...describeError(error),
            progress: null,
            checkedAt: new Date().toISOString(),
          });
        }
      });
      return { started: true, reason: null };
    }

    if (
      this.status.state === "available" ||
      this.status.state === "downloading"
    ) {
      try {
        await autoUpdater.downloadUpdate();
      } catch (error) {
        this.set({
          ...describeError(error),
          progress: null,
          checkedAt: new Date().toISOString(),
        });
        return {
          started: false,
          reason:
            "The download failed — try again, or open the release page and download the DMG.",
        };
      }
      // `update-downloaded` completing the download will flip the state to
      // `ready` on its own; this returns immediately so the UI can show
      // progress rather than block on ~115 MB.
      return { started: true, reason: null };
    }

    return {
      started: false,
      reason: "There is no update to install — check for one first.",
    };
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
