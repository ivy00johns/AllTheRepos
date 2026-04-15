import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { isolateDataDir } from "../helpers/test-db.js";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp-dir.js";
import type { ScanProgressEvent } from "@/contracts/types";

type ScannerModule = {
  scanPaths: (paths: string[]) => AsyncIterable<ScanProgressEvent>;
};

async function loadScanner(): Promise<ScannerModule> {
  return (await import("@/lib/git/scanner")) as unknown as ScannerModule;
}

async function initFakeRepo(dir: string, name: string): Promise<string> {
  const repoPath = path.join(dir, name);
  fs.mkdirSync(repoPath, { recursive: true });
  fs.writeFileSync(
    path.join(repoPath, "README.md"),
    `# ${name}\n\nfixture repo for scanner tests\n`,
  );
  const git = simpleGit(repoPath);
  await git.init();
  // Ensure a deterministic default branch name across git versions.
  try {
    await git.raw(["symbolic-ref", "HEAD", "refs/heads/main"]);
  } catch {
    /* ignore — git < 2.28 fallback */
  }
  await git.addConfig("user.email", "tester@example.com", false, "local");
  await git.addConfig("user.name", "Tester", false, "local");
  await git.add(["README.md"]);
  await git.commit("initial", { "--allow-empty": null });
  return repoPath;
}

async function collect(
  iter: AsyncIterable<ScanProgressEvent>,
): Promise<ScanProgressEvent[]> {
  const out: ScanProgressEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe("git/scanner — contracts/api.md scanPaths()", () => {
  let isolate: { dir: string; cleanup(): void } | null = null;
  let tmpRoot: string | null = null;

  beforeEach(async () => {
    vi.resetModules();
    isolate = isolateDataDir();
    tmpRoot = makeTmpDir("atr-scan");
    const { getDb } = await import("@/lib/db/client");
    getDb();
  });

  afterEach(() => {
    cleanupTmp(tmpRoot);
    isolate?.cleanup();
    tmpRoot = null;
    isolate = null;
  });

  it("emits started → discovered×N → indexed×N → completed and populates DB", async () => {
    await initFakeRepo(tmpRoot!, "repo-one");
    await initFakeRepo(tmpRoot!, "repo-two");

    const { scanPaths } = await loadScanner();
    const events = await collect(scanPaths([tmpRoot!]));

    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe("started");
    expect(kinds[kinds.length - 1]).toBe("completed");

    const discovered = events.filter((e) => e.kind === "discovered");
    const indexed = events.filter((e) => e.kind === "indexed");
    expect(discovered.length).toBe(2);
    expect(indexed.length).toBe(2);

    const completed = events[events.length - 1];
    expect(completed.kind).toBe("completed");
    if (completed.kind === "completed") {
      expect(completed.scanned).toBe(2);
      expect(completed.errors).toBe(0);
    }

    const { getSqlite } = await import("@/lib/db/client");
    const rows = getSqlite()
      .prepare(
        "SELECT slug, name, full_path FROM repos ORDER BY name",
      )
      .all() as Array<{ slug: string; name: string; full_path: string }>;
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.slug).toBeTruthy();
      expect(row.name).toBeTruthy();
      expect(row.full_path).toBeTruthy();
      expect(path.isAbsolute(row.full_path)).toBe(true);
    }
  });

  it("is idempotent — rescanning updates instead of duplicating", async () => {
    await initFakeRepo(tmpRoot!, "idem-a");

    const { scanPaths } = await loadScanner();

    const first = await collect(scanPaths([tmpRoot!]));
    const firstCompleted = first[first.length - 1];
    expect(firstCompleted.kind).toBe("completed");
    if (firstCompleted.kind === "completed") {
      expect(firstCompleted.scanned).toBe(1);
      expect(firstCompleted.added).toBe(1);
    }

    const second = await collect(scanPaths([tmpRoot!]));
    const secondCompleted = second[second.length - 1];
    expect(secondCompleted.kind).toBe("completed");
    if (secondCompleted.kind === "completed") {
      expect(secondCompleted.scanned).toBe(1);
      expect(secondCompleted.added).toBe(0);
      expect(secondCompleted.updated).toBe(1);
    }

    const { getSqlite } = await import("@/lib/db/client");
    const count = getSqlite()
      .prepare("SELECT COUNT(*) as n FROM repos")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });
});
