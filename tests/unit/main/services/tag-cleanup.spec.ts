/**
 * Tag cleanup against a REAL isolated catalog (better-sqlite3).
 *
 * The contract under test (docs/plans/2026-10-10-useful-repo-tags.md, step 3):
 * - the preview is read-only;
 * - accept writes the proposed heuristic set and keeps the user's tags;
 * - reject is remembered, so a later rescan neither re-adds a rejected tag nor
 *   drops a tag the user chose to keep;
 * - a repo whose folder is missing is never re-tagged, because re-tagging would
 *   strip every heuristic tag.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { isolateDataDir } from "../../../helpers/test-db.js";
import { makeTmpDir, cleanupTmp } from "../../../helpers/tmp-dir.js";
import type { UpsertRepoInput } from "@main/db/queries";
import { applyTagRejections } from "@main/services/tag";
import type { Tag } from "@shared/types";

let isolate: { dir: string; cleanup(): void } | null = null;
const folders: string[] = [];

function makeFolder(files: Record<string, string>): string {
  const root = makeTmpDir("atr-tag-cleanup");
  folders.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

function upsertInput(
  slug: string,
  fullPath: string,
  heuristicTags: Tag[],
): UpsertRepoInput {
  return {
    slug,
    name: slug,
    fullPath,
    remoteUrl: null,
    defaultBranch: "main",
    currentBranch: "main",
    lastCommitHash: null,
    lastCommitDate: "2026-01-01T00:00:00.000Z",
    lastCommitMsg: "init",
    isDirty: false,
    primaryLanguage: "TypeScript",
    languages: [{ name: "TypeScript", bytes: 100, color: "#3178c6" }],
    heuristicTags,
    description: null,
    readmeContent: null,
    readmeHash: null,
    sizeBytes: 100,
  };
}

async function boot() {
  const client = await import("@main/db/client");
  client.closeDb();
  client.getDb();
  const queries = await import("@main/db/queries");
  const cleanup = await import("@main/services/tag-cleanup");
  return {
    sqlite: client.getSqlite(),
    upsertRepo: queries.upsertRepo,
    previewTagCleanup: cleanup.previewTagCleanup,
    applyTagCleanup: cleanup.applyTagCleanup,
  };
}

function storedTags(
  sqlite: ReturnType<typeof import("@main/db/client").getSqlite>,
  slug: string,
): Tag[] {
  const row = sqlite
    .prepare("SELECT tags_json FROM repos WHERE slug = ?")
    .get(slug) as { tags_json: string };
  return JSON.parse(row.tags_json) as Tag[];
}

const STALE_JSON: Tag[] = [{ value: "json", source: "heuristic" }];

describe("tag cleanup — preview, accept, reject", () => {
  beforeEach(() => {
    isolate = isolateDataDir();
  });

  afterEach(async () => {
    const client = await import("@main/db/client");
    client.closeDb();
    isolate?.cleanup();
    isolate = null;
    for (const f of folders.splice(0)) cleanupTmp(f);
  });

  it("the preview proposes the change but writes nothing", async () => {
    const { sqlite, upsertRepo, previewTagCleanup } = await boot();
    const dir = makeFolder({
      "package.json": JSON.stringify({
        name: "a",
        dependencies: { react: "19.0.0" },
      }),
    });
    upsertRepo(upsertInput("alpha-000001", dir, STALE_JSON));

    const preview = previewTagCleanup();
    const proposal = preview.proposals.find((p) => p.slug === "alpha-000001");
    expect(proposal?.removed).toEqual(["json"]);
    expect(proposal?.added).toEqual(
      expect.arrayContaining(["web-app", "react"]),
    );

    expect(storedTags(sqlite, "alpha-000001")).toEqual(STALE_JSON);
  });

  it("accept writes the proposed set, keeps user tags, and is idempotent", async () => {
    const { sqlite, upsertRepo, previewTagCleanup, applyTagCleanup } =
      await boot();
    const dir = makeFolder({
      "package.json": JSON.stringify({
        name: "a",
        dependencies: { react: "19.0.0" },
      }),
    });
    upsertRepo(upsertInput("alpha-000002", dir, STALE_JSON));
    sqlite
      .prepare("UPDATE repos SET tags_json = ? WHERE slug = ?")
      .run(
        JSON.stringify([{ value: "mine", source: "user" }, ...STALE_JSON]),
        "alpha-000002",
      );

    const result = applyTagCleanup({
      decisions: [{ slug: "alpha-000002", decision: "accept" }],
    });
    expect(result).toEqual({ accepted: 1, rejected: 0, skipped: [] });

    const after = storedTags(sqlite, "alpha-000002");
    expect(after[0]).toEqual({ value: "mine", source: "user" });
    expect(after.map((t) => t.value)).not.toContain("json");
    expect(after.map((t) => t.value)).toContain("web-app");

    expect(previewTagCleanup().proposals.map((p) => p.slug)).not.toContain(
      "alpha-000002",
    );
  });

  it("reject is remembered: a rescan neither re-adds it nor drops a kept tag", async () => {
    const { sqlite, upsertRepo, previewTagCleanup, applyTagCleanup } =
      await boot();
    const dir = makeFolder({
      "package.json": JSON.stringify({
        name: "b",
        dependencies: { react: "19.0.0" },
      }),
    });
    upsertRepo(upsertInput("beta-000003", dir, STALE_JSON));

    applyTagCleanup({
      decisions: [{ slug: "beta-000003", decision: "reject" }],
    });

    // The stale `json` is kept on purpose, and the rules' additions stay off.
    expect(previewTagCleanup().proposals.map((p) => p.slug)).not.toContain(
      "beta-000003",
    );

    // A rescan that recomputes the rules' tags must honour both answers.
    upsertRepo(
      upsertInput("beta-000003", dir, [
        { value: "web-app", source: "heuristic" },
        { value: "react", source: "heuristic" },
      ]),
    );
    expect(storedTags(sqlite, "beta-000003").map((t) => t.value)).toEqual([
      "json",
    ]);
  });

  it("a repo whose folder is missing is left alone, never re-tagged", async () => {
    const { sqlite, upsertRepo, previewTagCleanup, applyTagCleanup } =
      await boot();
    const dir = makeFolder({
      "package.json": JSON.stringify({
        name: "c",
        dependencies: { react: "19.0.0" },
      }),
    });
    upsertRepo(upsertInput("gamma-00004", dir, STALE_JSON));
    fs.rmSync(dir, { recursive: true, force: true });

    const preview = previewTagCleanup();
    expect(preview.proposals.map((p) => p.slug)).not.toContain("gamma-00004");
    expect(preview.unreadable).toBeGreaterThanOrEqual(1);

    const result = applyTagCleanup({
      decisions: [{ slug: "gamma-00004", decision: "accept" }],
    });
    expect(result.skipped).toEqual(["gamma-00004"]);
    expect(storedTags(sqlite, "gamma-00004")).toEqual(STALE_JSON);
  });

  it("an unknown slug is reported as skipped, not written", async () => {
    const { applyTagCleanup } = await boot();
    const result = applyTagCleanup({
      decisions: [{ slug: "nope-000000", decision: "accept" }],
    });
    expect(result).toEqual({
      accepted: 0,
      rejected: 0,
      skipped: ["nope-000000"],
    });
  });
});

describe("applyTagRejections — the rule shared by the preview and the rescan", () => {
  it("a rejected addition stays off", () => {
    const out = applyTagRejections(
      [{ value: "web-app", source: "heuristic" }],
      [],
      new Map([["web-app", "add"]]),
    );
    expect(out).toEqual([]);
  });

  it("a kept tag stays on even when the rules no longer infer it", () => {
    const out = applyTagRejections(
      [{ value: "web-app", source: "heuristic" }],
      [{ value: "json", source: "heuristic" }],
      new Map([["json", "keep"]]),
    );
    expect(out.map((t) => t.value)).toEqual(["json", "web-app"]);
  });

  it("user tags are never restored as heuristics", () => {
    const out = applyTagRejections(
      [],
      [{ value: "mine", source: "user" }],
      new Map([["mine", "keep"]]),
    );
    expect(out).toEqual([]);
  });
});
