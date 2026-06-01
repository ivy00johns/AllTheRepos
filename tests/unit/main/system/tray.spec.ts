/**
 * Phase 3 Unit Test — tray icon + open-repo forwarder (ATR-006, ATR-007).
 *
 * Covers, with a fully mocked Electron runtime:
 *   - ATR-007: the tray loads the template image and marks it as a macOS
 *     template image; a missing/empty asset disables the tray (returns
 *     null) and logs.
 *   - ATR-006: `broadcastTrayOpenRepo` validates the payload and sends
 *     `tray:on:open-repo` to every live webContents; the renderer→main
 *     forwarder (`wireOpenRepoForwarder`) registers an `ipcMain.on`
 *     listener that re-broadcasts a valid request and drops a malformed
 *     one; the tray right-click menu surfaces real recent-repo items
 *     that fire the broadcast.
 *
 * Owner: Lane A (native shell).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IPC } from "@shared/ipc";

// ---------------------------------------------------------------------------
// Electron mock — captures Tray/Menu construction + ipcMain registration.
// ---------------------------------------------------------------------------

interface FakeWebContents {
  isDestroyed: () => boolean;
  send: ReturnType<typeof vi.fn>;
}

const sentByWc: FakeWebContents[] = [];

const trayInstances: Array<{
  setToolTip: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  getBounds: ReturnType<typeof vi.fn>;
  popUpContextMenu: ReturnType<typeof vi.fn>;
}> = [];

const lastImage = {
  isEmpty: vi.fn(() => false),
  setTemplateImage: vi.fn(),
};

// ipcMain listener registry so the test can fire the forwarder channel.
const ipcListeners = new Map<string, Array<(...args: unknown[]) => void>>();

// Menu template captured on the most recent buildFromTemplate call.
let lastMenuTemplate: unknown[] = [];

vi.mock("electron", () => {
  return {
    app: {
      getAppPath: vi.fn(() => "/fake/app"),
      quit: vi.fn(),
    },
    nativeImage: {
      createFromPath: vi.fn(() => lastImage),
    },
    Tray: vi.fn(() => {
      const inst = {
        setToolTip: vi.fn(),
        on: vi.fn(),
        destroy: vi.fn(),
        getBounds: vi.fn(() => ({ x: 0, y: 0, width: 22, height: 22 })),
        popUpContextMenu: vi.fn(),
      };
      trayInstances.push(inst);
      return inst;
    }),
    Menu: {
      buildFromTemplate: vi.fn((template: unknown[]) => {
        lastMenuTemplate = template;
        return { __menu: true, template };
      }),
    },
    ipcMain: {
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        const arr = ipcListeners.get(channel) ?? [];
        arr.push(listener);
        ipcListeners.set(channel, arr);
      }),
      removeListener: vi.fn(
        (channel: string, listener: (...args: unknown[]) => void) => {
          const arr = ipcListeners.get(channel) ?? [];
          ipcListeners.set(
            channel,
            arr.filter((l) => l !== listener),
          );
        },
      ),
    },
    webContents: {
      getAllWebContents: vi.fn(() => sentByWc),
    },
  };
});

// Bridges + hotkey are imported by tray.ts; stub them out.
vi.mock("@main/system/hotkey", () => ({ showSpotlight: vi.fn() }));
vi.mock("@main/system/tray-popover-bridge", () => ({
  showTrayPopover: vi.fn(),
}));
vi.mock("@main/system/menu", () => ({ broadcastMenuCommand: vi.fn() }));

// DB client — recent-repo query for the right-click menu.
const recentRows: Array<{ slug: string; name: string }> = [];
const prepareAll = vi.fn(() => recentRows);
vi.mock("@main/db/client", () => ({
  getSqlite: vi.fn(() => ({
    prepare: vi.fn(() => ({ all: prepareAll })),
  })),
}));

import {
  broadcastTrayOpenRepo,
  createTray,
  destroyTray,
  wireOpenRepoForwarder,
  TRAY_OPEN_REPO_REQUEST_CHANNEL,
} from "@main/system/tray";

function makeWc(destroyed = false): FakeWebContents {
  return { isDestroyed: () => destroyed, send: vi.fn() };
}

function fireForwarder(payload: unknown): void {
  const listeners = ipcListeners.get(TRAY_OPEN_REPO_REQUEST_CHANNEL) ?? [];
  for (const l of listeners) {
    // ipcMain.on listeners receive (event, ...args).
    l({}, payload);
  }
}

beforeEach(() => {
  sentByWc.length = 0;
  trayInstances.length = 0;
  recentRows.length = 0;
  ipcListeners.clear();
  lastMenuTemplate = [];
  lastImage.isEmpty.mockReturnValue(false);
  lastImage.setTemplateImage.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  destroyTray();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// ATR-007 — tray icon
// ---------------------------------------------------------------------------

describe("createTray — icon (ATR-007)", () => {
  it("marks the loaded image as a macOS template image", () => {
    const tray = createTray();
    expect(tray).not.toBeNull();
    expect(lastImage.setTemplateImage).toHaveBeenCalledWith(true);
  });

  it("sets a tooltip on the tray instance", () => {
    createTray();
    expect(trayInstances).toHaveLength(1);
    expect(trayInstances[0]!.setToolTip).toHaveBeenCalledWith("AllTheRepos");
  });

  it("disables the tray (returns null) when the icon asset is empty", () => {
    lastImage.isEmpty.mockReturnValue(true);
    const tray = createTray();
    expect(tray).toBeNull();
    // No Tray was constructed when the asset is missing.
    expect(trayInstances).toHaveLength(0);
    expect(console.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ATR-006 — broadcastTrayOpenRepo
// ---------------------------------------------------------------------------

describe("broadcastTrayOpenRepo (ATR-006)", () => {
  it("sends tray:on:open-repo to every live webContents with the slug", () => {
    const a = makeWc();
    const b = makeWc();
    sentByWc.push(a, b);

    broadcastTrayOpenRepo({ slug: "my-repo" });

    expect(a.send).toHaveBeenCalledWith(IPC.TRAY.ON_OPEN_REPO, {
      slug: "my-repo",
    });
    expect(b.send).toHaveBeenCalledWith(IPC.TRAY.ON_OPEN_REPO, {
      slug: "my-repo",
    });
  });

  it("skips destroyed webContents", () => {
    const dead = makeWc(true);
    const live = makeWc();
    sentByWc.push(dead, live);

    broadcastTrayOpenRepo({ slug: "x" });

    expect(dead.send).not.toHaveBeenCalled();
    expect(live.send).toHaveBeenCalledOnce();
  });

  it("throws on a malformed payload (Zod validation)", () => {
    expect(() =>
      broadcastTrayOpenRepo({ slug: 123 } as unknown as { slug: string }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ATR-006 — renderer→main forwarder
// ---------------------------------------------------------------------------

describe("wireOpenRepoForwarder (ATR-006)", () => {
  it("registers exactly one ipcMain.on listener (idempotent)", () => {
    wireOpenRepoForwarder();
    wireOpenRepoForwarder();
    const listeners = ipcListeners.get(TRAY_OPEN_REPO_REQUEST_CHANNEL) ?? [];
    expect(listeners).toHaveLength(1);
  });

  it("re-broadcasts a valid request to renderers as tray:on:open-repo", () => {
    const wc = makeWc();
    sentByWc.push(wc);

    wireOpenRepoForwarder();
    fireForwarder({ slug: "forwarded-repo" });

    expect(wc.send).toHaveBeenCalledWith(IPC.TRAY.ON_OPEN_REPO, {
      slug: "forwarded-repo",
    });
  });

  it("drops a malformed request without broadcasting or throwing", () => {
    const wc = makeWc();
    sentByWc.push(wc);

    wireOpenRepoForwarder();
    expect(() => fireForwarder({ notSlug: true })).not.toThrow();
    expect(wc.send).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("is wired automatically by createTray", () => {
    createTray();
    expect(ipcListeners.get(TRAY_OPEN_REPO_REQUEST_CHANNEL)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ATR-006 — tray right-click recent-repo menu items
// ---------------------------------------------------------------------------

describe("tray right-click menu — recent repos (ATR-006)", () => {
  function triggerRightClick(): void {
    createTray();
    const inst = trayInstances[0]!;
    // Find the "right-click" handler registered via tray.on(...).
    const call = inst.on.mock.calls.find((c) => c[0] === "right-click");
    expect(call).toBeDefined();
    const handler = call![1] as () => void;
    handler();
  }

  it("renders a clickable item per recent repo that broadcasts its slug", () => {
    recentRows.push(
      { slug: "alpha", name: "Alpha" },
      { slug: "beta", name: "Beta" },
    );
    const wc = makeWc();
    sentByWc.push(wc);

    triggerRightClick();

    // The captured menu template should contain items labelled by name.
    const items = lastMenuTemplate as Array<{
      label?: string;
      click?: () => void;
    }>;
    const alpha = items.find((i) => i.label === "Alpha");
    const beta = items.find((i) => i.label === "Beta");
    expect(alpha?.click).toBeTypeOf("function");
    expect(beta?.click).toBeTypeOf("function");

    alpha!.click!();
    expect(wc.send).toHaveBeenCalledWith(IPC.TRAY.ON_OPEN_REPO, {
      slug: "alpha",
    });
  });

  it("shows only the disabled header when there are no recent repos", () => {
    // recentRows stays empty.
    triggerRightClick();
    const items = lastMenuTemplate as Array<{
      label?: string;
      enabled?: boolean;
      type?: string;
    }>;
    const header = items.find((i) => i.label === "Recent repos");
    expect(header?.enabled).toBe(false);
    // With no recent repos, the header is immediately followed by the
    // separator — i.e. NO repo rows were injected between them.
    const headerIdx = items.findIndex((i) => i.label === "Recent repos");
    expect(items[headerIdx + 1]?.type).toBe("separator");
  });
});
