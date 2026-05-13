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
  // ---- Phase 1 additions
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
    schemaVersion: 1,
  };

  it("accepts a fully-populated settings blob", () => {
    expect(SettingsSchema.parse(valid)).toEqual(valid);
  });

  it("accepts each editor enum value", () => {
    for (const editor of ["vscode", "cursor", "none"] as const) {
      expect(
        SettingsSchema.parse({ ...valid, defaultEditor: editor }).defaultEditor,
      ).toBe(editor);
    }
  });

  it("rejects an unknown editor enum value", () => {
    expect(() =>
      SettingsSchema.parse({ ...valid, defaultEditor: "sublime" }),
    ).toThrow();
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
    for (const editor of ["vscode", "cursor", "none"] as const) {
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
    expect(() =>
      // @ts-expect-error - intentionally bad
      ActionSchema.parse({ ...base, scope: "wat" }),
    ).toThrow();
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
      // @ts-expect-error - intentionally bad
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
      // @ts-expect-error - intentionally bad
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
