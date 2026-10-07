/**
 * The updater offers an install only where one can actually happen.
 *
 * `services/signing` answers *whether* a build may update itself; its own spec
 * covers that decision. What is asserted here is that the updater **obeys** it,
 * which is a different claim and the one that decides whether a user sees a
 * hundred-megabyte download that ends in an error they can do nothing about.
 *
 * The two halves being checked:
 *
 *   - `autoDownload` is on only when the capability is, so a build macOS will
 *     refuse to update never spends the bandwidth proving it. Inverting this
 *     single assignment is the regression that matters, and it is invisible in
 *     every other test in the repository.
 *   - `install()` refuses with a reason rather than throwing, and refuses
 *     *before* touching the updater — a refusal that had already started a
 *     download would be worse than no refusal at all.
 *
 * `electron` and `electron-updater` are both mocked, and the modules are
 * re-imported per case because the service is a module-level singleton that
 * wires its listeners once.
 */

import { describe, expect, test, vi } from "vitest";

interface FakeUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  logger: unknown;
  setFeedURL: ReturnType<typeof vi.fn>;
  checkForUpdates: ReturnType<typeof vi.fn>;
  downloadUpdate: ReturnType<typeof vi.fn>;
  quitAndInstall: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

/** A stand-in for `electron-updater`'s singleton, plus its event handlers. */
function fakeUpdater(): { autoUpdater: FakeUpdater; handlers: Map<string, (arg: unknown) => void> } {
  const handlers = new Map<string, (arg: unknown) => void>();
  const autoUpdater: FakeUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    logger: {},
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => undefined),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, handler: (arg: unknown) => void) => {
      handlers.set(event, handler);
      return autoUpdater;
    }),
  };
  return { autoUpdater, handlers };
}

/**
 * Import a fresh `updaterService` with `probeSigning` reporting `capability`.
 *
 * `resetModules` first: the service wires `autoUpdater`'s listeners exactly
 * once per process, so a second case in the same module registry would observe
 * the first one's wiring and prove nothing.
 */
async function serviceWith(capability: {
  canInstall: boolean;
  signature: string;
  reason: string;
}) {
  vi.resetModules();
  const { autoUpdater, handlers } = fakeUpdater();

  vi.doMock("electron", () => ({
    app: {
      isPackaged: true,
      getVersion: () => "1.2.3",
      getAppPath: () => "/Applications/AllTheRepos.app",
    },
  }));
  vi.doMock("electron-updater", () => ({ default: { autoUpdater } }));
  vi.doMock("@main/services/signing", () => ({
    probeSigning: () => ({ notarized: capability.canInstall, ...capability }),
  }));
  vi.doMock("@main/security/allowlist", () => ({
    openExternalAllowlisted: async () => ({ ok: true, reason: null }),
  }));

  const { updaterService } = await import("@main/services/updater");
  return { updaterService, autoUpdater, handlers };
}

const AD_HOC = {
  canInstall: false,
  signature: "ad-hoc",
  reason: "This build is ad-hoc signed, so macOS will not let it update itself.",
};

const NOTARISED = {
  canInstall: true,
  signature: "developer-id",
  reason: "Signed with a Developer ID and notarised — this build can update itself.",
};

describe("a build macOS will not update", () => {
  test("keeps automatic downloading off, however available the release is", async () => {
    const { updaterService, autoUpdater, handlers } = await serviceWith(AD_HOC);

    await updaterService.check();
    handlers.get("update-available")?.({ version: "2.0.0" });

    expect(autoUpdater.autoDownload).toBe(false);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
    // The check itself still works — that half is the half that genuinely does.
    expect(autoUpdater.checkForUpdates).toHaveBeenCalled();
    expect(updaterService.current().state).toBe("available");
    expect(updaterService.current().newVersion).toBe("2.0.0");
  });

  test("publishes the capability with the status, so the UI can explain itself", async () => {
    const { updaterService } = await serviceWith(AD_HOC);

    // `current()` is the renderer's first read, before any check has run — the
    // answer has to be there by then or the button renders without knowing.
    const status = updaterService.current();
    expect(status.canInstall).toBe(false);
    expect(status.signature).toBe("ad-hoc");
  });

  test("refuses to install, with the reason, without touching the updater", async () => {
    const { updaterService, autoUpdater } = await serviceWith(AD_HOC);
    await updaterService.check();

    const result = await updaterService.install();

    expect(result.started).toBe(false);
    expect(result.reason).toBe(AD_HOC.reason);
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });
});

describe("a build that can update itself", () => {
  test("turns automatic downloading and installing on", async () => {
    const { updaterService, autoUpdater } = await serviceWith(NOTARISED);

    await updaterService.check();

    expect(autoUpdater.autoDownload).toBe(true);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(updaterService.current().canInstall).toBe(true);
    expect(updaterService.current().signature).toBe("developer-id");
  });

  test("follows a download through to a restart being offered", async () => {
    const { updaterService, handlers } = await serviceWith(NOTARISED);
    await updaterService.check();

    handlers.get("update-available")?.({ version: "2.0.0" });
    handlers.get("download-progress")?.({ percent: 41.6 });

    expect(updaterService.current().state).toBe("downloading");
    expect(updaterService.current().progress).toBe(42);

    handlers.get("update-downloaded")?.({ version: "2.0.0" });

    expect(updaterService.current().state).toBe("ready");
    expect(updaterService.current().progress).toBe(100);
  });

  test("quits and installs once the download has landed", async () => {
    const { updaterService, autoUpdater, handlers } = await serviceWith(NOTARISED);
    await updaterService.check();
    handlers.get("update-available")?.({ version: "2.0.0" });
    handlers.get("update-downloaded")?.({ version: "2.0.0" });

    const result = await updaterService.install();
    // Deferred, so the IPC reply reaches the renderer before the app goes away.
    await new Promise((done) => setTimeout(done, 10));

    expect(result.started).toBe(true);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test("downloads when asked before the download has started", async () => {
    const { updaterService, autoUpdater, handlers } = await serviceWith(NOTARISED);
    await updaterService.check();
    handlers.get("update-available")?.({ version: "2.0.0" });

    const result = await updaterService.install();

    expect(result.started).toBe(true);
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  test("declines to install when there is nothing pending", async () => {
    const { updaterService, autoUpdater } = await serviceWith(NOTARISED);

    const result = await updaterService.install();

    expect(result.started).toBe(false);
    expect(result.reason).toContain("no update to install");
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });
});
