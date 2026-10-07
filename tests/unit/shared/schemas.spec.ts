/**
 * Phase 0 Unit Test — `src/shared/schemas.ts`
 *
 * Validates the Zod schemas that gate the IPC contract. The same parsers
 * run in the main-process handler entry point, so a regression here means
 * a regression in the contract surface. Cheap to run, no Electron runtime.
 *
 * Owner: qe-agent (Phase 0).
 */

import { describe, it, expect } from "vitest";
import {
  TagSourceSchema,
  TagSchema,
  LanguageBytesSchema,
  RepoSchema,
  SmartFilterSchema,
  GroupSchema,
  ScanEventSchema,
  PingInputSchema,
  PingResponseSchema,
  // ---- Launcher enums + Phase 1 additions
  EDITOR_IDS,
  TERMINAL_IDS,
  SettingsSchema,
  SearchFiltersSchema,
  SearchHitSchema,
  ListReposInputSchema,
  ListReposResultSchema,
  GetRepoInputSchema,
  RepoDetailSchema,
  SearchReposInputSchema,
  SearchReposResultSchema,
  RescanRepoInputSchema,
  SetRepoTagsInputSchema,
  SmartFilterInputSchema,
  StartScanInputSchema,
  StartScanResultSchema,
  ScanStatusInputSchema,
  ScanStatusResultSchema,
  CancelScanInputSchema,
  CancelScanResultSchema,
  GitStatusInputSchema,
  GitStatusSchema,
  GitBranchSchema,
  GitBranchesResultSchema,
  OpenInEditorInputSchema,
  GetSettingsInputSchema,
  UpdateSettingsInputSchema,
  ListGroupsInputSchema,
  CreateGroupInputSchema,
  RenameGroupInputSchema,
  DeleteGroupInputSchema,
  SetGroupMembersInputSchema,
  // ---- Phase 2 additions
  ActionIdSchema,
  ActionScopeSchema,
  AcceleratorSchema,
  ActionSchema,
  NotificationActionSchema,
  SetDockBadgeInputSchema,
  SetDockBadgeResultSchema,
  NotifyInputSchema,
  NotifyResultSchema,
  ShowSpotlightInputSchema,
  ShowSpotlightResultSchema,
  HideSpotlightInputSchema,
  HideSpotlightResultSchema,
  RegisterActionsInputSchema,
  RegisterActionsResultSchema,
  MenuCommandPayloadSchema,
  DeepLinkPayloadSchema,
  TrayOpenRepoPayloadSchema,
  // ---- Phase 3a additions
  ProcessInfoSchema,
  ListProcessesInputSchema,
  ListProcessesResultSchema,
  ListProcessesForRepoInputSchema,
  KillProcessInputSchema,
  KillProcessResultSchema,
  ProcessUpdateEventSchema,
  EditorIdSchema,
  TerminalIdSchema,
  DetectedEditorSchema,
  DetectedTerminalSchema,
  DetectLauncherInputSchema,
  DetectLauncherResultSchema,
  OpenInEditorPhase3InputSchema,
  OpenInTerminalInputSchema,
  OpenSlugInputSchema,
  LauncherResultSchema,
  // ---- Phase 3b additions
  TokenUsageSchema,
  ClaudeSessionSchema,
  ClaudeProjectSchema,
  ClaudeSkillSchema,
  ClaudeAgentSchema,
  ClaudeMcpServerSchema,
  ClaudeRepoStateSchema,
  ClaudeIndexInputSchema,
  ClaudeIndexResultSchema,
  ClaudeProjectsInputSchema,
  ClaudeProjectsResultSchema,
  ClaudeRepoStateInputSchema,
  ClaudeSessionTranscriptInputSchema,
  ClaudeSessionTranscriptResultSchema,
  ClaudeGlobalUsageInputSchema,
  ClaudeGlobalUsageResultSchema,
  ClaudeLaunchInputSchema,
  ClaudeOpenClaudeMdInputSchema,
  ClaudeUpdateEventSchema,
  TranscriptEventSchema,
} from "../../../src/shared/schemas";

// ---------------------------------------------------------------------------
// PingInputSchema
// ---------------------------------------------------------------------------

describe("PingInputSchema", () => {
  it("accepts an empty object", () => {
    expect(PingInputSchema.parse({})).toEqual({});
  });

  it("accepts an object with a string nonce", () => {
    expect(PingInputSchema.parse({ nonce: "abc-123" })).toEqual({
      nonce: "abc-123",
    });
  });

  it("rejects a non-string nonce", () => {
    expect(() => PingInputSchema.parse({ nonce: 42 })).toThrow();
  });

  it("rejects null", () => {
    expect(() => PingInputSchema.parse(null)).toThrow();
  });

  it("rejects a string payload", () => {
    expect(() => PingInputSchema.parse("ping")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PingResponseSchema
// ---------------------------------------------------------------------------

describe("PingResponseSchema", () => {
  const validResponse = {
    ok: true as const,
    pong: "pong" as const,
    mainProcessPid: 12345,
    receivedAt: "2026-05-13T16:54:00.000Z",
  };

  it("accepts a valid response payload", () => {
    expect(PingResponseSchema.parse(validResponse)).toEqual(validResponse);
  });

  it("rejects ok=false (literal true required)", () => {
    expect(() =>
      PingResponseSchema.parse({ ...validResponse, ok: false }),
    ).toThrow();
  });

  it("rejects pong not equal to 'pong'", () => {
    expect(() =>
      PingResponseSchema.parse({ ...validResponse, pong: "PONG" }),
    ).toThrow();
  });

  it("rejects negative mainProcessPid", () => {
    expect(() =>
      PingResponseSchema.parse({ ...validResponse, mainProcessPid: -1 }),
    ).toThrow();
  });

  it("rejects non-integer mainProcessPid", () => {
    expect(() =>
      PingResponseSchema.parse({ ...validResponse, mainProcessPid: 1.5 }),
    ).toThrow();
  });

  it("rejects empty receivedAt", () => {
    expect(() =>
      PingResponseSchema.parse({ ...validResponse, receivedAt: "" }),
    ).toThrow();
  });

  it("rejects missing fields", () => {
    expect(() =>
      PingResponseSchema.parse({ ok: true, pong: "pong" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ScanEventSchema (discriminated union on `kind`)
// ---------------------------------------------------------------------------

describe("ScanEventSchema", () => {
  it("accepts a progress event", () => {
    const ev = {
      kind: "progress" as const,
      processed: 1,
      total: 10,
      currentPath: "/repos/foo",
    };
    expect(ScanEventSchema.parse(ev)).toEqual(ev);
  });

  it("accepts a done event", () => {
    const ev = {
      kind: "done" as const,
      totalRepos: 42,
      durationMs: 1234.5,
    };
    expect(ScanEventSchema.parse(ev)).toEqual(ev);
  });

  it("accepts an error event with null path", () => {
    const ev = {
      kind: "error" as const,
      message: "permission denied",
      path: null,
    };
    expect(ScanEventSchema.parse(ev)).toEqual(ev);
  });

  it("accepts an error event with a string path", () => {
    const ev = {
      kind: "error" as const,
      message: "permission denied",
      path: "/repos/secret",
    };
    expect(ScanEventSchema.parse(ev)).toEqual(ev);
  });

  it("accepts a repo event when the embedded RepoSchema validates", () => {
    const validRepo = {
      id: 1,
      slug: "foo-bar",
      name: "foo-bar",
      fullPath: "/repos/foo-bar",
      remoteUrl: null,
      defaultBranch: null,
      currentBranch: null,
      lastCommitHash: null,
      lastCommitDate: null,
      lastCommitMsg: null,
      isDirty: false,
      primaryLanguage: null,
      languages: [],
      tags: [],
      description: null,
      readmePreview: null,
      readmeHash: null,
      sizeBytes: null,
      lastScannedAt: null,
      lastOpenedAt: null,
      isFavorite: false,
      favoritedAt: null,
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
      source: "filesystem_scan" as const,
    };
    const ev = { kind: "repo" as const, repo: validRepo };
    expect(ScanEventSchema.parse(ev)).toEqual(ev);
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      ScanEventSchema.parse({ kind: "started", message: "go" }),
    ).toThrow();
  });

  it("rejects a progress event with negative processed", () => {
    expect(() =>
      ScanEventSchema.parse({
        kind: "progress",
        processed: -1,
        total: 1,
        currentPath: "/x",
      }),
    ).toThrow();
  });

  it("rejects a done event with negative durationMs", () => {
    expect(() =>
      ScanEventSchema.parse({
        kind: "done",
        totalRepos: 0,
        durationMs: -0.001,
      }),
    ).toThrow();
  });

  it("rejects a repo event whose nested repo is malformed", () => {
    expect(() =>
      ScanEventSchema.parse({
        kind: "repo",
        repo: { id: "not-a-number" },
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Entity schemas (sanity coverage so the discriminated union surface is real)
// ---------------------------------------------------------------------------

describe("TagSchema", () => {
  it("accepts a valid tag", () => {
    expect(TagSchema.parse({ value: "rust", source: "heuristic" })).toEqual({
      value: "rust",
      source: "heuristic",
    });
  });

  it("rejects an empty value", () => {
    expect(() => TagSchema.parse({ value: "", source: "user" })).toThrow();
  });

  it("rejects an unknown source", () => {
    expect(() => TagSchema.parse({ value: "rust", source: "ai" })).toThrow();
  });
});

describe("TagSourceSchema", () => {
  it("accepts user, heuristic, smart", () => {
    expect(TagSourceSchema.parse("user")).toBe("user");
    expect(TagSourceSchema.parse("heuristic")).toBe("heuristic");
    expect(TagSourceSchema.parse("smart")).toBe("smart");
  });

  it("rejects anything else", () => {
    expect(() => TagSourceSchema.parse("manual")).toThrow();
  });
});

describe("LanguageBytesSchema", () => {
  it("accepts a valid language entry", () => {
    expect(
      LanguageBytesSchema.parse({
        name: "TypeScript",
        bytes: 1024,
        color: "#3178c6",
      }),
    ).toEqual({ name: "TypeScript", bytes: 1024, color: "#3178c6" });
  });

  it("rejects negative bytes", () => {
    expect(() =>
      LanguageBytesSchema.parse({
        name: "TypeScript",
        bytes: -1,
        color: "#3178c6",
      }),
    ).toThrow();
  });
});

describe("SmartFilterSchema", () => {
  it("accepts an empty filter", () => {
    expect(SmartFilterSchema.parse({})).toEqual({});
  });

  it("accepts a filter with all optional fields", () => {
    const input = {
      language: "rust",
      tagsInclude: ["wasm"],
      tagsExclude: ["archived"],
      dirtyOnly: true,
      sinceDays: 30,
      hasRemote: true,
    };
    expect(SmartFilterSchema.parse(input)).toEqual(input);
  });

  it("rejects a negative sinceDays", () => {
    expect(() => SmartFilterSchema.parse({ sinceDays: -1 })).toThrow();
  });
});

describe("GroupSchema", () => {
  const valid = {
    id: 1,
    name: "Frontend",
    description: null,
    isSmart: false,
    smartFilter: null,
    parentGroupId: null,
    sortOrder: 0,
    repoCount: 0,
  };

  it("accepts a valid manual group", () => {
    expect(GroupSchema.parse(valid)).toEqual(valid);
  });

  it("rejects an empty name", () => {
    expect(() => GroupSchema.parse({ ...valid, name: "" })).toThrow();
  });

  it("rejects a negative repoCount", () => {
    expect(() => GroupSchema.parse({ ...valid, repoCount: -1 })).toThrow();
  });

  it("accepts a smart group with a nested filter", () => {
    const smart = {
      ...valid,
      isSmart: true,
      smartFilter: { language: "rust" },
    };
    expect(GroupSchema.parse(smart)).toEqual(smart);
  });
});

// ===========================================================================
// Phase 1 schema coverage
// ===========================================================================
//
// Each Phase 1 IPC channel has an input + output schema in
// `src/shared/schemas.ts`. These tests target the small handful that gate
// the live IPC handlers: SettingsSchema, list/search inputs, scan job
// shapes, git status / branch shapes, and group CRUD inputs.
//
// Owner: qe-agent (Phase 1).

// ---------------------------------------------------------------------------
// SettingsSchema (round-trips through settings:get / settings:update)
// ---------------------------------------------------------------------------

describe("SettingsSchema", () => {
  const valid = {
    scanPaths: ["/Users/foo/Projects"],
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaEmbedModel: "nomic-embed-text",
    openaiEmbedModel: null,
    defaultEditor: "vscode" as const,
    defaultTerminal: null,
    identities: ["ivy00johns"],
    // "Fully populated" has to include every field the schema knows, or the
    // round-trip below silently stops covering the ones it omits.
    adHocNoticeDismissed: false,
    schemaVersion: 1,
  };

  it("accepts a fully-populated settings blob", () => {
    expect(SettingsSchema.parse(valid)).toEqual(valid);
  });

  it("defaults `adHocNoticeDismissed` for a file written before the field", () => {
    // This is the migration path: an existing `settings.json` has no such key,
    // and defaulting it is what keeps the notice showing on an un-notarised
    // build instead of the file failing validation and resetting every root.
    const { adHocNoticeDismissed: _omitted, ...withoutIt } = valid;
    const parsed = SettingsSchema.parse(withoutIt);
    expect(parsed.adHocNoticeDismissed).toBe(false);
    expect(parsed.scanPaths).toEqual(valid.scanPaths);
  });

  it("defaults `identities` so pre-existing settings files still parse", () => {
    const { identities: _omitted, ...withoutIdentities } = valid;
    expect(SettingsSchema.parse(withoutIdentities).identities).toEqual([]);
  });

  it("accepts every detected editor id, not just vscode/cursor", () => {
    // Regression guard: `defaultEditor` used to be the closed enum
    // `vscode | cursor | none`, so the detection list in Settings could
    // offer an editor (Devin, Zed, …) whose choice the schema then threw
    // away on write.
    for (const editor of EDITOR_IDS) {
      expect(
        SettingsSchema.parse({ ...valid, defaultEditor: editor }).defaultEditor,
      ).toBe(editor);
    }
  });

  it("accepts the explicit \"none\" opt-out", () => {
    expect(
      SettingsSchema.parse({ ...valid, defaultEditor: "none" }).defaultEditor,
    ).toBe("none");
  });

  it("rejects an unknown editor enum value", () => {
    expect(() =>
      SettingsSchema.parse({ ...valid, defaultEditor: "vim" }),
    ).toThrow();
  });

  it("rejects a null editor (use \"none\", not null)", () => {
    expect(() =>
      SettingsSchema.parse({ ...valid, defaultEditor: null }),
    ).toThrow();
  });

  it("defaults `defaultTerminal` to null so pre-3a files still parse", () => {
    const { defaultTerminal: _omitted, ...withoutTerminal } = valid;
    expect(SettingsSchema.parse(withoutTerminal).defaultTerminal).toBeNull();
  });

  it("accepts each detected terminal id", () => {
    for (const terminal of TERMINAL_IDS) {
      expect(
        SettingsSchema.parse({ ...valid, defaultTerminal: terminal })
          .defaultTerminal,
      ).toBe(terminal);
    }
  });

  it("rejects an empty ollamaBaseUrl", () => {
    expect(() =>
      SettingsSchema.parse({ ...valid, ollamaBaseUrl: "" }),
    ).toThrow();
  });

  it("rejects an empty scan path entry", () => {
    expect(() => SettingsSchema.parse({ ...valid, scanPaths: [""] })).toThrow();
  });

  it("rejects a negative schemaVersion", () => {
    expect(() =>
      SettingsSchema.parse({ ...valid, schemaVersion: -1 }),
    ).toThrow();
  });

  it("rejects a non-integer schemaVersion", () => {
    expect(() =>
      SettingsSchema.parse({ ...valid, schemaVersion: 1.5 }),
    ).toThrow();
  });
});

describe("GetSettingsInputSchema", () => {
  it("accepts an empty object", () => {
    expect(GetSettingsInputSchema.parse({})).toEqual({});
  });

  it("rejects extra keys (strict)", () => {
    expect(() => GetSettingsInputSchema.parse({ extra: 1 })).toThrow();
  });
});

describe("UpdateSettingsInputSchema (partial of SettingsSchema)", () => {
  it("accepts an empty patch", () => {
    expect(UpdateSettingsInputSchema.parse({})).toEqual({});
  });

  it("accepts a single-key patch", () => {
    expect(
      UpdateSettingsInputSchema.parse({ defaultEditor: "cursor" }),
    ).toEqual({ defaultEditor: "cursor" });
  });

  it("forwards a detected editor through the patch", () => {
    expect(
      UpdateSettingsInputSchema.parse({ defaultEditor: "devin" }),
    ).toEqual({ defaultEditor: "devin" });
  });

  it("forwards a terminal choice through the patch", () => {
    expect(
      UpdateSettingsInputSchema.parse({ defaultTerminal: "iterm2" }),
    ).toEqual({ defaultTerminal: "iterm2" });
  });

  it("does not invent a defaultTerminal for an empty patch", () => {
    // `.partial()` must short-circuit before `defaultTerminal`'s default
    // applies, or every save would write a field the caller never sent.
    expect(UpdateSettingsInputSchema.parse({})).toEqual({});
  });

  it("rejects an unknown editor in a patch", () => {
    expect(() =>
      UpdateSettingsInputSchema.parse({ defaultEditor: "atom" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// catalog:list inputs / outputs
// ---------------------------------------------------------------------------

describe("ListReposInputSchema", () => {
  it("accepts an empty object (all fields optional)", () => {
    expect(ListReposInputSchema.parse({})).toEqual({});
  });

  it("accepts a populated query", () => {
    const q = {
      q: "rust",
      language: "rust",
      tags: ["wasm"],
      groupId: 7,
      smart: false,
      dirtyOnly: true,
      sort: "lastCommit" as const,
      order: "desc" as const,
      limit: 50,
      offset: 0,
    };
    expect(ListReposInputSchema.parse(q)).toEqual(q);
  });

  it("rejects limit > 200", () => {
    expect(() => ListReposInputSchema.parse({ limit: 201 })).toThrow();
  });

  it("rejects limit < 1", () => {
    expect(() => ListReposInputSchema.parse({ limit: 0 })).toThrow();
  });

  it("rejects a negative offset", () => {
    expect(() => ListReposInputSchema.parse({ offset: -1 })).toThrow();
  });

  it("rejects an unknown sort key", () => {
    expect(() => ListReposInputSchema.parse({ sort: "foo" })).toThrow();
  });

  it("rejects an unknown order", () => {
    expect(() => ListReposInputSchema.parse({ order: "sideways" })).toThrow();
  });

  it("accepts null language (preserved as null)", () => {
    expect(ListReposInputSchema.parse({ language: null })).toEqual({
      language: null,
    });
  });
});

describe("ListReposResultSchema", () => {
  it("accepts an empty result", () => {
    const empty = { items: [], total: 0, limit: 50, offset: 0 };
    expect(ListReposResultSchema.parse(empty)).toEqual(empty);
  });

  it("rejects a negative total", () => {
    expect(() =>
      ListReposResultSchema.parse({
        items: [],
        total: -1,
        limit: 0,
        offset: 0,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// catalog:get
// ---------------------------------------------------------------------------

describe("GetRepoInputSchema", () => {
  it("accepts a string slug", () => {
    expect(GetRepoInputSchema.parse({ slug: "foo" })).toEqual({ slug: "foo" });
  });

  it("rejects an empty slug", () => {
    expect(() => GetRepoInputSchema.parse({ slug: "" })).toThrow();
  });

  it("rejects a missing slug", () => {
    expect(() => GetRepoInputSchema.parse({})).toThrow();
  });
});

describe("RepoDetailSchema", () => {
  const baseRepo = {
    id: 1,
    slug: "x",
    name: "x",
    fullPath: "/repos/x",
    remoteUrl: null,
    defaultBranch: null,
    currentBranch: null,
    lastCommitHash: null,
    lastCommitDate: null,
    lastCommitMsg: null,
    isDirty: false,
    primaryLanguage: null,
    languages: [],
    tags: [],
    description: null,
    readmePreview: null,
    readmeHash: null,
    sizeBytes: null,
    lastScannedAt: null,
    lastOpenedAt: null,
    isFavorite: false,
    favoritedAt: null,
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    source: "filesystem_scan" as const,
  };

  it("accepts the Repo shape extended with readmeContent + groups", () => {
    const detail = { ...baseRepo, readmeContent: "# x", groups: [] };
    expect(RepoDetailSchema.parse(detail)).toEqual(detail);
  });

  it("accepts a null readmeContent", () => {
    const detail = { ...baseRepo, readmeContent: null, groups: [] };
    expect(RepoDetailSchema.parse(detail)).toEqual(detail);
  });

  it("rejects when readmeContent is missing", () => {
    const detail = { ...baseRepo, groups: [] };
    expect(() => RepoDetailSchema.parse(detail)).toThrow();
  });

  it("rejects a group entry without a name", () => {
    const detail = {
      ...baseRepo,
      readmeContent: null,
      groups: [{ id: 1 }],
    };
    expect(() => RepoDetailSchema.parse(detail)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// catalog:search
// ---------------------------------------------------------------------------

describe("SearchFiltersSchema", () => {
  it("accepts an empty filter object", () => {
    expect(SearchFiltersSchema.parse({})).toEqual({});
  });

  it("accepts populated filters", () => {
    const f = {
      language: "rust",
      tags: ["wasm"],
      groupIds: [1, 2],
      dirtyOnly: true,
    };
    expect(SearchFiltersSchema.parse(f)).toEqual(f);
  });
});

describe("SearchReposInputSchema", () => {
  it("accepts a minimal query", () => {
    expect(SearchReposInputSchema.parse({ q: "hello" })).toEqual({
      q: "hello",
    });
  });

  it("accepts a populated query", () => {
    const input = {
      q: "rust async",
      mode: "hybrid" as const,
      filters: { language: "rust" },
      limit: 50,
    };
    expect(SearchReposInputSchema.parse(input)).toEqual(input);
  });

  it("rejects an empty q", () => {
    expect(() => SearchReposInputSchema.parse({ q: "" })).toThrow();
  });

  it("rejects an unknown mode", () => {
    expect(() =>
      SearchReposInputSchema.parse({ q: "x", mode: "lexical" }),
    ).toThrow();
  });

  it("rejects limit > 200", () => {
    expect(() =>
      SearchReposInputSchema.parse({ q: "x", limit: 201 }),
    ).toThrow();
  });
});

describe("SearchHitSchema", () => {
  const repo = {
    id: 1,
    slug: "x",
    name: "x",
    fullPath: "/repos/x",
    remoteUrl: null,
    defaultBranch: null,
    currentBranch: null,
    lastCommitHash: null,
    lastCommitDate: null,
    lastCommitMsg: null,
    isDirty: false,
    primaryLanguage: null,
    languages: [],
    tags: [],
    description: null,
    readmePreview: null,
    readmeHash: null,
    sizeBytes: null,
    lastScannedAt: null,
    lastOpenedAt: null,
    isFavorite: false,
    favoritedAt: null,
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    source: "filesystem_scan" as const,
  };

  it("accepts a hybrid hit with snippet", () => {
    const hit = {
      repo,
      score: 0.87,
      matchKind: "hybrid" as const,
      snippet: "async fn",
    };
    expect(SearchHitSchema.parse(hit)).toEqual(hit);
  });

  it("accepts a vector hit with null snippet", () => {
    const hit = {
      repo,
      score: 0.5,
      matchKind: "vector" as const,
      snippet: null,
    };
    expect(SearchHitSchema.parse(hit)).toEqual(hit);
  });

  it("rejects an unknown matchKind", () => {
    expect(() =>
      SearchHitSchema.parse({
        repo,
        score: 1,
        matchKind: "lexical",
        snippet: null,
      }),
    ).toThrow();
  });

  it("rejects a non-numeric score", () => {
    expect(() =>
      SearchHitSchema.parse({
        repo,
        score: "high",
        matchKind: "fts",
        snippet: null,
      }),
    ).toThrow();
  });

  it("SearchReposResultSchema accepts an empty array", () => {
    expect(SearchReposResultSchema.parse([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// catalog:rescan + catalog:setTags + catalog:smartFilter inputs
// ---------------------------------------------------------------------------

describe("RescanRepoInputSchema", () => {
  it("accepts a slug", () => {
    expect(RescanRepoInputSchema.parse({ slug: "foo" })).toEqual({
      slug: "foo",
    });
  });

  it("rejects an empty slug", () => {
    expect(() => RescanRepoInputSchema.parse({ slug: "" })).toThrow();
  });
});

describe("SetRepoTagsInputSchema", () => {
  it("accepts up to 12 tags", () => {
    const tags = Array.from({ length: 12 }, (_, i) => `t${i}`);
    expect(SetRepoTagsInputSchema.parse({ slug: "x", tags })).toEqual({
      slug: "x",
      tags,
    });
  });

  it("rejects > 12 tags", () => {
    const tags = Array.from({ length: 13 }, (_, i) => `t${i}`);
    expect(() => SetRepoTagsInputSchema.parse({ slug: "x", tags })).toThrow();
  });

  it("accepts an empty tag list (caller may clear all)", () => {
    expect(SetRepoTagsInputSchema.parse({ slug: "x", tags: [] })).toEqual({
      slug: "x",
      tags: [],
    });
  });
});

describe("SmartFilterInputSchema", () => {
  it("accepts a minimal prompt", () => {
    expect(SmartFilterInputSchema.parse({ prompt: "rust async" })).toEqual({
      prompt: "rust async",
    });
  });

  it("rejects an empty prompt", () => {
    expect(() => SmartFilterInputSchema.parse({ prompt: "" })).toThrow();
  });

  it("rejects limit > 200", () => {
    expect(() =>
      SmartFilterInputSchema.parse({ prompt: "x", limit: 999 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// scan:* shapes
// ---------------------------------------------------------------------------

describe("StartScanInputSchema", () => {
  it("accepts an empty object", () => {
    expect(StartScanInputSchema.parse({})).toEqual({});
  });

  it("accepts a path override", () => {
    expect(StartScanInputSchema.parse({ paths: ["/Users/foo"] })).toEqual({
      paths: ["/Users/foo"],
    });
  });

  it("rejects an empty string path entry", () => {
    expect(() => StartScanInputSchema.parse({ paths: [""] })).toThrow();
  });
});

describe("StartScanResultSchema", () => {
  it("accepts a running job handle", () => {
    const out = {
      jobId: "uuid-1",
      status: "running" as const,
      startedAt: "2026-05-13T00:00:00.000Z",
    };
    expect(StartScanResultSchema.parse(out)).toEqual(out);
  });

  it("rejects status != 'running'", () => {
    expect(() =>
      StartScanResultSchema.parse({
        jobId: "x",
        status: "done",
        startedAt: "2026-05-13T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("ScanStatusInputSchema / ScanStatusResultSchema", () => {
  it("input accepts a job id", () => {
    expect(ScanStatusInputSchema.parse({ jobId: "uuid-1" })).toEqual({
      jobId: "uuid-1",
    });
  });

  it("input rejects an empty job id", () => {
    expect(() => ScanStatusInputSchema.parse({ jobId: "" })).toThrow();
  });

  it("result accepts every status enum value", () => {
    const base = {
      jobId: "u",
      processed: 0,
      total: 0,
      startedAt: "2026-05-13T00:00:00.000Z",
      endedAt: null,
      errorMessage: null,
    };
    for (const status of [
      "running",
      "done",
      "error",
      "cancelled",
      "unknown",
    ] as const) {
      expect(ScanStatusResultSchema.parse({ ...base, status }).status).toBe(
        status,
      );
    }
  });

  it("result rejects an unknown status", () => {
    expect(() =>
      ScanStatusResultSchema.parse({
        jobId: "u",
        status: "queued",
        processed: 0,
        total: 0,
        startedAt: "2026-05-13T00:00:00.000Z",
        endedAt: null,
        errorMessage: null,
      }),
    ).toThrow();
  });
});

describe("CancelScanInputSchema / CancelScanResultSchema", () => {
  it("input accepts a job id", () => {
    expect(CancelScanInputSchema.parse({ jobId: "u" })).toEqual({
      jobId: "u",
    });
  });

  it("result accepts cancelled=true|false", () => {
    expect(
      CancelScanResultSchema.parse({ jobId: "u", cancelled: true }),
    ).toEqual({ jobId: "u", cancelled: true });
    expect(
      CancelScanResultSchema.parse({ jobId: "u", cancelled: false }),
    ).toEqual({ jobId: "u", cancelled: false });
  });

  it("result rejects a non-boolean cancelled flag", () => {
    expect(() =>
      CancelScanResultSchema.parse({ jobId: "u", cancelled: "yes" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// git:* shapes
// ---------------------------------------------------------------------------

describe("GitStatusInputSchema / GitStatusSchema", () => {
  it("input requires a slug", () => {
    expect(GitStatusInputSchema.parse({ slug: "x" })).toEqual({ slug: "x" });
    expect(() => GitStatusInputSchema.parse({})).toThrow();
  });

  it("output accepts a clean repo", () => {
    const s = {
      slug: "x",
      isDirty: false,
      ahead: 0,
      behind: 0,
      currentBranch: "main",
      upstream: "origin/main",
    };
    expect(GitStatusSchema.parse(s)).toEqual(s);
  });

  it("output rejects negative ahead/behind", () => {
    expect(() =>
      GitStatusSchema.parse({
        slug: "x",
        isDirty: false,
        ahead: -1,
        behind: 0,
        currentBranch: null,
        upstream: null,
      }),
    ).toThrow();
  });

  it("output accepts null branch + null upstream (detached HEAD case)", () => {
    const s = {
      slug: "x",
      isDirty: true,
      ahead: 0,
      behind: 0,
      currentBranch: null,
      upstream: null,
    };
    expect(GitStatusSchema.parse(s)).toEqual(s);
  });
});

describe("GitBranchSchema / GitBranchesResultSchema", () => {
  it("accepts a current branch with null commit metadata", () => {
    const b = {
      name: "main",
      isCurrent: true,
      lastCommitHash: null,
      lastCommitDate: null,
      lastCommitMsg: null,
    };
    expect(GitBranchSchema.parse(b)).toEqual(b);
  });

  it("rejects an empty branch name", () => {
    expect(() =>
      GitBranchSchema.parse({
        name: "",
        isCurrent: false,
        lastCommitHash: null,
        lastCommitDate: null,
        lastCommitMsg: null,
      }),
    ).toThrow();
  });

  it("GitBranchesResultSchema accepts an empty list", () => {
    expect(GitBranchesResultSchema.parse([])).toEqual([]);
  });
});

describe("OpenInEditorInputSchema", () => {
  it("accepts slug-only payload", () => {
    expect(OpenInEditorInputSchema.parse({ slug: "x" })).toEqual({
      slug: "x",
    });
  });

  it("accepts each editor option", () => {
    for (const editor of [...EDITOR_IDS, "none"] as const) {
      expect(OpenInEditorInputSchema.parse({ slug: "x", editor }).editor).toBe(
        editor,
      );
    }
  });

  it("rejects an unknown editor", () => {
    expect(() =>
      OpenInEditorInputSchema.parse({ slug: "x", editor: "vim" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// groups:* shapes
// ---------------------------------------------------------------------------

describe("ListGroupsInputSchema", () => {
  it("accepts an empty object", () => {
    expect(ListGroupsInputSchema.parse({})).toEqual({});
  });

  it("rejects extra keys (strict)", () => {
    expect(() => ListGroupsInputSchema.parse({ x: 1 })).toThrow();
  });
});

describe("CreateGroupInputSchema", () => {
  it("accepts a minimal manual group", () => {
    expect(CreateGroupInputSchema.parse({ name: "Frontend" })).toEqual({
      name: "Frontend",
    });
  });

  it("accepts a smart group with a nested filter", () => {
    const input = {
      name: "Rust repos",
      description: null,
      isSmart: true,
      smartFilter: { language: "rust" },
      parentGroupId: null,
    };
    expect(CreateGroupInputSchema.parse(input)).toEqual(input);
  });

  it("rejects an empty name", () => {
    expect(() => CreateGroupInputSchema.parse({ name: "" })).toThrow();
  });
});

describe("RenameGroupInputSchema", () => {
  it("accepts {id, name}", () => {
    expect(RenameGroupInputSchema.parse({ id: 1, name: "New" })).toEqual({
      id: 1,
      name: "New",
    });
  });

  it("rejects an empty name", () => {
    expect(() => RenameGroupInputSchema.parse({ id: 1, name: "" })).toThrow();
  });

  it("rejects a non-integer id", () => {
    expect(() =>
      RenameGroupInputSchema.parse({ id: 1.5, name: "x" }),
    ).toThrow();
  });
});

describe("DeleteGroupInputSchema", () => {
  it("accepts an integer id", () => {
    expect(DeleteGroupInputSchema.parse({ id: 1 })).toEqual({ id: 1 });
  });

  it("rejects a missing id", () => {
    expect(() => DeleteGroupInputSchema.parse({})).toThrow();
  });
});

describe("SetGroupMembersInputSchema", () => {
  it("accepts a groupId + slug list", () => {
    expect(
      SetGroupMembersInputSchema.parse({ groupId: 1, slugs: ["a", "b"] }),
    ).toEqual({ groupId: 1, slugs: ["a", "b"] });
  });

  it("accepts an empty slug list (caller clears membership)", () => {
    expect(SetGroupMembersInputSchema.parse({ groupId: 1, slugs: [] })).toEqual(
      { groupId: 1, slugs: [] },
    );
  });

  it("rejects an empty-string slug entry", () => {
    expect(() =>
      SetGroupMembersInputSchema.parse({ groupId: 1, slugs: [""] }),
    ).toThrow();
  });
});

// ===========================================================================
// PHASE 2 SCHEMAS — app:* IPC, action registry, push-event payloads.
// ===========================================================================

// ---------------------------------------------------------------------------
// ActionIdSchema
// ---------------------------------------------------------------------------

describe("ActionIdSchema", () => {
  it("accepts kebab-case + dot ids", () => {
    expect(ActionIdSchema.parse("app.open-settings")).toBe("app.open-settings");
    expect(ActionIdSchema.parse("catalog.refresh")).toBe("catalog.refresh");
    expect(ActionIdSchema.parse("repo.copy-path")).toBe("repo.copy-path");
  });

  it("accepts a single-segment id", () => {
    expect(ActionIdSchema.parse("refresh")).toBe("refresh");
  });

  it("rejects an empty string", () => {
    expect(() => ActionIdSchema.parse("")).toThrow();
  });

  it("rejects uppercase letters", () => {
    expect(() => ActionIdSchema.parse("App.OpenSettings")).toThrow();
  });

  it("rejects underscores (not in grammar)", () => {
    expect(() => ActionIdSchema.parse("app.open_settings")).toThrow();
  });

  it("rejects an id starting with a digit", () => {
    expect(() => ActionIdSchema.parse("1bad")).toThrow();
  });

  it("rejects an id starting with a dot", () => {
    expect(() => ActionIdSchema.parse(".foo")).toThrow();
  });

  it("rejects an id with whitespace", () => {
    expect(() => ActionIdSchema.parse("app open")).toThrow();
  });

  it("rejects an id longer than 64 chars", () => {
    expect(() => ActionIdSchema.parse("a." + "b".repeat(64))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ActionScopeSchema
// ---------------------------------------------------------------------------

describe("ActionScopeSchema", () => {
  it("accepts every documented scope", () => {
    for (const s of [
      "global",
      "catalog",
      "repo-detail",
      "settings",
      "spotlight",
    ] as const) {
      expect(ActionScopeSchema.parse(s)).toBe(s);
    }
  });

  it("rejects an unknown scope", () => {
    expect(() => ActionScopeSchema.parse("topbar")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AcceleratorSchema
// ---------------------------------------------------------------------------

describe("AcceleratorSchema", () => {
  it("accepts printable-ASCII strings", () => {
    expect(AcceleratorSchema.parse("CmdOrCtrl+K")).toBe("CmdOrCtrl+K");
    expect(AcceleratorSchema.parse("Alt+Shift+P")).toBe("Alt+Shift+P");
    expect(AcceleratorSchema.parse("/")).toBe("/");
  });

  it("rejects an empty string", () => {
    expect(() => AcceleratorSchema.parse("")).toThrow();
  });

  it("rejects a non-ASCII shortcut", () => {
    expect(() => AcceleratorSchema.parse("Cmd+✓")).toThrow();
  });

  it("rejects an over-long shortcut", () => {
    expect(() => AcceleratorSchema.parse("a".repeat(65))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ActionSchema
// ---------------------------------------------------------------------------

describe("ActionSchema", () => {
  const base = {
    id: "app.open-settings",
    label: "Open Settings",
    scope: "global" as const,
  };

  it("accepts the minimal required fields", () => {
    expect(ActionSchema.parse(base)).toEqual(base);
  });

  it("accepts the full optional set", () => {
    const full = {
      ...base,
      shortcut: "CmdOrCtrl+,",
      icon: "settings",
      hint: "Open application preferences",
      group: "App",
      devOnly: false,
    };
    expect(ActionSchema.parse(full)).toEqual(full);
  });

  it("rejects a malformed id", () => {
    expect(() => ActionSchema.parse({ ...base, id: "Bad.ID" })).toThrow();
  });

  it("rejects an empty label", () => {
    expect(() => ActionSchema.parse({ ...base, label: "" })).toThrow();
  });

  it("rejects an over-long label (>120 chars)", () => {
    expect(() =>
      ActionSchema.parse({ ...base, label: "x".repeat(121) }),
    ).toThrow();
  });

  it("rejects an unknown scope", () => {
    expect(() => ActionSchema.parse({ ...base, scope: "wat" })).toThrow();
  });

  it("rejects a non-ASCII shortcut", () => {
    expect(() => ActionSchema.parse({ ...base, shortcut: "Cmd+✓" })).toThrow();
  });

  it("rejects an over-long hint", () => {
    expect(() =>
      ActionSchema.parse({ ...base, hint: "x".repeat(201) }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// NotificationActionSchema
// ---------------------------------------------------------------------------

describe("NotificationActionSchema", () => {
  it("accepts a button-type action", () => {
    expect(
      NotificationActionSchema.parse({ type: "button", text: "Open" }),
    ).toEqual({ type: "button", text: "Open" });
  });

  it("rejects a non-button type", () => {
    expect(() =>
      NotificationActionSchema.parse({ type: "link", text: "Open" }),
    ).toThrow();
  });

  it("rejects empty text", () => {
    expect(() =>
      NotificationActionSchema.parse({ type: "button", text: "" }),
    ).toThrow();
  });

  it("rejects text over 64 chars", () => {
    expect(() =>
      NotificationActionSchema.parse({ type: "button", text: "x".repeat(65) }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SetDockBadgeInputSchema / Result
// ---------------------------------------------------------------------------

describe("SetDockBadgeInputSchema", () => {
  it("accepts a non-negative integer count", () => {
    expect(SetDockBadgeInputSchema.parse({ count: 3 })).toEqual({ count: 3 });
  });

  it("accepts zero", () => {
    expect(SetDockBadgeInputSchema.parse({ count: 0 })).toEqual({ count: 0 });
  });

  it("accepts null (clear)", () => {
    expect(SetDockBadgeInputSchema.parse({ count: null })).toEqual({
      count: null,
    });
  });

  it("rejects a missing count", () => {
    expect(() => SetDockBadgeInputSchema.parse({})).toThrow();
  });

  it("rejects a non-integer count", () => {
    expect(() => SetDockBadgeInputSchema.parse({ count: 1.5 })).toThrow();
  });

  it("rejects a negative count", () => {
    expect(() => SetDockBadgeInputSchema.parse({ count: -1 })).toThrow();
  });

  it("rejects a count above 9999", () => {
    expect(() => SetDockBadgeInputSchema.parse({ count: 10000 })).toThrow();
  });
});

describe("SetDockBadgeResultSchema", () => {
  it("accepts a string badge", () => {
    expect(SetDockBadgeResultSchema.parse({ badge: "3" })).toEqual({
      badge: "3",
    });
  });

  it("accepts an empty string badge (cleared)", () => {
    expect(SetDockBadgeResultSchema.parse({ badge: "" })).toEqual({
      badge: "",
    });
  });

  it("rejects a non-string badge", () => {
    expect(() => SetDockBadgeResultSchema.parse({ badge: 3 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// NotifyInputSchema / Result
// ---------------------------------------------------------------------------

describe("NotifyInputSchema", () => {
  it("accepts title + body", () => {
    expect(NotifyInputSchema.parse({ title: "T", body: "B" })).toEqual({
      title: "T",
      body: "B",
    });
  });

  it("accepts silent + actions", () => {
    expect(
      NotifyInputSchema.parse({
        title: "T",
        body: "B",
        silent: true,
        actions: [{ type: "button", text: "Open" }],
      }),
    ).toEqual({
      title: "T",
      body: "B",
      silent: true,
      actions: [{ type: "button", text: "Open" }],
    });
  });

  it("rejects an empty title", () => {
    expect(() => NotifyInputSchema.parse({ title: "", body: "B" })).toThrow();
  });

  it("rejects an over-long title (>120 chars)", () => {
    expect(() =>
      NotifyInputSchema.parse({ title: "x".repeat(121), body: "B" }),
    ).toThrow();
  });

  it("rejects an over-long body (>500 chars)", () => {
    expect(() =>
      NotifyInputSchema.parse({ title: "T", body: "x".repeat(501) }),
    ).toThrow();
  });

  it("rejects more than 3 actions", () => {
    expect(() =>
      NotifyInputSchema.parse({
        title: "T",
        body: "B",
        actions: Array.from({ length: 4 }, (_, i) => ({
          type: "button" as const,
          text: `B${i}`,
        })),
      }),
    ).toThrow();
  });
});

describe("NotifyResultSchema", () => {
  it("accepts shown=true", () => {
    expect(NotifyResultSchema.parse({ shown: true })).toEqual({ shown: true });
  });

  it("accepts shown=false", () => {
    expect(NotifyResultSchema.parse({ shown: false })).toEqual({
      shown: false,
    });
  });

  it("rejects a missing shown", () => {
    expect(() => NotifyResultSchema.parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ShowSpotlight / HideSpotlight schemas
// ---------------------------------------------------------------------------

describe("ShowSpotlightInputSchema / HideSpotlightInputSchema", () => {
  it("accept empty objects (strict)", () => {
    expect(ShowSpotlightInputSchema.parse({})).toEqual({});
    expect(HideSpotlightInputSchema.parse({})).toEqual({});
  });

  it("reject extra keys (strict)", () => {
    expect(() => ShowSpotlightInputSchema.parse({ x: 1 })).toThrow();
    expect(() => HideSpotlightInputSchema.parse({ x: 1 })).toThrow();
  });
});

describe("ShowSpotlightResultSchema / HideSpotlightResultSchema", () => {
  it("Show result is { visible: true }", () => {
    expect(ShowSpotlightResultSchema.parse({ visible: true })).toEqual({
      visible: true,
    });
  });

  it("Hide result is { visible: false }", () => {
    expect(HideSpotlightResultSchema.parse({ visible: false })).toEqual({
      visible: false,
    });
  });

  it("Show rejects visible=false", () => {
    expect(() => ShowSpotlightResultSchema.parse({ visible: false })).toThrow();
  });

  it("Hide rejects visible=true", () => {
    expect(() => HideSpotlightResultSchema.parse({ visible: true })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RegisterActionsInputSchema / Result
// ---------------------------------------------------------------------------

describe("RegisterActionsInputSchema", () => {
  const sampleAction = {
    id: "app.open-settings",
    label: "Open Settings",
    scope: "global" as const,
  };

  it("accepts an empty actions array", () => {
    expect(RegisterActionsInputSchema.parse({ actions: [] })).toEqual({
      actions: [],
    });
  });

  it("accepts a single action", () => {
    expect(
      RegisterActionsInputSchema.parse({ actions: [sampleAction] }),
    ).toEqual({ actions: [sampleAction] });
  });

  it("rejects an action with a malformed id", () => {
    expect(() =>
      RegisterActionsInputSchema.parse({
        actions: [{ ...sampleAction, id: "Bad.ID" }],
      }),
    ).toThrow();
  });

  it("rejects more than 200 actions", () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => ({
      ...sampleAction,
      id: `app.action-${i}`,
    }));
    expect(() =>
      RegisterActionsInputSchema.parse({ actions: tooMany }),
    ).toThrow();
  });

  it("rejects a missing actions key", () => {
    expect(() => RegisterActionsInputSchema.parse({})).toThrow();
  });
});

describe("RegisterActionsResultSchema", () => {
  it("accepts non-negative accepted + skipped", () => {
    expect(
      RegisterActionsResultSchema.parse({ accepted: 8, skipped: 0 }),
    ).toEqual({ accepted: 8, skipped: 0 });
  });

  it("rejects negative numbers", () => {
    expect(() =>
      RegisterActionsResultSchema.parse({ accepted: -1, skipped: 0 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// MenuCommandPayloadSchema
// ---------------------------------------------------------------------------

describe("MenuCommandPayloadSchema", () => {
  it("accepts a valid commandId", () => {
    expect(
      MenuCommandPayloadSchema.parse({ commandId: "app.open-settings" }),
    ).toEqual({ commandId: "app.open-settings" });
  });

  it("rejects a malformed commandId", () => {
    expect(() =>
      MenuCommandPayloadSchema.parse({ commandId: "Bad.ID" }),
    ).toThrow();
  });

  it("rejects a missing commandId", () => {
    expect(() => MenuCommandPayloadSchema.parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// DeepLinkPayloadSchema
// ---------------------------------------------------------------------------

describe("DeepLinkPayloadSchema", () => {
  it("accepts a path without leading slash + empty params", () => {
    expect(
      DeepLinkPayloadSchema.parse({ path: "settings", params: {} }),
    ).toEqual({ path: "settings", params: {} });
  });

  it("accepts a multi-segment path", () => {
    expect(
      DeepLinkPayloadSchema.parse({
        path: "repo/foo",
        params: { slug: "foo" },
      }),
    ).toEqual({ path: "repo/foo", params: { slug: "foo" } });
  });

  it("rejects a path starting with '/'", () => {
    expect(() =>
      DeepLinkPayloadSchema.parse({ path: "/repo/foo", params: {} }),
    ).toThrow();
  });

  it("rejects an empty path", () => {
    expect(() =>
      DeepLinkPayloadSchema.parse({ path: "", params: {} }),
    ).toThrow();
  });

  it("rejects an over-long path (>2048)", () => {
    expect(() =>
      DeepLinkPayloadSchema.parse({ path: "x".repeat(2049), params: {} }),
    ).toThrow();
  });

  it("rejects non-string param values", () => {
    expect(() =>
      DeepLinkPayloadSchema.parse({ path: "settings", params: { a: 1 } }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TrayOpenRepoPayloadSchema
// ---------------------------------------------------------------------------

describe("TrayOpenRepoPayloadSchema", () => {
  it("accepts a slug", () => {
    expect(TrayOpenRepoPayloadSchema.parse({ slug: "foo" })).toEqual({
      slug: "foo",
    });
  });

  it("rejects an empty slug", () => {
    expect(() => TrayOpenRepoPayloadSchema.parse({ slug: "" })).toThrow();
  });

  it("rejects a missing slug", () => {
    expect(() => TrayOpenRepoPayloadSchema.parse({})).toThrow();
  });
});

// ===========================================================================
// Phase 3a — process + launcher schemas
// ===========================================================================

// ---------------------------------------------------------------------------
// ProcessInfoSchema
// ---------------------------------------------------------------------------

describe("ProcessInfoSchema", () => {
  const validRow = {
    pid: 1234,
    ppid: 1,
    command: "node",
    commandLine: "node server.js",
    port: 3000,
    protocol: "tcp" as const,
    cwd: "/Users/me/Projects/foo",
    repoSlug: "foo",
    firstSeenAt: 1_700_000_000_000,
    observedAt: 1_700_000_001_000,
  };

  it("accepts a valid row", () => {
    expect(ProcessInfoSchema.parse(validRow)).toEqual(validRow);
  });

  it("accepts null cwd and null repoSlug", () => {
    expect(
      ProcessInfoSchema.parse({ ...validRow, cwd: null, repoSlug: null }),
    ).toEqual({ ...validRow, cwd: null, repoSlug: null });
  });

  it("rejects pid=0 (positive integer required)", () => {
    expect(() => ProcessInfoSchema.parse({ ...validRow, pid: 0 })).toThrow();
  });

  it("rejects negative pid", () => {
    expect(() => ProcessInfoSchema.parse({ ...validRow, pid: -1 })).toThrow();
  });

  it("rejects port=99999 (above 65535 cap)", () => {
    expect(() =>
      ProcessInfoSchema.parse({ ...validRow, port: 99999 }),
    ).toThrow();
  });

  it("rejects negative port", () => {
    expect(() => ProcessInfoSchema.parse({ ...validRow, port: -1 })).toThrow();
  });

  it("rejects negative firstSeenAt", () => {
    expect(() =>
      ProcessInfoSchema.parse({ ...validRow, firstSeenAt: -1 }),
    ).toThrow();
  });

  it("rejects an empty command", () => {
    expect(() =>
      ProcessInfoSchema.parse({ ...validRow, command: "" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ListProcessesInputSchema / ListProcessesResultSchema /
// ListProcessesForRepoInputSchema
// ---------------------------------------------------------------------------

describe("ListProcessesInputSchema", () => {
  it("accepts an empty object", () => {
    expect(ListProcessesInputSchema.parse({})).toEqual({});
  });

  it("rejects extra keys (strict)", () => {
    expect(() => ListProcessesInputSchema.parse({ wat: 1 })).toThrow();
  });
});

describe("ListProcessesResultSchema", () => {
  it("accepts an empty processes array", () => {
    expect(
      ListProcessesResultSchema.parse({ processes: [], snapshotAt: 0 }),
    ).toEqual({ processes: [], snapshotAt: 0 });
  });

  it("rejects a non-array processes field", () => {
    expect(() =>
      ListProcessesResultSchema.parse({ processes: "nope", snapshotAt: 1 }),
    ).toThrow();
  });
});

describe("ListProcessesForRepoInputSchema", () => {
  it("accepts a valid slug", () => {
    expect(ListProcessesForRepoInputSchema.parse({ slug: "foo" })).toEqual({
      slug: "foo",
    });
  });

  it("rejects an empty slug", () => {
    expect(() => ListProcessesForRepoInputSchema.parse({ slug: "" })).toThrow();
  });

  it("rejects extra keys (strict)", () => {
    expect(() =>
      ListProcessesForRepoInputSchema.parse({ slug: "foo", extra: 1 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// KillProcessInputSchema / KillProcessResultSchema
// ---------------------------------------------------------------------------

describe("KillProcessInputSchema", () => {
  it("accepts { pid: 123 }", () => {
    expect(KillProcessInputSchema.parse({ pid: 123 })).toEqual({ pid: 123 });
  });

  it("accepts { pid: 123, escalateMs: 5000 }", () => {
    expect(
      KillProcessInputSchema.parse({ pid: 123, escalateMs: 5000 }),
    ).toEqual({ pid: 123, escalateMs: 5000 });
  });

  it("rejects { pid: -1 } (positive integer required)", () => {
    expect(() => KillProcessInputSchema.parse({ pid: -1 })).toThrow();
  });

  it("rejects { pid: 0 }", () => {
    expect(() => KillProcessInputSchema.parse({ pid: 0 })).toThrow();
  });

  it("rejects { escalateMs: 50 } below 100 minimum", () => {
    expect(() =>
      KillProcessInputSchema.parse({ pid: 123, escalateMs: 50 }),
    ).toThrow();
  });

  it("rejects escalateMs > 60_000", () => {
    expect(() =>
      KillProcessInputSchema.parse({ pid: 123, escalateMs: 60_001 }),
    ).toThrow();
  });

  it("rejects extra keys (strict)", () => {
    expect(() => KillProcessInputSchema.parse({ pid: 123, wat: 1 })).toThrow();
  });
});

describe("KillProcessResultSchema", () => {
  it("accepts a valid stopped result", () => {
    const r = {
      pid: 1,
      finalSignal: "SIGINT" as const,
      stopped: true,
      durationMs: 0,
    };
    expect(KillProcessResultSchema.parse(r)).toEqual(r);
  });

  it("accepts finalSignal=noop for already-dead PIDs", () => {
    const r = {
      pid: 1,
      finalSignal: "noop" as const,
      stopped: true,
      durationMs: 0,
    };
    expect(KillProcessResultSchema.parse(r)).toEqual(r);
  });

  it("rejects an unknown finalSignal", () => {
    expect(() =>
      KillProcessResultSchema.parse({
        pid: 1,
        finalSignal: "SIGUSR1",
        stopped: true,
        durationMs: 0,
      }),
    ).toThrow();
  });
});

describe("ProcessUpdateEventSchema", () => {
  it("matches the ListProcessesResultSchema shape", () => {
    expect(
      ProcessUpdateEventSchema.parse({ processes: [], snapshotAt: 1 }),
    ).toEqual({ processes: [], snapshotAt: 1 });
  });
});

// ---------------------------------------------------------------------------
// EditorIdSchema / TerminalIdSchema
// ---------------------------------------------------------------------------

describe("EditorIdSchema", () => {
  const editorIds = [
    "vscode",
    "cursor",
    "zed",
    "windsurf",
    "sublime",
    "xcode",
    "idea",
    "webstorm",
    "pycharm",
    "rider",
    "goland",
    "clion",
    "rubymine",
  ] as const;

  it("accepts every enum value", () => {
    for (const id of editorIds) {
      expect(EditorIdSchema.parse(id)).toBe(id);
    }
  });

  it("rejects an unknown id ('notarealthing')", () => {
    expect(() => EditorIdSchema.parse("notarealthing")).toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => EditorIdSchema.parse("")).toThrow();
  });
});

describe("TerminalIdSchema", () => {
  const terminalIds = [
    "terminal",
    "iterm2",
    "warp",
    "ghostty",
    "alacritty",
    "kitty",
    "hyper",
  ] as const;

  it("accepts every enum value", () => {
    for (const id of terminalIds) {
      expect(TerminalIdSchema.parse(id)).toBe(id);
    }
  });

  it("rejects an unknown id ('notarealthing')", () => {
    expect(() => TerminalIdSchema.parse("notarealthing")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// DetectedEditorSchema / DetectedTerminalSchema / DetectLauncherResultSchema
// ---------------------------------------------------------------------------

describe("DetectedEditorSchema", () => {
  it("accepts a fully populated entry", () => {
    const v = {
      id: "vscode" as const,
      name: "Visual Studio Code",
      available: true,
      scheme: "vscode",
      appPath: "/Applications/Visual Studio Code.app",
      cliPath: "/usr/local/bin/code",
    };
    expect(DetectedEditorSchema.parse(v)).toEqual(v);
  });

  it("accepts null scheme / appPath / cliPath", () => {
    const v = {
      id: "xcode" as const,
      name: "Xcode",
      available: true,
      scheme: null,
      appPath: null,
      cliPath: null,
    };
    expect(DetectedEditorSchema.parse(v)).toEqual(v);
  });

  it("rejects an unknown id", () => {
    expect(() =>
      DetectedEditorSchema.parse({
        id: "notreal",
        name: "x",
        available: false,
        scheme: null,
        appPath: null,
        cliPath: null,
      }),
    ).toThrow();
  });
});

describe("DetectedTerminalSchema", () => {
  it("accepts a valid entry", () => {
    const v = {
      id: "iterm2" as const,
      name: "iTerm",
      available: true,
      appPath: "/Applications/iTerm.app",
    };
    expect(DetectedTerminalSchema.parse(v)).toEqual(v);
  });

  it("rejects an unknown id", () => {
    expect(() =>
      DetectedTerminalSchema.parse({
        id: "wat",
        name: "wat",
        available: false,
        appPath: null,
      }),
    ).toThrow();
  });
});

describe("DetectLauncherInputSchema", () => {
  it("accepts an empty object", () => {
    expect(DetectLauncherInputSchema.parse({})).toEqual({});
  });

  it("rejects extra keys (strict)", () => {
    expect(() => DetectLauncherInputSchema.parse({ wat: 1 })).toThrow();
  });
});

describe("DetectLauncherResultSchema", () => {
  it("validates the canonical empty shape", () => {
    const v = {
      editors: [],
      terminals: [],
      defaults: { editor: null, terminal: null },
    };
    expect(DetectLauncherResultSchema.parse(v)).toEqual(v);
  });

  it("validates a fully-populated shape", () => {
    const v = {
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
    expect(DetectLauncherResultSchema.parse(v)).toEqual(v);
  });

  it("rejects a defaults.editor that isn't a valid EditorId", () => {
    expect(() =>
      DetectLauncherResultSchema.parse({
        editors: [],
        terminals: [],
        defaults: { editor: "wat", terminal: null },
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// OpenInEditorPhase3InputSchema / OpenInTerminalInputSchema /
// OpenSlugInputSchema / LauncherResultSchema
// ---------------------------------------------------------------------------

describe("OpenInEditorPhase3InputSchema", () => {
  it("accepts { slug }", () => {
    expect(OpenInEditorPhase3InputSchema.parse({ slug: "foo" })).toEqual({
      slug: "foo",
    });
  });

  it("accepts { slug, editorId }", () => {
    expect(
      OpenInEditorPhase3InputSchema.parse({ slug: "foo", editorId: "vscode" }),
    ).toEqual({ slug: "foo", editorId: "vscode" });
  });

  it("rejects an unknown editorId", () => {
    expect(() =>
      OpenInEditorPhase3InputSchema.parse({ slug: "foo", editorId: "wat" }),
    ).toThrow();
  });

  it("rejects extra keys (strict)", () => {
    expect(() =>
      OpenInEditorPhase3InputSchema.parse({ slug: "foo", wat: 1 }),
    ).toThrow();
  });
});

describe("OpenInTerminalInputSchema", () => {
  it("accepts { slug, terminalId, command }", () => {
    expect(
      OpenInTerminalInputSchema.parse({
        slug: "foo",
        terminalId: "iterm2",
        command: "npm run dev",
      }),
    ).toEqual({ slug: "foo", terminalId: "iterm2", command: "npm run dev" });
  });

  it("rejects an unknown terminalId", () => {
    expect(() =>
      OpenInTerminalInputSchema.parse({ slug: "foo", terminalId: "wat" }),
    ).toThrow();
  });
});

describe("OpenSlugInputSchema", () => {
  it("accepts { slug }", () => {
    expect(OpenSlugInputSchema.parse({ slug: "foo" })).toEqual({ slug: "foo" });
  });

  it("rejects an empty slug", () => {
    expect(() => OpenSlugInputSchema.parse({ slug: "" })).toThrow();
  });

  it("rejects extra keys (strict)", () => {
    expect(() =>
      OpenSlugInputSchema.parse({ slug: "foo", extra: 1 }),
    ).toThrow();
  });
});

describe("LauncherResultSchema", () => {
  it("accepts { ok: true }", () => {
    expect(LauncherResultSchema.parse({ ok: true })).toEqual({ ok: true });
  });

  it("accepts { ok: false, reason: 'no editor installed' }", () => {
    expect(
      LauncherResultSchema.parse({ ok: false, reason: "no editor installed" }),
    ).toEqual({ ok: false, reason: "no editor installed" });
  });

  it("accepts { ok: false, reason: null }", () => {
    expect(LauncherResultSchema.parse({ ok: false, reason: null })).toEqual({
      ok: false,
      reason: null,
    });
  });

  it("rejects a missing ok field", () => {
    expect(() => LauncherResultSchema.parse({})).toThrow();
  });

  it("rejects a non-boolean ok", () => {
    expect(() => LauncherResultSchema.parse({ ok: "true" })).toThrow();
  });
});

// ===========================================================================
// Phase 3b — Claude Code integration
// ===========================================================================

const tokenUsageOk = {
  inputTokens: 100,
  outputTokens: 200,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  totalTokens: 300,
};

const sessionOk = {
  id: "sess-1",
  projectHash: "h1",
  startedAt: "2026-05-01T10:00:00.000Z",
  lastActivityAt: "2026-05-01T11:00:00.000Z",
  messageCount: 4,
  tokenUsage: tokenUsageOk,
  filePath: "/Users/me/.claude/projects/h1/sess-1.jsonl",
  sizeBytes: 1024,
};

const projectOk = {
  hash: "h1",
  repoPath: "/Users/me/Projects/foo",
  repoSlug: "foo",
  sessionCount: 3,
  lastActivityAt: "2026-05-01T11:00:00.000Z",
  totalTokens: 500,
};

const skillOk = {
  name: "my-skill",
  description: "does a thing",
  path: "/Users/me/Projects/foo/.claude/skills/my-skill/SKILL.md",
  frontmatter: { name: "my-skill" },
};

const agentOk = {
  name: "my-agent",
  description: "agent description",
  path: "/Users/me/Projects/foo/.claude/agents/my-agent.md",
  frontmatter: { name: "my-agent" },
};

const mcpOk = {
  name: "server-a",
  type: "stdio" as const,
  command: "node",
  args: ["server.js"],
  configuredIn: "project" as const,
  status: "configured" as const,
};

const repoStateOk = {
  hasClaude: true,
  claudeMdPath: "/Users/me/Projects/foo/CLAUDE.md",
  claudeMdContent: "# foo",
  settingsPath: null,
  generatedAt: 1_700_000_000_000,
  skills: [skillOk],
  agents: [agentOk],
  mcpServers: [mcpOk],
  sessions: [sessionOk],
  totalTokens: 500,
};

// ---------------------------------------------------------------------------
// TokenUsageSchema
// ---------------------------------------------------------------------------

describe("TokenUsageSchema (Phase 3b)", () => {
  it("accepts a complete token usage record", () => {
    expect(TokenUsageSchema.parse(tokenUsageOk)).toEqual(tokenUsageOk);
  });

  it("rejects negative inputTokens", () => {
    expect(() =>
      TokenUsageSchema.parse({ ...tokenUsageOk, inputTokens: -1 }),
    ).toThrow();
  });

  it("rejects non-integer outputTokens", () => {
    expect(() =>
      TokenUsageSchema.parse({ ...tokenUsageOk, outputTokens: 12.5 }),
    ).toThrow();
  });

  it("rejects a missing totalTokens", () => {
    const { totalTokens: _, ...rest } = tokenUsageOk;
    expect(() => TokenUsageSchema.parse(rest)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ClaudeSessionSchema
// ---------------------------------------------------------------------------

describe("ClaudeSessionSchema (Phase 3b)", () => {
  it("accepts a fully-formed session", () => {
    expect(ClaudeSessionSchema.parse(sessionOk)).toEqual(sessionOk);
  });

  it("accepts a session with null startedAt and lastActivityAt", () => {
    expect(
      ClaudeSessionSchema.parse({
        ...sessionOk,
        startedAt: null,
        lastActivityAt: null,
      }),
    ).toBeTruthy();
  });

  it("rejects an empty id", () => {
    expect(() => ClaudeSessionSchema.parse({ ...sessionOk, id: "" })).toThrow();
  });

  it("rejects an empty projectHash", () => {
    expect(() =>
      ClaudeSessionSchema.parse({ ...sessionOk, projectHash: "" }),
    ).toThrow();
  });

  it("rejects negative messageCount", () => {
    expect(() =>
      ClaudeSessionSchema.parse({ ...sessionOk, messageCount: -1 }),
    ).toThrow();
  });

  it("rejects negative sizeBytes", () => {
    expect(() =>
      ClaudeSessionSchema.parse({ ...sessionOk, sizeBytes: -1 }),
    ).toThrow();
  });

  it("rejects a malformed tokenUsage block", () => {
    expect(() =>
      ClaudeSessionSchema.parse({
        ...sessionOk,
        tokenUsage: { ...tokenUsageOk, inputTokens: -1 },
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ClaudeProjectSchema
// ---------------------------------------------------------------------------

describe("ClaudeProjectSchema (Phase 3b)", () => {
  it("accepts a fully-formed project", () => {
    expect(ClaudeProjectSchema.parse(projectOk)).toEqual(projectOk);
  });

  it("accepts repoSlug=null", () => {
    expect(
      ClaudeProjectSchema.parse({ ...projectOk, repoSlug: null }),
    ).toBeTruthy();
  });

  it("rejects empty hash", () => {
    expect(() =>
      ClaudeProjectSchema.parse({ ...projectOk, hash: "" }),
    ).toThrow();
  });

  it("rejects empty repoPath", () => {
    expect(() =>
      ClaudeProjectSchema.parse({ ...projectOk, repoPath: "" }),
    ).toThrow();
  });

  it("rejects negative totalTokens", () => {
    expect(() =>
      ClaudeProjectSchema.parse({ ...projectOk, totalTokens: -1 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ClaudeSkillSchema / ClaudeAgentSchema
// ---------------------------------------------------------------------------

describe("ClaudeSkillSchema (Phase 3b)", () => {
  it("accepts a fully-formed skill", () => {
    expect(ClaudeSkillSchema.parse(skillOk)).toEqual(skillOk);
  });

  it("accepts an empty description", () => {
    expect(
      ClaudeSkillSchema.parse({ ...skillOk, description: "" }),
    ).toBeTruthy();
  });

  it("rejects an empty name", () => {
    expect(() => ClaudeSkillSchema.parse({ ...skillOk, name: "" })).toThrow();
  });

  it("rejects an empty path", () => {
    expect(() => ClaudeSkillSchema.parse({ ...skillOk, path: "" })).toThrow();
  });

  it("rejects a non-object frontmatter", () => {
    expect(() =>
      ClaudeSkillSchema.parse({ ...skillOk, frontmatter: "x" }),
    ).toThrow();
  });
});

describe("ClaudeAgentSchema (Phase 3b)", () => {
  it("accepts a fully-formed agent", () => {
    expect(ClaudeAgentSchema.parse(agentOk)).toEqual(agentOk);
  });

  it("rejects empty name", () => {
    expect(() => ClaudeAgentSchema.parse({ ...agentOk, name: "" })).toThrow();
  });

  it("rejects empty path", () => {
    expect(() => ClaudeAgentSchema.parse({ ...agentOk, path: "" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ClaudeMcpServerSchema
// ---------------------------------------------------------------------------

describe("ClaudeMcpServerSchema (Phase 3b)", () => {
  it("accepts a fully-formed stdio entry", () => {
    expect(ClaudeMcpServerSchema.parse(mcpOk)).toEqual(mcpOk);
  });

  it("accepts each of the four supported types", () => {
    for (const type of ["stdio", "sse", "http", "unknown"]) {
      expect(ClaudeMcpServerSchema.parse({ ...mcpOk, type })).toBeTruthy();
    }
  });

  it("rejects an unknown type literal", () => {
    expect(() =>
      ClaudeMcpServerSchema.parse({ ...mcpOk, type: "ftp" }),
    ).toThrow();
  });

  it("accepts both configuredIn values", () => {
    expect(
      ClaudeMcpServerSchema.parse({ ...mcpOk, configuredIn: "project" }),
    ).toBeTruthy();
    expect(
      ClaudeMcpServerSchema.parse({ ...mcpOk, configuredIn: "global" }),
    ).toBeTruthy();
  });

  it("rejects an unknown configuredIn value", () => {
    expect(() =>
      ClaudeMcpServerSchema.parse({ ...mcpOk, configuredIn: "bogus" }),
    ).toThrow();
  });

  it("accepts all three status values", () => {
    for (const status of ["configured", "running", "unavailable"]) {
      expect(ClaudeMcpServerSchema.parse({ ...mcpOk, status })).toBeTruthy();
    }
  });

  it("rejects an unknown status value", () => {
    expect(() =>
      ClaudeMcpServerSchema.parse({ ...mcpOk, status: "happy" }),
    ).toThrow();
  });

  it("accepts null command and null args", () => {
    expect(
      ClaudeMcpServerSchema.parse({ ...mcpOk, command: null, args: null }),
    ).toBeTruthy();
  });

  it("rejects empty server name", () => {
    expect(() => ClaudeMcpServerSchema.parse({ ...mcpOk, name: "" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ClaudeRepoStateSchema
// ---------------------------------------------------------------------------

describe("ClaudeRepoStateSchema (Phase 3b)", () => {
  it("accepts a fully-formed repo state", () => {
    expect(ClaudeRepoStateSchema.parse(repoStateOk)).toEqual(repoStateOk);
  });

  it("accepts hasClaude=false with empty arrays", () => {
    expect(
      ClaudeRepoStateSchema.parse({
        ...repoStateOk,
        hasClaude: false,
        claudeMdPath: null,
        claudeMdContent: null,
        settingsPath: null,
        skills: [],
        agents: [],
        mcpServers: [],
        sessions: [],
        totalTokens: 0,
      }),
    ).toBeTruthy();
  });

  it("rejects a non-boolean hasClaude", () => {
    expect(() =>
      ClaudeRepoStateSchema.parse({
        ...repoStateOk,
        hasClaude: "yes" as unknown as boolean,
      }),
    ).toThrow();
  });

  it("rejects negative generatedAt", () => {
    expect(() =>
      ClaudeRepoStateSchema.parse({ ...repoStateOk, generatedAt: -1 }),
    ).toThrow();
  });

  it("rejects an item in skills that is not a valid skill", () => {
    expect(() =>
      ClaudeRepoStateSchema.parse({
        ...repoStateOk,
        skills: [{ ...skillOk, name: "" }],
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Input / output schemas — Index
// ---------------------------------------------------------------------------

describe("ClaudeIndexInputSchema (Phase 3b)", () => {
  it("accepts an empty object", () => {
    expect(ClaudeIndexInputSchema.parse({})).toEqual({});
  });

  it("rejects extra keys", () => {
    expect(() => ClaudeIndexInputSchema.parse({ wat: 1 })).toThrow();
  });
});

describe("ClaudeIndexResultSchema (Phase 3b)", () => {
  it("accepts a complete result", () => {
    expect(
      ClaudeIndexResultSchema.parse({
        projectCount: 1,
        sessionCount: 2,
        totalTokens: 3,
        durationMs: 4,
      }),
    ).toBeTruthy();
  });

  it("rejects negative durationMs", () => {
    expect(() =>
      ClaudeIndexResultSchema.parse({
        projectCount: 1,
        sessionCount: 2,
        totalTokens: 3,
        durationMs: -1,
      }),
    ).toThrow();
  });

  it("rejects a missing projectCount", () => {
    expect(() =>
      ClaudeIndexResultSchema.parse({
        sessionCount: 2,
        totalTokens: 3,
        durationMs: 4,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

describe("ClaudeProjectsInputSchema (Phase 3b)", () => {
  it("accepts an empty object", () => {
    expect(ClaudeProjectsInputSchema.parse({})).toEqual({});
  });

  it("rejects extra keys", () => {
    expect(() => ClaudeProjectsInputSchema.parse({ wat: 1 })).toThrow();
  });
});

describe("ClaudeProjectsResultSchema (Phase 3b)", () => {
  it("accepts an empty list", () => {
    expect(ClaudeProjectsResultSchema.parse({ projects: [] })).toEqual({
      projects: [],
    });
  });

  it("accepts a populated list", () => {
    expect(
      ClaudeProjectsResultSchema.parse({ projects: [projectOk] }),
    ).toBeTruthy();
  });

  it("rejects a malformed project entry", () => {
    expect(() =>
      ClaudeProjectsResultSchema.parse({
        projects: [{ ...projectOk, hash: "" }],
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RepoState
// ---------------------------------------------------------------------------

describe("ClaudeRepoStateInputSchema (Phase 3b)", () => {
  it("accepts { slug: 'x' }", () => {
    expect(ClaudeRepoStateInputSchema.parse({ slug: "x" })).toEqual({
      slug: "x",
    });
  });

  it("rejects an empty slug", () => {
    expect(() => ClaudeRepoStateInputSchema.parse({ slug: "" })).toThrow();
  });

  it("rejects a missing slug", () => {
    expect(() => ClaudeRepoStateInputSchema.parse({})).toThrow();
  });

  it("rejects extra keys", () => {
    expect(() =>
      ClaudeRepoStateInputSchema.parse({ slug: "x", wat: 1 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SessionTranscript
// ---------------------------------------------------------------------------

describe("ClaudeSessionTranscriptInputSchema (Phase 3b)", () => {
  it("accepts sessionId only, defaults cursor=0", () => {
    expect(
      ClaudeSessionTranscriptInputSchema.parse({ sessionId: "s" }),
    ).toEqual({ sessionId: "s", cursor: 0 });
  });

  it("accepts a full payload", () => {
    expect(
      ClaudeSessionTranscriptInputSchema.parse({
        sessionId: "s",
        cursor: 1024,
        maxBytes: 65_536,
      }),
    ).toEqual({ sessionId: "s", cursor: 1024, maxBytes: 65_536 });
  });

  it("rejects empty sessionId", () => {
    expect(() =>
      ClaudeSessionTranscriptInputSchema.parse({ sessionId: "" }),
    ).toThrow();
  });

  it("rejects negative cursor", () => {
    expect(() =>
      ClaudeSessionTranscriptInputSchema.parse({
        sessionId: "s",
        cursor: -1,
      }),
    ).toThrow();
  });

  it("rejects maxBytes < 1024", () => {
    expect(() =>
      ClaudeSessionTranscriptInputSchema.parse({
        sessionId: "s",
        maxBytes: 1023,
      }),
    ).toThrow();
  });

  it("rejects maxBytes > 262144", () => {
    expect(() =>
      ClaudeSessionTranscriptInputSchema.parse({
        sessionId: "s",
        maxBytes: 262_145,
      }),
    ).toThrow();
  });

  it("rejects extra keys", () => {
    expect(() =>
      ClaudeSessionTranscriptInputSchema.parse({
        sessionId: "s",
        wat: 1,
      }),
    ).toThrow();
  });
});

describe("ClaudeSessionTranscriptResultSchema (Phase 3b)", () => {
  it("accepts events with passthrough fields", () => {
    expect(
      ClaudeSessionTranscriptResultSchema.parse({
        events: [
          {
            type: "assistant",
            timestamp: "2026-05-01T10:00:00.000Z",
            uuid: "uuid-1",
            extraField: "is-fine",
          },
        ],
        nextCursor: 100,
        hasMore: true,
      }),
    ).toBeTruthy();
  });

  it("accepts EOF chunk (nextCursor=null, hasMore=false)", () => {
    expect(
      ClaudeSessionTranscriptResultSchema.parse({
        events: [],
        nextCursor: null,
        hasMore: false,
      }),
    ).toBeTruthy();
  });

  it("rejects when events is not an array", () => {
    expect(() =>
      ClaudeSessionTranscriptResultSchema.parse({
        events: "no",
        nextCursor: null,
        hasMore: false,
      }),
    ).toThrow();
  });

  it("rejects when nextCursor is a string", () => {
    expect(() =>
      ClaudeSessionTranscriptResultSchema.parse({
        events: [],
        nextCursor: "100",
        hasMore: true,
      }),
    ).toThrow();
  });

  it("rejects when hasMore is missing", () => {
    expect(() =>
      ClaudeSessionTranscriptResultSchema.parse({
        events: [],
        nextCursor: null,
      }),
    ).toThrow();
  });
});

describe("TranscriptEventSchema (Phase 3b)", () => {
  it("accepts a minimal event with just type", () => {
    expect(TranscriptEventSchema.parse({ type: "user" })).toEqual({
      type: "user",
    });
  });

  it("preserves passthrough fields", () => {
    const parsed = TranscriptEventSchema.parse({
      type: "assistant",
      timestamp: "2026-05-01T10:00:00.000Z",
      uuid: "uuid-1",
      message: { usage: { input_tokens: 5 } },
    });
    expect(parsed.message).toBeTruthy();
  });

  it("rejects when type is missing", () => {
    expect(() =>
      TranscriptEventSchema.parse({ timestamp: "2026-05-01T10:00:00.000Z" }),
    ).toThrow();
  });

  it("rejects when type is not a string", () => {
    expect(() => TranscriptEventSchema.parse({ type: 42 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// GlobalUsage
// ---------------------------------------------------------------------------

describe("ClaudeGlobalUsageInputSchema (Phase 3b)", () => {
  it("accepts an empty object", () => {
    expect(ClaudeGlobalUsageInputSchema.parse({})).toEqual({});
  });

  it("accepts from/to dates", () => {
    expect(
      ClaudeGlobalUsageInputSchema.parse({
        from: "2026-05-01",
        to: "2026-05-13",
      }),
    ).toBeTruthy();
  });

  it("rejects extra keys", () => {
    expect(() =>
      ClaudeGlobalUsageInputSchema.parse({
        from: "2026-05-01",
        wat: 1,
      }),
    ).toThrow();
  });
});

describe("ClaudeGlobalUsageResultSchema (Phase 3b)", () => {
  it("accepts a fully-formed result", () => {
    expect(
      ClaudeGlobalUsageResultSchema.parse({
        totalTokens: 1000,
        byProject: [
          {
            hash: "h1",
            repoPath: "/r/one",
            repoSlug: null,
            totalTokens: 1000,
          },
        ],
        byDay: [{ date: "2026-05-01", totalTokens: 100 }],
        byWeek: [{ weekStart: "2026-05-04", totalTokens: 300 }],
        byMonth: [{ monthStart: "2026-05-01", totalTokens: 1000 }],
      }),
    ).toBeTruthy();
  });

  it("accepts an empty result (all zeros)", () => {
    expect(
      ClaudeGlobalUsageResultSchema.parse({
        totalTokens: 0,
        byProject: [],
        byDay: [],
        byWeek: [],
        byMonth: [],
      }),
    ).toBeTruthy();
  });

  it("rejects negative totalTokens", () => {
    expect(() =>
      ClaudeGlobalUsageResultSchema.parse({
        totalTokens: -1,
        byProject: [],
        byDay: [],
        byWeek: [],
        byMonth: [],
      }),
    ).toThrow();
  });

  it("rejects a byProject entry with empty hash", () => {
    expect(() =>
      ClaudeGlobalUsageResultSchema.parse({
        totalTokens: 0,
        byProject: [
          { hash: "", repoPath: "/r/one", repoSlug: null, totalTokens: 0 },
        ],
        byDay: [],
        byWeek: [],
        byMonth: [],
      }),
    ).toThrow();
  });

  it("rejects a byDay entry with negative tokens", () => {
    expect(() =>
      ClaudeGlobalUsageResultSchema.parse({
        totalTokens: 0,
        byProject: [],
        byDay: [{ date: "2026-05-01", totalTokens: -1 }],
        byWeek: [],
        byMonth: [],
      }),
    ).toThrow();
  });

  // --- ATR-020: optional per-project weekly series -----------------------

  it("accepts a byProject entry carrying its own byWeek series", () => {
    const parsed = ClaudeGlobalUsageResultSchema.parse({
      totalTokens: 300,
      byProject: [
        {
          hash: "h1",
          repoPath: "/r/one",
          repoSlug: "one",
          totalTokens: 300,
          byWeek: [
            { weekStart: "2026-05-04", totalTokens: 100 },
            { weekStart: "2026-05-11", totalTokens: 200 },
          ],
        },
      ],
      byDay: [],
      byWeek: [
        { weekStart: "2026-05-04", totalTokens: 100 },
        { weekStart: "2026-05-11", totalTokens: 200 },
      ],
      byMonth: [],
    });
    expect(parsed.byProject[0]!.byWeek).toHaveLength(2);
  });

  it("stays backward-compatible: byProject.byWeek is optional", () => {
    const parsed = ClaudeGlobalUsageResultSchema.parse({
      totalTokens: 50,
      byProject: [
        { hash: "h1", repoPath: "/r/one", repoSlug: null, totalTokens: 50 },
      ],
      byDay: [],
      byWeek: [],
      byMonth: [],
    });
    expect(parsed.byProject[0]!.byWeek).toBeUndefined();
  });

  it("rejects a per-project byWeek entry with negative tokens", () => {
    expect(() =>
      ClaudeGlobalUsageResultSchema.parse({
        totalTokens: 0,
        byProject: [
          {
            hash: "h1",
            repoPath: "/r/one",
            repoSlug: null,
            totalTokens: 0,
            byWeek: [{ weekStart: "2026-05-04", totalTokens: -5 }],
          },
        ],
        byDay: [],
        byWeek: [],
        byMonth: [],
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Launch / OpenClaudeMd
// ---------------------------------------------------------------------------

describe("ClaudeLaunchInputSchema (Phase 3b)", () => {
  it("accepts slug only", () => {
    expect(ClaudeLaunchInputSchema.parse({ slug: "foo" })).toEqual({
      slug: "foo",
    });
  });

  it("accepts slug + resumeSessionId (uuid) + starterPrompt", () => {
    expect(
      ClaudeLaunchInputSchema.parse({
        slug: "foo",
        resumeSessionId: "f9a3248a-ec0c-4b07-8367-e2ec103dc69f",
        starterPrompt: "hi",
      }),
    ).toBeTruthy();
  });

  it("rejects a non-uuid resumeSessionId (shell-injection guard, ATR-026)", () => {
    expect(() =>
      ClaudeLaunchInputSchema.parse({
        slug: "foo",
        resumeSessionId: "sess-1; rm -rf ~",
      }),
    ).toThrow();
  });

  it("rejects empty slug", () => {
    expect(() => ClaudeLaunchInputSchema.parse({ slug: "" })).toThrow();
  });

  it("rejects missing slug", () => {
    expect(() => ClaudeLaunchInputSchema.parse({})).toThrow();
  });

  it("rejects extra keys", () => {
    expect(() =>
      ClaudeLaunchInputSchema.parse({ slug: "foo", wat: 1 }),
    ).toThrow();
  });
});

describe("ClaudeOpenClaudeMdInputSchema (Phase 3b)", () => {
  it("accepts { slug }", () => {
    expect(ClaudeOpenClaudeMdInputSchema.parse({ slug: "foo" })).toEqual({
      slug: "foo",
    });
  });

  it("rejects empty slug", () => {
    expect(() => ClaudeOpenClaudeMdInputSchema.parse({ slug: "" })).toThrow();
  });

  it("rejects missing slug", () => {
    expect(() => ClaudeOpenClaudeMdInputSchema.parse({})).toThrow();
  });

  it("rejects extra keys", () => {
    expect(() =>
      ClaudeOpenClaudeMdInputSchema.parse({ slug: "foo", wat: 1 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// UpdateEvent
// ---------------------------------------------------------------------------

describe("ClaudeUpdateEventSchema (Phase 3b)", () => {
  it("accepts each of the three reasons", () => {
    for (const reason of [
      "session-added",
      "session-updated",
      "session-removed",
    ]) {
      expect(
        ClaudeUpdateEventSchema.parse({ projectHash: "h1", reason }),
      ).toBeTruthy();
    }
  });

  it("rejects empty projectHash", () => {
    expect(() =>
      ClaudeUpdateEventSchema.parse({
        projectHash: "",
        reason: "session-added",
      }),
    ).toThrow();
  });

  it("rejects an unknown reason", () => {
    expect(() =>
      ClaudeUpdateEventSchema.parse({
        projectHash: "h1",
        reason: "session-renamed",
      }),
    ).toThrow();
  });
});
