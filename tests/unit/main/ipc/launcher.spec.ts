/**
 * Phase 3a Unit Test — main-process `launcher:*` IPC handlers.
 *
 * Six handlers, all Zod-in / service / Zod-out:
 *   - handleLauncherDetect       → launcherService.boot() + .detect()
 *   - handleLauncherOpenInEditor → launcherService.openInEditor(input)
 *   - handleLauncherOpenInTerminal → launcherService.openInTerminal(input)
 *   - handleLauncherOpenInFinder → launcherService.openInFinder(input)
 *   - handleLauncherOpenRemote   → launcherService.openRemote(input)
 *   - handleLauncherCopyPath     → launcherService.copyPath(input)
 *
 * Owner: qe-agent (Phase 3a).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@main/services/launcher", () => ({
  launcherService: {
    boot: vi.fn().mockResolvedValue(undefined),
    detect: vi.fn(),
    openInEditor: vi.fn(),
    openInTerminal: vi.fn(),
    openInFinder: vi.fn(),
    openRemote: vi.fn(),
    copyPath: vi.fn(),
  },
}));

import { launcherService } from "@main/services/launcher";
import {
  handleLauncherDetect,
  handleLauncherOpenInEditor,
  handleLauncherOpenInTerminal,
  handleLauncherOpenInFinder,
  handleLauncherOpenRemote,
  handleLauncherCopyPath,
} from "@main/ipc/launcher";

const detectFixture = {
  editors: [
    {
      id: "vscode" as const,
      name: "Visual Studio Code",
      available: true,
      scheme: "vscode",
      appPath: "/Applications/Visual Studio Code.app",
      cliPath: "/usr/local/bin/code",
    },
  ],
  terminals: [
    {
      id: "terminal" as const,
      name: "Terminal",
      available: true,
      appPath: "/System/Applications/Utilities/Terminal.app",
    },
  ],
  defaults: { editor: "vscode" as const, terminal: "terminal" as const },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// handleLauncherDetect
// ---------------------------------------------------------------------------

describe("handleLauncherDetect", () => {
  it("calls boot() and returns the cached detection result", async () => {
    vi.mocked(launcherService.detect).mockReturnValue(detectFixture);
    const out = await handleLauncherDetect({});
    expect(launcherService.boot).toHaveBeenCalledTimes(1);
    expect(launcherService.detect).toHaveBeenCalledTimes(1);
    expect(out.editors).toHaveLength(1);
    expect(out.defaults.editor).toBe("vscode");
  });

  it("tolerates a null payload by treating it as {}", async () => {
    vi.mocked(launcherService.detect).mockReturnValue(detectFixture);
    const out = await handleLauncherDetect(null);
    expect(out.editors).toHaveLength(1);
  });

  it("rejects extra keys (strict schema)", async () => {
    await expect(handleLauncherDetect({ wat: 1 })).rejects.toThrow();
    expect(launcherService.boot).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a result that violates the schema", async () => {
    vi.mocked(launcherService.detect).mockReturnValue({
      editors: [
        {
          id: "wat",
          name: "x",
          available: false,
          scheme: null,
          appPath: null,
          cliPath: null,
        },
      ],
      terminals: [],
      defaults: { editor: null, terminal: null },
    } as unknown as ReturnType<typeof launcherService.detect>);
    await expect(handleLauncherDetect({})).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleLauncherOpenInEditor
// ---------------------------------------------------------------------------

describe("handleLauncherOpenInEditor", () => {
  it("forwards { slug } and returns { ok: true } on success", async () => {
    vi.mocked(launcherService.openInEditor).mockResolvedValue({ ok: true });
    const out = await handleLauncherOpenInEditor({ slug: "foo" });
    expect(launcherService.openInEditor).toHaveBeenCalledWith({ slug: "foo" });
    expect(out).toEqual({ ok: true });
  });

  it("forwards { slug, editorId } when explicit", async () => {
    vi.mocked(launcherService.openInEditor).mockResolvedValue({ ok: true });
    await handleLauncherOpenInEditor({ slug: "foo", editorId: "cursor" });
    expect(launcherService.openInEditor).toHaveBeenCalledWith({
      slug: "foo",
      editorId: "cursor",
    });
  });

  it("returns { ok: false, reason } when the service fails", async () => {
    vi.mocked(launcherService.openInEditor).mockResolvedValue({
      ok: false,
      reason: "no editor installed",
    });
    const out = await handleLauncherOpenInEditor({ slug: "foo" });
    expect(out).toEqual({ ok: false, reason: "no editor installed" });
  });

  it("rejects empty slug", async () => {
    await expect(handleLauncherOpenInEditor({ slug: "" })).rejects.toThrow();
    expect(launcherService.openInEditor).not.toHaveBeenCalled();
  });

  it("rejects an unknown editorId", async () => {
    await expect(
      handleLauncherOpenInEditor({ slug: "foo", editorId: "wat" }),
    ).rejects.toThrow();
    expect(launcherService.openInEditor).not.toHaveBeenCalled();
  });

  it("rejects extra keys (strict)", async () => {
    await expect(
      handleLauncherOpenInEditor({ slug: "foo", wat: 1 }),
    ).rejects.toThrow();
    expect(launcherService.openInEditor).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleLauncherOpenInTerminal
// ---------------------------------------------------------------------------

describe("handleLauncherOpenInTerminal", () => {
  it("forwards { slug, terminalId, command }", async () => {
    vi.mocked(launcherService.openInTerminal).mockResolvedValue({ ok: true });
    await handleLauncherOpenInTerminal({
      slug: "foo",
      terminalId: "iterm2",
      command: "npm run dev",
    });
    expect(launcherService.openInTerminal).toHaveBeenCalledWith({
      slug: "foo",
      terminalId: "iterm2",
      command: "npm run dev",
    });
  });

  it("accepts just a slug", async () => {
    vi.mocked(launcherService.openInTerminal).mockResolvedValue({ ok: true });
    const out = await handleLauncherOpenInTerminal({ slug: "foo" });
    expect(out).toEqual({ ok: true });
  });

  it("rejects an unknown terminalId", async () => {
    await expect(
      handleLauncherOpenInTerminal({ slug: "foo", terminalId: "wat" }),
    ).rejects.toThrow();
    expect(launcherService.openInTerminal).not.toHaveBeenCalled();
  });

  it("rejects an empty slug", async () => {
    await expect(handleLauncherOpenInTerminal({ slug: "" })).rejects.toThrow();
    expect(launcherService.openInTerminal).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleLauncherOpenInFinder
// ---------------------------------------------------------------------------

describe("handleLauncherOpenInFinder", () => {
  it("forwards { slug } and returns ok=true", async () => {
    vi.mocked(launcherService.openInFinder).mockResolvedValue({ ok: true });
    const out = await handleLauncherOpenInFinder({ slug: "foo" });
    expect(launcherService.openInFinder).toHaveBeenCalledWith({ slug: "foo" });
    expect(out.ok).toBe(true);
  });

  it("rejects an empty slug", async () => {
    await expect(handleLauncherOpenInFinder({ slug: "" })).rejects.toThrow();
    expect(launcherService.openInFinder).not.toHaveBeenCalled();
  });

  it("returns { ok: false, reason } when the service signals a miss", async () => {
    vi.mocked(launcherService.openInFinder).mockResolvedValue({
      ok: false,
      reason: "repo not found",
    });
    const out = await handleLauncherOpenInFinder({ slug: "ghost" });
    expect(out).toEqual({ ok: false, reason: "repo not found" });
  });
});

// ---------------------------------------------------------------------------
// handleLauncherOpenRemote
// ---------------------------------------------------------------------------

describe("handleLauncherOpenRemote", () => {
  it("forwards { slug } and returns ok=true", async () => {
    vi.mocked(launcherService.openRemote).mockResolvedValue({ ok: true });
    const out = await handleLauncherOpenRemote({ slug: "foo" });
    expect(launcherService.openRemote).toHaveBeenCalledWith({ slug: "foo" });
    expect(out.ok).toBe(true);
  });

  it("returns { ok: false, reason } when no origin remote is configured", async () => {
    vi.mocked(launcherService.openRemote).mockResolvedValue({
      ok: false,
      reason: "no origin remote",
    });
    const out = await handleLauncherOpenRemote({ slug: "foo" });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("no origin remote");
  });

  it("rejects an empty slug", async () => {
    await expect(handleLauncherOpenRemote({ slug: "" })).rejects.toThrow();
    expect(launcherService.openRemote).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleLauncherCopyPath
// ---------------------------------------------------------------------------

describe("handleLauncherCopyPath", () => {
  it("forwards { slug } and returns ok=true", async () => {
    vi.mocked(launcherService.copyPath).mockResolvedValue({ ok: true });
    const out = await handleLauncherCopyPath({ slug: "foo" });
    expect(launcherService.copyPath).toHaveBeenCalledWith({ slug: "foo" });
    expect(out.ok).toBe(true);
  });

  it("returns { ok: false, reason } when the repo is unknown", async () => {
    vi.mocked(launcherService.copyPath).mockResolvedValue({
      ok: false,
      reason: "repo not found",
    });
    const out = await handleLauncherCopyPath({ slug: "ghost" });
    expect(out).toEqual({ ok: false, reason: "repo not found" });
  });

  it("rejects an empty slug", async () => {
    await expect(handleLauncherCopyPath({ slug: "" })).rejects.toThrow();
    expect(launcherService.copyPath).not.toHaveBeenCalled();
  });
});
