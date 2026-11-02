/**
 * Finding a repo by the site it serves.
 *
 * The arrangement copies the real failure: a repo named PlainNamedRepo serves
 * `randomtoolbox.<account>.workers.dev`, and a retired repo named RandomToolbox
 * says "randomtoolbox" all over its README. Searching for the site used to return
 * the retired repo and never the one serving it.
 *
 * !!! REAL better-sqlite3 DB !!! Needs host-ABI natives. The vector store is
 * mocked; the FTS half and the `readRepoMetadata` read are real.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const vectorSearch = vi.fn<
  (vec: number[], limit: number) => Array<{ slug: string; score: number }>
>(() => []);

vi.mock("@main/services/vector-store", () => ({
  vectorStoreStatus: () => ({ available: true, version: "v0", reason: null }),
  vectorSearch: (vec: number[], limit: number) => vectorSearch(vec, limit),
  getEmbeddingContentHash: () => null,
  upsertEmbedding: vi.fn(),
  deleteEmbedding: vi.fn(),
  countEmbeddings: () => 0,
  resetVectorStoreCache: vi.fn(),
}));

vi.mock("@main/services/settings", () => ({
  getSettings: () => ({
    ollamaBaseUrl: "http://127.0.0.1:1",
    ollamaEmbedModel: "nomic-embed-text",
    openaiEmbedModel: null,
  }),
}));

vi.mock("@main/services/embedding", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@main/services/embedding")>();
  return { ...actual, embed: vi.fn(async () => new Array(768).fill(0.1)) };
});

import { closeDb, getDb, getSqlite } from "@main/db/client";
import { upsertRepo, type UpsertRepoInput } from "@main/db/queries";
import { embed } from "@main/services/embedding";
import { readRepoMetadata } from "@main/services/metadata";
import { hybridSearch } from "@main/services/search";

import { isolateDataDir } from "../../../helpers/test-db.js";
import { cleanupTmp, makeTmpDir } from "../../../helpers/tmp-dir.js";

function input(overrides: Partial<UpsertRepoInput>): UpsertRepoInput {
  return {
    slug: "repo",
    name: "repo",
    fullPath: "/repos/repo",
    remoteUrl: null,
    defaultBranch: "main",
    currentBranch: "main",
    lastCommitHash: null,
    lastCommitDate: null,
    lastCommitMsg: null,
    isDirty: false,
    primaryLanguage: null,
    languages: [],
    heuristicTags: [],
    description: null,
    readmeContent: null,
    readmeHash: null,
    sizeBytes: null,
    ...overrides,
  };
}

function names(hits: Array<{ repo: { name: string } }>): string[] {
  return hits.map((hit) => hit.repo.name);
}

function seedTheRealFailure(): void {
  upsertRepo(
    input({
      slug: "retired",
      name: "RandomToolbox",
      fullPath: "/repos/RandomToolbox",
      description: "Main landing page for all Random Toolbox services.",
      readmeContent:
        "# RandomToolbox\n\nrandomtoolbox randomtoolbox randomtoolbox.tech randomtoolbox",
    }),
  );
  upsertRepo(
    input({
      slug: "serving",
      name: "PlainNamedRepo",
      fullPath: "/repos/PlainNamedRepo",
      description: "An unrelated description",
      readmeContent: "# Plain Named Repo",
      deployText: "randomtoolbox",
    }),
  );
}

let isolate: { dir: string; cleanup(): void };

beforeEach(() => {
  isolate = isolateDataDir();
  closeDb();
  getDb();
  vectorSearch.mockReset().mockReturnValue([]);
  vi.mocked(embed).mockClear();
});

afterEach(() => {
  closeDb();
  isolate.cleanup();
});

describe("searching for a deployed site", () => {
  it("resolves a pasted workers.dev URL to the repo serving it, and only that", async () => {
    seedTheRealFailure();
    const { hits } = await hybridSearch({
      query: "https://randomtoolbox.some-account.workers.dev",
    });
    expect(names(hits)).toEqual(["PlainNamedRepo"]);
  });

  it("does not let vector neighbours in beside a definite deploy match", async () => {
    seedTheRealFailure();
    vectorSearch.mockReturnValue([{ slug: "retired", score: 0.9 }]);
    const { hits, semantic } = await hybridSearch({
      query: "randomtoolbox.some-account.workers.dev",
    });
    expect(names(hits)).toEqual(["PlainNamedRepo"]);
    expect(embed).not.toHaveBeenCalled();
    expect(semantic).toEqual({
      state: "off",
      reason: "requested",
      detail: null,
    });
  });

  it("puts the serving repo above READMEs that only mention the word", async () => {
    seedTheRealFailure();
    const { hits } = await hybridSearch({ query: "randomtoolbox" });
    expect(names(hits)).toEqual(["PlainNamedRepo", "RandomToolbox"]);
  });

  it("keeps the serving repo first even when vectors favour the other", async () => {
    seedTheRealFailure();
    vectorSearch.mockReturnValue([{ slug: "retired", score: 0.9 }]);
    const { hits } = await hybridSearch({ query: "randomtoolbox" });
    expect(names(hits)).toEqual(["PlainNamedRepo", "RandomToolbox"]);
  });

  it("promotes on a whole word, not on a prefix of a Worker's name", async () => {
    upsertRepo(
      input({
        slug: "readme",
        name: "Notes",
        fullPath: "/repos/notes",
        readmeContent: "pro pro pro",
      }),
    );
    upsertRepo(
      input({
        slug: "worker",
        name: "Unrelated",
        fullPath: "/repos/unrelated",
        deployText: "prod-worker",
      }),
    );
    const { hits } = await hybridSearch({ query: "pro" });
    expect(names(hits)[0]).toBe("Notes");
  });

  it("falls back to ordinary search when no repo deploys to that URL", async () => {
    upsertRepo(
      input({
        slug: "docs",
        name: "Docs",
        fullPath: "/repos/docs",
        readmeContent: "See nowhere.example for the write-up.",
      }),
    );
    const { hits } = await hybridSearch({ query: "nowhere.example" });
    expect(names(hits)).toEqual(["Docs"]);
    expect(embed).toHaveBeenCalled();
  });

  it("forgets a deploy target once the repo stops declaring it", async () => {
    seedTheRealFailure();
    upsertRepo(
      input({
        slug: "serving",
        name: "PlainNamedRepo",
        fullPath: "/repos/PlainNamedRepo",
        deployText: null,
      }),
    );
    const { hits } = await hybridSearch({
      query: "randomtoolbox.some-account.workers.dev",
    });
    expect(names(hits)).not.toContain("PlainNamedRepo");
  });
});

describe("a catalog from before this column existed", () => {
  it("is rebuilt in place on boot, keeping every repo searchable", () => {
    const sqlite = getSqlite();
    upsertRepo(
      input({ slug: "kept", name: "KeptRepo", fullPath: "/repos/kept" }),
    );
    // Put the index back to the shape a released build left behind.
    sqlite.exec(`
      DROP TRIGGER repos_fts_insert;
      DROP TRIGGER repos_fts_update;
      DROP TRIGGER repos_fts_delete;
      DROP TABLE repos_fts;
      CREATE VIRTUAL TABLE repos_fts USING fts5(
        slug UNINDEXED, name, description, readme_content, tags_text,
        tokenize = 'porter unicode61'
      );
      INSERT INTO repos_fts(slug, name, description, readme_content, tags_text)
        SELECT slug, name, '', '', '' FROM repos;
      ALTER TABLE repos DROP COLUMN deploy_text;
    `);
    closeDb();
    getDb();

    const reopened = getSqlite();
    const columns = reopened
      .prepare("PRAGMA table_info(repos_fts)")
      .all() as Array<{ name: string }>;
    expect(columns.map((c) => c.name)).toContain("deploy_text");
    expect(
      reopened
        .prepare("SELECT slug FROM repos_fts WHERE repos_fts MATCH 'keptrepo'")
        .all(),
    ).toEqual([{ slug: "kept" }]);

    // And the rebuilt triggers write the new column.
    upsertRepo(
      input({
        slug: "kept",
        name: "KeptRepo",
        fullPath: "/repos/kept",
        deployText: "kept-worker",
      }),
    );
    expect(
      reopened
        .prepare(
          `SELECT slug FROM repos_fts WHERE repos_fts MATCH 'deploy_text : "kept-worker"'`,
        )
        .all(),
    ).toEqual([{ slug: "kept" }]);
  });
});

describe("readRepoMetadata", () => {
  function repoWith(files: Record<string, string>): string {
    const dir = makeTmpDir("deploy-metadata");
    execFileSync("git", ["init", "-q"], { cwd: dir });
    for (const [rel, text] of Object.entries(files)) {
      const fp = path.join(dir, rel);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, text);
    }
    return dir;
  }

  it("collects root and nested configs, and skips build output and dependencies", async () => {
    const dir = repoWith({
      "wrangler.jsonc": `{ "name": "root-worker" }`,
      "workers/telemetry/wrangler.toml": `name = "nested-worker"`,
      "dist/server/wrangler.json": `{ "name": "built-copy" }`,
      "node_modules/pkg/wrangler.toml": `name = "dependency"`,
      ".wrangler/tmp/wrangler.json": `{ "name": "scratch" }`,
    });
    try {
      const { metadata } = await readRepoMetadata(dir);
      expect(metadata.deployText?.split(" ").sort()).toEqual([
        "nested-worker",
        "root-worker",
      ]);
    } finally {
      cleanupTmp(dir);
    }
  });

  it("is null for a repo with no deploy config", async () => {
    const dir = repoWith({ "README.md": "# nothing" });
    try {
      const { metadata } = await readRepoMetadata(dir);
      expect(metadata.deployText).toBeNull();
    } finally {
      cleanupTmp(dir);
    }
  });
});
