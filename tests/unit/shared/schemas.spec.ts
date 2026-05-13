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
    expect(() =>
      TagSchema.parse({ value: "rust", source: "ai" }),
    ).toThrow();
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
