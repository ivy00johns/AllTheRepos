/**
 * Phase 1 Unit Test — main-process `settings:*` IPC handlers.
 *
 * The `settings:*` handlers are thin: they validate input/output and
 * delegate to `getSettings` / `updateSettings` from the settings
 * service (electron-store-backed). We mock those exports with `vi.fn`
 * and exercise the orchestration.
 *
 * Owner: qe-agent (Phase 1).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@main/services/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

import { getSettings, updateSettings } from "@main/services/settings";
import { handleSettingsGet, handleSettingsUpdate } from "@main/ipc/settings";
import type { Settings } from "@shared/types";

const defaultSettings: Settings = {
  scanPaths: ["/Users/foo/Projects"],
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaEmbedModel: "nomic-embed-text",
  openaiEmbedModel: null,
  defaultEditor: "vscode",
  defaultTerminal: null,
  identities: [],
  schemaVersion: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleSettingsGet", () => {
  it("returns the full Settings blob", async () => {
    vi.mocked(getSettings).mockReturnValue(defaultSettings);
    const out = await handleSettingsGet({});
    expect(getSettings).toHaveBeenCalledTimes(1);
    expect(out).toEqual(defaultSettings);
  });

  it("rejects extra keys (strict GetSettingsInputSchema)", async () => {
    await expect(handleSettingsGet({ wat: 1 })).rejects.toThrow();
    expect(getSettings).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a malformed Settings blob", async () => {
    vi.mocked(getSettings).mockReturnValue({
      ...defaultSettings,
      // @ts-expect-error - intentionally bad
      defaultEditor: "atom",
    });
    await expect(handleSettingsGet({})).rejects.toThrow();
  });
});

describe("handleSettingsUpdate", () => {
  it("accepts an empty patch (no-op)", async () => {
    vi.mocked(updateSettings).mockReturnValue(defaultSettings);
    const out = await handleSettingsUpdate({});
    expect(updateSettings).toHaveBeenCalledWith({});
    expect(out).toEqual(defaultSettings);
  });

  it("forwards a single-key patch verbatim", async () => {
    const patched = { ...defaultSettings, defaultEditor: "cursor" as const };
    vi.mocked(updateSettings).mockReturnValue(patched);

    const out = await handleSettingsUpdate({ defaultEditor: "cursor" });
    expect(updateSettings).toHaveBeenCalledWith({ defaultEditor: "cursor" });
    expect(out.defaultEditor).toBe("cursor");
  });

  it("forwards a detected non-legacy editor verbatim", async () => {
    // The regression that made "my default IDE is not respected": the
    // enum only knew vscode | cursor | none, so patching in Devin threw
    // before it ever reached the settings service.
    const patched = { ...defaultSettings, defaultEditor: "devin" as const };
    vi.mocked(updateSettings).mockReturnValue(patched);

    const out = await handleSettingsUpdate({ defaultEditor: "devin" });
    expect(updateSettings).toHaveBeenCalledWith({ defaultEditor: "devin" });
    expect(out.defaultEditor).toBe("devin");
  });

  it("forwards a terminal choice, which used to be stripped silently", async () => {
    const patched = { ...defaultSettings, defaultTerminal: "iterm2" as const };
    vi.mocked(updateSettings).mockReturnValue(patched);

    const out = await handleSettingsUpdate({ defaultTerminal: "iterm2" });
    expect(updateSettings).toHaveBeenCalledWith({ defaultTerminal: "iterm2" });
    expect(out.defaultTerminal).toBe("iterm2");
  });

  it("forwards a multi-key patch", async () => {
    const patched = {
      ...defaultSettings,
      defaultEditor: "none" as const,
      scanPaths: ["/Users/foo/Code"],
    };
    vi.mocked(updateSettings).mockReturnValue(patched);

    await handleSettingsUpdate({
      defaultEditor: "none",
      scanPaths: ["/Users/foo/Code"],
    });
    expect(updateSettings).toHaveBeenCalledWith({
      defaultEditor: "none",
      scanPaths: ["/Users/foo/Code"],
    });
  });

  it("rejects an unknown editor patch value", async () => {
    await expect(
      handleSettingsUpdate({ defaultEditor: "atom" }),
    ).rejects.toThrow();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("rejects an empty-string scan path entry in the patch", async () => {
    await expect(handleSettingsUpdate({ scanPaths: [""] })).rejects.toThrow();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a malformed Settings blob", async () => {
    vi.mocked(updateSettings).mockReturnValue({
      ...defaultSettings,
      schemaVersion: -1,
    });
    await expect(
      handleSettingsUpdate({ defaultEditor: "vscode" }),
    ).rejects.toThrow();
  });
});
