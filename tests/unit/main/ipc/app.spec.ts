/**
 * Phase 2 Unit Test — main-process `app:*` IPC handlers.
 *
 * Five handlers, all thin Zod-validated façades over `@main/system/*`:
 *   - handleSetDockBadge → setDockBadge(count)
 *   - handleAppNotify    → handleNotify(input)         (note: re-exported as `handleNotify`)
 *   - handleShowSpotlight → showSpotlight()
 *   - handleHideSpotlight → hideSpotlight()
 *   - handleRegisterActions → installNativeMenu(actions)
 *
 * We mock every system-module dependency with `vi.fn()` so this suite
 * never touches Electron at runtime.
 *
 * Owner: qe-agent (Phase 2).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@main/system/dock-badge", () => ({
  setDockBadge: vi.fn(),
}));

vi.mock("@main/system/notification", () => ({
  handleNotify: vi.fn(),
}));

vi.mock("@main/system/hotkey", () => ({
  showSpotlight: vi.fn(),
  hideSpotlight: vi.fn(),
}));

vi.mock("@main/system/menu", () => ({
  installNativeMenu: vi.fn(),
}));

import { setDockBadge } from "@main/system/dock-badge";
import { handleNotify as systemHandleNotify } from "@main/system/notification";
import { showSpotlight, hideSpotlight } from "@main/system/hotkey";
import { installNativeMenu } from "@main/system/menu";

import {
  handleSetDockBadge,
  handleAppNotify,
  handleShowSpotlight,
  handleHideSpotlight,
  handleRegisterActions,
} from "@main/ipc/app";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// handleSetDockBadge
// ---------------------------------------------------------------------------

describe("handleSetDockBadge", () => {
  it("returns the badge string echoed back from setDockBadge", async () => {
    vi.mocked(setDockBadge).mockReturnValue("3");
    const out = await handleSetDockBadge({ count: 3 });
    expect(setDockBadge).toHaveBeenCalledWith(3);
    expect(out).toEqual({ badge: "3" });
  });

  it("accepts null (clear badge)", async () => {
    vi.mocked(setDockBadge).mockReturnValue("");
    const out = await handleSetDockBadge({ count: null });
    expect(setDockBadge).toHaveBeenCalledWith(null);
    expect(out).toEqual({ badge: "" });
  });

  it("rejects a missing count via Zod", async () => {
    await expect(handleSetDockBadge({})).rejects.toThrow();
    expect(setDockBadge).not.toHaveBeenCalled();
  });

  it("rejects a non-integer count", async () => {
    await expect(handleSetDockBadge({ count: 1.5 })).rejects.toThrow();
    expect(setDockBadge).not.toHaveBeenCalled();
  });

  it("rejects a negative count", async () => {
    await expect(handleSetDockBadge({ count: -1 })).rejects.toThrow();
    expect(setDockBadge).not.toHaveBeenCalled();
  });

  it("rejects a count above the 9999 cap", async () => {
    await expect(handleSetDockBadge({ count: 10000 })).rejects.toThrow();
    expect(setDockBadge).not.toHaveBeenCalled();
  });

  it("rejects non-object input", async () => {
    await expect(handleSetDockBadge("nope")).rejects.toThrow();
    await expect(handleSetDockBadge(null)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleAppNotify
// ---------------------------------------------------------------------------

describe("handleAppNotify", () => {
  it("delegates to system handleNotify and echoes back the result", async () => {
    vi.mocked(systemHandleNotify).mockReturnValue({ shown: true });
    const out = await handleAppNotify({ title: "Scan done", body: "ok" });
    expect(systemHandleNotify).toHaveBeenCalledWith({
      title: "Scan done",
      body: "ok",
    });
    expect(out).toEqual({ shown: true });
  });

  it("forwards optional silent + actions", async () => {
    vi.mocked(systemHandleNotify).mockReturnValue({ shown: true });
    const input = {
      title: "Build complete",
      body: "Out of order",
      silent: true,
      actions: [{ type: "button" as const, text: "Open" }],
    };
    await handleAppNotify(input);
    expect(systemHandleNotify).toHaveBeenCalledWith(input);
  });

  it("returns shown:false when system returns shown:false", async () => {
    vi.mocked(systemHandleNotify).mockReturnValue({ shown: false });
    const out = await handleAppNotify({ title: "T", body: "B" });
    expect(out).toEqual({ shown: false });
  });

  it("rejects an empty title via Zod", async () => {
    await expect(handleAppNotify({ title: "", body: "ok" })).rejects.toThrow();
    expect(systemHandleNotify).not.toHaveBeenCalled();
  });

  it("rejects a missing body via Zod", async () => {
    await expect(handleAppNotify({ title: "ok" })).rejects.toThrow();
    expect(systemHandleNotify).not.toHaveBeenCalled();
  });

  it("rejects an over-long body via Zod (>500 chars)", async () => {
    const body = "x".repeat(501);
    await expect(handleAppNotify({ title: "T", body })).rejects.toThrow();
    expect(systemHandleNotify).not.toHaveBeenCalled();
  });

  it("rejects more than 3 actions", async () => {
    const actions = Array.from({ length: 4 }, (_, i) => ({
      type: "button" as const,
      text: `Btn${i}`,
    }));
    await expect(
      handleAppNotify({ title: "T", body: "B", actions }),
    ).rejects.toThrow();
    expect(systemHandleNotify).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleShowSpotlight
// ---------------------------------------------------------------------------

describe("handleShowSpotlight", () => {
  it("calls showSpotlight and returns visible:true", async () => {
    const out = await handleShowSpotlight({});
    expect(showSpotlight).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ visible: true });
  });

  it("rejects extra keys (strict schema)", async () => {
    await expect(handleShowSpotlight({ extra: 1 })).rejects.toThrow();
    expect(showSpotlight).not.toHaveBeenCalled();
  });

  it("rejects non-object input", async () => {
    await expect(handleShowSpotlight("nope")).rejects.toThrow();
    expect(showSpotlight).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleHideSpotlight
// ---------------------------------------------------------------------------

describe("handleHideSpotlight", () => {
  it("calls hideSpotlight and returns visible:false", async () => {
    const out = await handleHideSpotlight({});
    expect(hideSpotlight).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ visible: false });
  });

  it("rejects extra keys (strict schema)", async () => {
    await expect(handleHideSpotlight({ wat: true })).rejects.toThrow();
    expect(hideSpotlight).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleRegisterActions
// ---------------------------------------------------------------------------

describe("handleRegisterActions", () => {
  const sampleAction = {
    id: "app.open-settings",
    label: "Open Settings",
    scope: "global" as const,
    shortcut: "CmdOrCtrl+,",
    group: "App",
  };

  it("forwards the actions array to installNativeMenu", async () => {
    vi.mocked(installNativeMenu).mockReturnValue({
      accepted: 1,
      skipped: 0,
    });
    const out = await handleRegisterActions({ actions: [sampleAction] });
    expect(installNativeMenu).toHaveBeenCalledWith([sampleAction]);
    expect(out).toEqual({ accepted: 1, skipped: 0 });
  });

  it("accepts an empty registry (e.g. test harness)", async () => {
    vi.mocked(installNativeMenu).mockReturnValue({
      accepted: 0,
      skipped: 0,
    });
    const out = await handleRegisterActions({ actions: [] });
    expect(installNativeMenu).toHaveBeenCalledWith([]);
    expect(out).toEqual({ accepted: 0, skipped: 0 });
  });

  it("rejects when an action has a bad id (uppercase)", async () => {
    await expect(
      handleRegisterActions({
        actions: [{ ...sampleAction, id: "App.OpenSettings" }],
      }),
    ).rejects.toThrow();
    expect(installNativeMenu).not.toHaveBeenCalled();
  });

  it("rejects when an action has an unknown scope", async () => {
    await expect(
      handleRegisterActions({
        // @ts-expect-error - intentionally bad scope
        actions: [{ ...sampleAction, scope: "wat" }],
      }),
    ).rejects.toThrow();
    expect(installNativeMenu).not.toHaveBeenCalled();
  });

  it("rejects when an action has a non-ASCII shortcut", async () => {
    await expect(
      handleRegisterActions({
        actions: [{ ...sampleAction, shortcut: "Cmd+✓" }],
      }),
    ).rejects.toThrow();
    expect(installNativeMenu).not.toHaveBeenCalled();
  });

  it("rejects more than 200 actions", async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => ({
      ...sampleAction,
      id: `app.action-${i}`,
    }));
    await expect(handleRegisterActions({ actions: tooMany })).rejects.toThrow();
    expect(installNativeMenu).not.toHaveBeenCalled();
  });

  it("rejects a missing actions key", async () => {
    await expect(handleRegisterActions({})).rejects.toThrow();
    expect(installNativeMenu).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a malformed result", async () => {
    vi.mocked(installNativeMenu).mockReturnValue({
      // @ts-expect-error - intentionally bad
      accepted: -1,
      skipped: 0,
    });
    await expect(
      handleRegisterActions({ actions: [sampleAction] }),
    ).rejects.toThrow();
  });
});
