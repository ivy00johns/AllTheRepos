/**
 * Phase 3 Unit Test — macOS dock badge setter (ATR-010 support).
 *
 * `setDockBadge` is the sink the new ProcessService subscription in
 * `src/main/index.ts` drives on every snapshot update. These tests lock
 * down the setter contract the auto-driver relies on:
 *   - clears the badge on 0 / null (no "0" badge on macOS),
 *   - renders n>0 as a string, capping at "99+",
 *   - is a no-op (returns "") off darwin.
 *
 * The darwin / non-darwin split is exercised by re-importing the module
 * under a patched `process.platform`.
 *
 * Owner: Lane A (native shell).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setBadge = vi.fn();

vi.mock("electron", () => ({
  app: {
    dock: {
      setBadge: (...args: unknown[]) => setBadge(...args),
    },
  },
}));

import { setDockBadge } from "@main/system/dock-badge";

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

beforeEach(() => {
  setBadge.mockClear();
  setPlatform("darwin");
});

afterEach(() => {
  Object.defineProperty(process, "platform", {
    value: originalPlatform,
    configurable: true,
  });
});

describe("setDockBadge (darwin)", () => {
  it("clears the badge on null", () => {
    expect(setDockBadge(null)).toBe("");
    expect(setBadge).toHaveBeenCalledWith("");
  });

  it("clears the badge on 0 (running count fell to zero)", () => {
    expect(setDockBadge(0)).toBe("");
    expect(setBadge).toHaveBeenCalledWith("");
  });

  it("clears the badge on a negative count defensively", () => {
    expect(setDockBadge(-3)).toBe("");
    expect(setBadge).toHaveBeenCalledWith("");
  });

  it("renders a positive count as a string", () => {
    expect(setDockBadge(3)).toBe("3");
    expect(setBadge).toHaveBeenCalledWith("3");
  });

  it("renders the cap exactly at 99", () => {
    expect(setDockBadge(99)).toBe("99");
    expect(setBadge).toHaveBeenCalledWith("99");
  });

  it("caps a runaway count at 99+", () => {
    expect(setDockBadge(250)).toBe("99+");
    expect(setBadge).toHaveBeenCalledWith("99+");
  });
});

describe("setDockBadge (non-darwin)", () => {
  it("is a no-op and returns the empty string", () => {
    setPlatform("linux");
    expect(setDockBadge(5)).toBe("");
    expect(setBadge).not.toHaveBeenCalled();
  });
});
