import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp-dir.js";
import type { LanguageBytes, Tag } from "@/contracts/types";

/**
 * Heuristic tagger contract (per contracts/README.md rule #5: tag source is
 * "heuristic" for parser-derived tags).
 *
 * Backend exposes:
 *   heuristicTagsForRepo({fullPath, languages, readmeContent}): Tag[]
 */

interface HeuristicInput {
  fullPath: string;
  languages: LanguageBytes[];
  readmeContent: string | null;
}

interface HeuristicModule {
  heuristicTagsForRepo: (input: HeuristicInput) => Tag[];
}

async function loadHeuristic(): Promise<HeuristicModule> {
  return (await import("@/lib/tag/heuristic")) as unknown as HeuristicModule;
}

function values(tags: Tag[]): string[] {
  return tags.map((t) => t.value);
}

describe("tag/heuristic — contracts/README.md rule #5 (heuristic tag source)", () => {
  let root: string | null = null;

  beforeEach(() => {
    root = makeTmpDir("atr-tag");
  });

  afterEach(() => {
    cleanupTmp(root);
    root = null;
  });

  function write(rel: string, contents: string): void {
    const full = path.join(root!, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }

  function call(): Tag[] {
    // synchronous — load once per test via top-level dynamic import result
    return (heuristicTagsForRepo as unknown as (
      i: HeuristicInput,
    ) => Tag[])({
      fullPath: root!,
      languages: [],
      readmeContent: null,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let heuristicTagsForRepo: any;

  beforeEach(async () => {
    const mod = await loadHeuristic();
    heuristicTagsForRepo = mod.heuristicTagsForRepo;
  });

  it("package.json with next + react dependency tags both", () => {
    write(
      "package.json",
      JSON.stringify({
        name: "app",
        dependencies: { next: "15.0.0", react: "19.0.0" },
      }),
    );
    const tags = values(call());
    expect(tags).toContain("next");
    expect(tags).toContain("react");
    expect(tags).toContain("node");
    // All tags must report heuristic source per domain rule #5.
    for (const t of call()) expect(t.source).toBe("heuristic");
  });

  it("Cargo.toml with tauri tags rust + tauri", () => {
    write(
      "Cargo.toml",
      `[package]\nname = "app"\nversion = "0.1.0"\n\n[dependencies]\ntauri = "2"\n`,
    );
    const tags = values(call());
    expect(tags).toContain("rust");
    expect(tags).toContain("tauri");
  });

  it("go.mod with gin tags go + gin", () => {
    write(
      "go.mod",
      `module x\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.10.0\n`,
    );
    const tags = values(call());
    expect(tags).toContain("go");
    expect(tags).toContain("gin");
  });

  it("Dockerfile present tags docker", () => {
    write("Dockerfile", `FROM node:20\n`);
    const tags = values(call());
    expect(tags).toContain("docker");
  });

  it("pnpm-workspace.yaml present tags monorepo", () => {
    write("pnpm-workspace.yaml", `packages:\n  - packages/*\n`);
    write("package.json", JSON.stringify({ name: "root", private: true }));
    const tags = values(call());
    expect(tags).toContain("monorepo");
  });

  it("empty repo returns empty (or language-only) array without crashing", () => {
    const tags = call();
    expect(Array.isArray(tags)).toBe(true);
    // Count is bounded per implementation cap.
    expect(tags.length).toBeLessThanOrEqual(12);
  });
});
