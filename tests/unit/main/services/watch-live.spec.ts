/**
 * End-to-end test for live watching — real chokidar, real directories,
 * real SQLite.
 *
 * The ignore predicate is unit-tested separately; this proves the whole
 * loop actually fires: a repo created on disk gets indexed into the
 * catalog without anyone running a scan, and a repo that disappears is
 * reported rather than deleted.
 *
 * Timing-sensitive by nature, so assertions poll rather than sleeping a
 * fixed amount.
 *
 * !!! REAL better-sqlite3 DB + REAL fs watchers !!! Needs host-ABI natives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { isolateDataDir } from "../../../helpers/test-db.js";

let userDataDir = "";
vi.mock("electron", () => ({ app: { getPath: () => userDataDir } }));

// Embeddings are best-effort enrichment and would reach for Ollama.
vi.mock("@main/services/embedding", () => ({
  indexRepoEmbedding: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@main/services/lance", () => ({
  deleteEmbedding: vi.fn().mockResolvedValue(undefined),
}));

let isolate: { dir: string; cleanup(): void } | null = null;
let root = "";

/** A real git repo — the indexer reads actual git metadata. */
function makeGitRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# probe\n\nA probe repo.\n");
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      stdio: "ignore",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
    });
  git("init", "-q");
  git("config", "user.email", "probe@example.com");
  git("config", "user.name", "Probe");
  git("add", ".");
  git("commit", "-qm", "init");
}

/** Poll until `check` passes or the budget runs out. */
async function waitFor(
  check: () => Promise<boolean> | boolean,
  timeoutMs = 20_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function slugsInCatalog(): Promise<string[]> {
  const { getSqlite } = await import("@main/db/client");
  const rows = getSqlite()
    .prepare("SELECT slug FROM repos ORDER BY slug")
    .all() as Array<{ slug: string }>;
  return rows.map((r) => r.slug);
}

describe("repoWatchService (live)", () => {
  beforeEach(async () => {
    isolate = isolateDataDir();
    userDataDir = isolate.dir;
    root = path.join(isolate.dir, "Repos");
    fs.mkdirSync(root, { recursive: true });

    const { closeDb, getDb } = await import("@main/db/client");
    closeDb();
    getDb();

    const { updateSettings, resetSettingsCache } =
      await import("@main/services/settings");
    resetSettingsCache();
    updateSettings({ scanPaths: [root] });
  });

  afterEach(async () => {
    const { repoWatchService } = await import("@main/services/watch");
    await repoWatchService.stop();
    const { closeDb } = await import("@main/db/client");
    closeDb();
    const { resetSettingsCache } = await import("@main/services/settings");
    resetSettingsCache();
    isolate?.cleanup();
    isolate = null;
  });

  it("indexes a repo that appears on disk, with no manual scan", async () => {
    const { repoWatchService } = await import("@main/services/watch");
    const events: unknown[] = [];
    repoWatchService.onChange((event) => events.push(event));
    repoWatchService.start();

    // Give chokidar a moment to finish its initial walk before mutating.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    makeGitRepo(path.join(root, "appeared"));

    const indexed = await waitFor(async () =>
      (await slugsInCatalog()).some((slug) => slug.startsWith("appeared-")),
    );
    expect(indexed).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  }, 40_000);

  it("reports a vanished repo without deleting its catalog row", async () => {
    const { repoWatchService } = await import("@main/services/watch");
    const gone = path.join(root, "vanisher");
    makeGitRepo(gone);

    // Seed the row the way a scan would, then start watching.
    const { indexRepoAtPath } = await import("@main/services/indexer");
    const seeded = await indexRepoAtPath(gone);
    expect(seeded).not.toBeNull();

    const events: Array<{ vanished: string[] }> = [];
    repoWatchService.onChange((event) =>
      events.push(event as { vanished: string[] }),
    );
    repoWatchService.start();
    await new Promise((resolve) => setTimeout(resolve, 1500));

    fs.rmSync(gone, { recursive: true, force: true });

    const reported = await waitFor(() =>
      events.some((e) => e.vanished.includes(seeded!.slug)),
    );
    expect(reported).toBe(true);
    // Reported, NOT deleted — the row keeps its tags and group links,
    // and renders as missing because `missing` is computed at read time.
    expect(await slugsInCatalog()).toContain(seeded!.slug);
  }, 40_000);

  it("drops events raised while suppressed", async () => {
    const { repoWatchService } = await import("@main/services/watch");
    const events: unknown[] = [];
    repoWatchService.onChange((event) => events.push(event));
    repoWatchService.start();
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // The app's own moves already update the catalog; re-reacting to
    // them is redundant work and a UI flicker.
    await repoWatchService.suppressed(async () => {
      makeGitRepo(path.join(root, "quiet"));
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    await new Promise((resolve) => setTimeout(resolve, 2500));

    expect(events).toHaveLength(0);
  }, 40_000);
});
