import { createRequire } from "node:module";
import type { ScanProgressEvent, Tag } from "@/lib/types";

// Load the native addon via CJS require — Vite/ESM cannot import .node directly.
const requireCjs = createRequire(import.meta.url);
const findGitRepos: (rootPath: string, cb?: (paths: string[]) => void) => Promise<string[]> =
  requireCjs("find-git-repositories");
import {
  upsertRepo,
  type UpsertRepoInput,
} from "@/lib/db/queries";
import { heuristicTagsForRepo } from "@/lib/tag/heuristic";
import {
  canonicalPath,
  readRepoMetadata,
  slugFromNameAndPath,
} from "./metadata";

/**
 * Scan one or more root paths for `.git` directories, then read per-repo metadata.
 *
 * Emits ScanProgressEvent objects exactly per contract:
 *   - started        (once, at entry)
 *   - discovered     (per repo found, before indexing)
 *   - indexed        (per repo, after DB upsert)
 *   - error          (per failed path — scan continues)
 *   - completed      (final, always)
 */
export async function* scanPaths(
  paths: string[],
): AsyncGenerator<ScanProgressEvent> {
  const startedAt = Date.now();
  const totalPaths = paths.length;
  yield { kind: "started", totalPaths };

  const discovered: string[] = [];
  const seen = new Set<string>();

  for (const raw of paths) {
    if (!raw || typeof raw !== "string") continue;
    const root = canonicalPath(raw);
    try {
      // find-git-repositories requires a progress callback even when the
      // promise resolves to the full list; pass a no-op so it doesn't throw.
      const found = (await findGitRepos(root, () => {})) as string[];
      for (const gitDir of found) {
        const canonical = canonicalPath(
          gitDir.endsWith("/.git") ? gitDir.slice(0, -5) : gitDir,
        );
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        discovered.push(gitDir);
      }
    } catch (err) {
      yield {
        kind: "error",
        fullPath: root,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const totalFound = discovered.length;
  let added = 0;
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < discovered.length; i++) {
    const gitDir = discovered[i];
    const index = i + 1;
    try {
      const { fullPath, metadata } = await readRepoMetadata(gitDir);
      yield {
        kind: "discovered",
        fullPath,
        index,
        totalFound,
      };

      const heuristicTags: Tag[] = heuristicTagsForRepo({
        fullPath,
        languages: metadata.languages,
        readmeContent: metadata.readmeContent,
      });

      const slug = slugFromNameAndPath(metadata.name, fullPath);

      const input: UpsertRepoInput = {
        slug,
        name: metadata.name,
        fullPath,
        remoteUrl: metadata.remoteUrl,
        defaultBranch: metadata.defaultBranch,
        currentBranch: metadata.currentBranch,
        lastCommitHash: metadata.lastCommitHash,
        lastCommitDate: metadata.lastCommitDate,
        lastCommitMsg: metadata.lastCommitMsg,
        isDirty: metadata.isDirty,
        primaryLanguage: metadata.primaryLanguage,
        languages: metadata.languages,
        heuristicTags,
        description: metadata.description,
        readmeContent: metadata.readmeContent,
        readmeHash: metadata.readmeHash,
        sizeBytes: metadata.sizeBytes,
      };

      const { row, created } = upsertRepo(input);
      if (created) added++;
      else updated++;

      yield {
        kind: "indexed",
        slug: row.slug,
        name: row.name,
        index,
        totalFound,
      };
    } catch (err) {
      errors++;
      yield {
        kind: "error",
        fullPath: gitDir,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  yield {
    kind: "completed",
    scanned: totalFound,
    added,
    updated,
    errors,
    durationMs: Date.now() - startedAt,
  };
}
