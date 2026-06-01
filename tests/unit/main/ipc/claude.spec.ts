/**
 * Phase 3b Unit Test — main-process `claude:*` IPC handlers.
 *
 * Seven handlers, all Zod-in / service / Zod-out:
 *   - handleClaudeIndex
 *   - handleClaudeProjects
 *   - handleClaudeRepoState
 *   - handleClaudeSessionTranscript
 *   - handleClaudeGlobalUsage
 *   - handleClaudeLaunch
 *   - handleClaudeOpenClaudeMd
 *
 * Each handler is verified for:
 *   1. Happy path — dispatches to mocked claudeService and returns its
 *      result through the result schema.
 *   2. Zod-in rejects malformed input (specific per channel) AND the
 *      service is NOT called.
 *   3. Zod-out rejects when the service returns a schema-violating
 *      result.
 *
 * Owner: qe-agent (Phase 3b).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@main/services/claude", () => ({
  claudeService: {
    index: vi.fn(),
    projects: vi.fn(),
    repoState: vi.fn(),
    sessionTranscript: vi.fn(),
    globalUsage: vi.fn(),
    launch: vi.fn(),
    openClaudeMd: vi.fn(),
    boot: vi.fn(),
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  },
}));

import { claudeService } from "@main/services/claude";
import {
  handleClaudeIndex,
  handleClaudeProjects,
  handleClaudeRepoState,
  handleClaudeSessionTranscript,
  handleClaudeGlobalUsage,
  handleClaudeLaunch,
  handleClaudeOpenClaudeMd,
} from "@main/ipc/claude";

const repoStateFixture = {
  hasClaude: true,
  claudeMdPath: "/Users/me/Projects/foo/CLAUDE.md",
  claudeMdContent: "# Hello",
  settingsPath: null,
  generatedAt: 1_700_000_000_000,
  skills: [],
  agents: [],
  mcpServers: [],
  sessions: [],
  totalTokens: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// handleClaudeIndex
// ---------------------------------------------------------------------------

describe("handleClaudeIndex", () => {
  it("dispatches to claudeService.index() and returns the schema-valid result", async () => {
    vi.mocked(claudeService.index).mockResolvedValue({
      projectCount: 3,
      sessionCount: 12,
      totalTokens: 5000,
      durationMs: 42,
    });
    const out = await handleClaudeIndex({});
    expect(claudeService.index).toHaveBeenCalledTimes(1);
    expect(out.projectCount).toBe(3);
    expect(out.durationMs).toBe(42);
  });

  it("tolerates a null payload by defaulting to {}", async () => {
    vi.mocked(claudeService.index).mockResolvedValue({
      projectCount: 0,
      sessionCount: 0,
      totalTokens: 0,
      durationMs: 0,
    });
    await handleClaudeIndex(null);
    expect(claudeService.index).toHaveBeenCalledTimes(1);
  });

  it("rejects extra keys (strict schema)", async () => {
    await expect(handleClaudeIndex({ wat: 1 })).rejects.toThrow();
    expect(claudeService.index).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a result that violates the schema", async () => {
    vi.mocked(claudeService.index).mockResolvedValue({
      projectCount: -1,
      sessionCount: 0,
      totalTokens: 0,
      durationMs: 0,
    } as unknown as Awaited<ReturnType<typeof claudeService.index>>);
    await expect(handleClaudeIndex({})).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleClaudeProjects
// ---------------------------------------------------------------------------

describe("handleClaudeProjects", () => {
  it("dispatches to claudeService.projects() and returns the projects list", async () => {
    vi.mocked(claudeService.projects).mockReturnValue({
      projects: [
        {
          hash: "h1",
          repoPath: "/r/one",
          repoSlug: "one",
          sessionCount: 2,
          lastActivityAt: "2026-05-01T10:00:00.000Z",
          totalTokens: 100,
        },
      ],
    });
    const out = await handleClaudeProjects({});
    expect(claudeService.projects).toHaveBeenCalledTimes(1);
    expect(out.projects).toHaveLength(1);
    expect(out.projects[0]!.hash).toBe("h1");
  });

  it("rejects extra keys (strict schema)", async () => {
    await expect(handleClaudeProjects({ wat: 1 })).rejects.toThrow();
    expect(claudeService.projects).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a malformed project entry", async () => {
    vi.mocked(claudeService.projects).mockReturnValue({
      projects: [
        {
          hash: "",
          repoPath: "/r/one",
          repoSlug: null,
          sessionCount: 0,
          lastActivityAt: null,
          totalTokens: 0,
        },
      ],
    } as unknown as ReturnType<typeof claudeService.projects>);
    await expect(handleClaudeProjects({})).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleClaudeRepoState
// ---------------------------------------------------------------------------

describe("handleClaudeRepoState", () => {
  it("forwards the slug and returns the schema-valid result", async () => {
    vi.mocked(claudeService.repoState).mockResolvedValue(repoStateFixture);
    const out = await handleClaudeRepoState({ slug: "foo" });
    expect(claudeService.repoState).toHaveBeenCalledWith({ slug: "foo" });
    expect(out.hasClaude).toBe(true);
  });

  it("rejects an empty slug", async () => {
    await expect(handleClaudeRepoState({ slug: "" })).rejects.toThrow();
    expect(claudeService.repoState).not.toHaveBeenCalled();
  });

  it("rejects a missing slug", async () => {
    await expect(handleClaudeRepoState({})).rejects.toThrow();
    expect(claudeService.repoState).not.toHaveBeenCalled();
  });

  it("rejects extra keys (strict schema)", async () => {
    await expect(
      handleClaudeRepoState({ slug: "foo", wat: 1 }),
    ).rejects.toThrow();
    expect(claudeService.repoState).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a malformed shape", async () => {
    vi.mocked(claudeService.repoState).mockResolvedValue({
      ...repoStateFixture,
      hasClaude: "not-a-bool",
    } as unknown as Awaited<ReturnType<typeof claudeService.repoState>>);
    await expect(handleClaudeRepoState({ slug: "foo" })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleClaudeSessionTranscript
// ---------------------------------------------------------------------------

describe("handleClaudeSessionTranscript", () => {
  it("forwards { sessionId, cursor, maxBytes } and returns the chunk", async () => {
    vi.mocked(claudeService.sessionTranscript).mockResolvedValue({
      events: [{ type: "user", timestamp: "2026-05-01T10:00:00.000Z" }],
      nextCursor: 1024,
      hasMore: true,
    });
    const out = await handleClaudeSessionTranscript({
      sessionId: "sess-1",
      cursor: 0,
      maxBytes: 4096,
    });
    expect(claudeService.sessionTranscript).toHaveBeenCalledWith({
      sessionId: "sess-1",
      cursor: 0,
      maxBytes: 4096,
    });
    expect(out.hasMore).toBe(true);
    expect(out.nextCursor).toBe(1024);
  });

  it("defaults cursor to 0 when omitted", async () => {
    vi.mocked(claudeService.sessionTranscript).mockResolvedValue({
      events: [],
      nextCursor: null,
      hasMore: false,
    });
    await handleClaudeSessionTranscript({ sessionId: "sess-1" });
    expect(claudeService.sessionTranscript).toHaveBeenCalledWith({
      sessionId: "sess-1",
      cursor: 0,
    });
  });

  it("rejects an empty sessionId", async () => {
    await expect(
      handleClaudeSessionTranscript({ sessionId: "" }),
    ).rejects.toThrow();
    expect(claudeService.sessionTranscript).not.toHaveBeenCalled();
  });

  it("rejects a negative cursor", async () => {
    await expect(
      handleClaudeSessionTranscript({ sessionId: "s", cursor: -1 }),
    ).rejects.toThrow();
    expect(claudeService.sessionTranscript).not.toHaveBeenCalled();
  });

  it("rejects maxBytes below 1024", async () => {
    await expect(
      handleClaudeSessionTranscript({ sessionId: "s", maxBytes: 1023 }),
    ).rejects.toThrow();
    expect(claudeService.sessionTranscript).not.toHaveBeenCalled();
  });

  it("rejects maxBytes above 256 KB", async () => {
    await expect(
      handleClaudeSessionTranscript({ sessionId: "s", maxBytes: 300_000 }),
    ).rejects.toThrow();
    expect(claudeService.sessionTranscript).not.toHaveBeenCalled();
  });

  it("rejects extra keys (strict schema)", async () => {
    await expect(
      handleClaudeSessionTranscript({ sessionId: "s", wat: 1 }),
    ).rejects.toThrow();
    expect(claudeService.sessionTranscript).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a non-array events field", async () => {
    vi.mocked(claudeService.sessionTranscript).mockResolvedValue({
      events: "not-an-array",
      nextCursor: null,
      hasMore: false,
    } as unknown as Awaited<
      ReturnType<typeof claudeService.sessionTranscript>
    >);
    await expect(
      handleClaudeSessionTranscript({ sessionId: "s" }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleClaudeGlobalUsage
// ---------------------------------------------------------------------------

describe("handleClaudeGlobalUsage", () => {
  it("forwards from/to and returns the rolled-up usage", async () => {
    vi.mocked(claudeService.globalUsage).mockReturnValue({
      totalTokens: 999,
      byProject: [],
      byDay: [],
      byWeek: [],
      byMonth: [],
    });
    const out = await handleClaudeGlobalUsage({
      from: "2026-05-01",
      to: "2026-05-13",
    });
    expect(claudeService.globalUsage).toHaveBeenCalledWith({
      from: "2026-05-01",
      to: "2026-05-13",
    });
    expect(out.totalTokens).toBe(999);
  });

  it("tolerates a null payload by defaulting to {}", async () => {
    vi.mocked(claudeService.globalUsage).mockReturnValue({
      totalTokens: 0,
      byProject: [],
      byDay: [],
      byWeek: [],
      byMonth: [],
    });
    await handleClaudeGlobalUsage(null);
    expect(claudeService.globalUsage).toHaveBeenCalledWith({});
  });

  it("rejects extra keys (strict schema)", async () => {
    await expect(
      handleClaudeGlobalUsage({ from: "2026-05-01", wat: 1 }),
    ).rejects.toThrow();
    expect(claudeService.globalUsage).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a result with a negative totalTokens", async () => {
    vi.mocked(claudeService.globalUsage).mockReturnValue({
      totalTokens: -1,
      byProject: [],
      byDay: [],
      byWeek: [],
      byMonth: [],
    } as unknown as ReturnType<typeof claudeService.globalUsage>);
    await expect(handleClaudeGlobalUsage({})).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleClaudeLaunch
// ---------------------------------------------------------------------------

describe("handleClaudeLaunch", () => {
  it("forwards { slug, resumeSessionId?, starterPrompt? } and returns LauncherResult", async () => {
    vi.mocked(claudeService.launch).mockResolvedValue({ ok: true });
    const out = await handleClaudeLaunch({
      slug: "foo",
      resumeSessionId: "f9a3248a-ec0c-4b07-8367-e2ec103dc69f",
      starterPrompt: "hi",
    });
    expect(claudeService.launch).toHaveBeenCalledWith({
      slug: "foo",
      resumeSessionId: "f9a3248a-ec0c-4b07-8367-e2ec103dc69f",
      starterPrompt: "hi",
    });
    expect(out.ok).toBe(true);
  });

  it("returns ok=false + reason when the launcher fails", async () => {
    vi.mocked(claudeService.launch).mockResolvedValue({
      ok: false,
      reason: "no terminal",
    });
    const out = await handleClaudeLaunch({ slug: "foo" });
    expect(out.ok).toBe(false);
    expect(out.ok === false ? out.reason : null).toBe("no terminal");
  });

  it("rejects an empty slug", async () => {
    await expect(handleClaudeLaunch({ slug: "" })).rejects.toThrow();
    expect(claudeService.launch).not.toHaveBeenCalled();
  });

  it("rejects a missing slug", async () => {
    await expect(handleClaudeLaunch({})).rejects.toThrow();
    expect(claudeService.launch).not.toHaveBeenCalled();
  });

  it("rejects extra keys (strict schema)", async () => {
    await expect(handleClaudeLaunch({ slug: "foo", wat: 1 })).rejects.toThrow();
    expect(claudeService.launch).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a non-boolean ok", async () => {
    vi.mocked(claudeService.launch).mockResolvedValue({
      ok: "true",
    } as unknown as Awaited<ReturnType<typeof claudeService.launch>>);
    await expect(handleClaudeLaunch({ slug: "foo" })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleClaudeOpenClaudeMd
// ---------------------------------------------------------------------------

describe("handleClaudeOpenClaudeMd", () => {
  it("forwards { slug } and returns the LauncherResult", async () => {
    vi.mocked(claudeService.openClaudeMd).mockResolvedValue({ ok: true });
    const out = await handleClaudeOpenClaudeMd({ slug: "foo" });
    expect(claudeService.openClaudeMd).toHaveBeenCalledWith({ slug: "foo" });
    expect(out.ok).toBe(true);
  });

  it("returns ok=false + reason when no CLAUDE.md exists", async () => {
    vi.mocked(claudeService.openClaudeMd).mockResolvedValue({
      ok: false,
      reason: "CLAUDE.md not found",
    });
    const out = await handleClaudeOpenClaudeMd({ slug: "foo" });
    expect(out.ok).toBe(false);
  });

  it("rejects an empty slug", async () => {
    await expect(handleClaudeOpenClaudeMd({ slug: "" })).rejects.toThrow();
    expect(claudeService.openClaudeMd).not.toHaveBeenCalled();
  });

  it("rejects a missing slug", async () => {
    await expect(handleClaudeOpenClaudeMd({})).rejects.toThrow();
    expect(claudeService.openClaudeMd).not.toHaveBeenCalled();
  });

  it("rejects extra keys (strict schema)", async () => {
    await expect(
      handleClaudeOpenClaudeMd({ slug: "foo", wat: 1 }),
    ).rejects.toThrow();
    expect(claudeService.openClaudeMd).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a malformed ok flag", async () => {
    vi.mocked(claudeService.openClaudeMd).mockResolvedValue({
      ok: 1,
    } as unknown as Awaited<ReturnType<typeof claudeService.openClaudeMd>>);
    await expect(handleClaudeOpenClaudeMd({ slug: "foo" })).rejects.toThrow();
  });
});
