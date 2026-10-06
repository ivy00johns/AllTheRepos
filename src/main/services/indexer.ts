/**
 * Single-repo indexing.
 *
 * Extracted so the bulk scanner and the live filesystem watcher agree,
 * by construction, on what "index this repo" means. Before this existed
 * the scanner owned that logic inline; a watcher with its own copy would
 * have drifted the moment either side gained a field.
 *
 * Two entry points:
 *   - `indexRepoFromMetadata` — the scanner already read the metadata in
 *     its worker thread, so it hands it straight over.
 *   - `indexRepoAtPath` — the watcher only has a path, so it reads the
 *     metadata itself first.
 *
 * Moves are handled for free: `upsertRepo` matches an incoming repo
 * against "ghost" rows whose path no longer exists (by remote URL, or by
 * name + commit hash when there's no remote), so a repo relocated in the
 * Finder updates its row instead of duplicating it — tags, groups and
 * all.
 */

import fs from "node:fs";
import path from "node:path";

import type { Repo } from "@shared/types";

import { rowToRepo, upsertRepo, type UpsertRepoInput } from "@main/db/queries";
import { indexRepoEmbedding } from "@main/services/embedding";
import {
  readRepoMetadata,
  slugFromNameAndPath,
  type RepoMetadata,
} from "@main/services/metadata";
import { inferTags } from "@main/services/tag";

/** True when `dir` is the root of a git repo (worktrees included). */
export function isRepoDir(dir: string): boolean {
  try {
    // A linked worktree or submodule has `.git` as a FILE containing a
    // gitdir pointer, so testing for a directory alone would miss them.
    return fs.existsSync(path.join(dir, ".git"));
  } catch {
    return false;
  }
}

/**
 * Upsert a repo from metadata that has already been read.
 *
 * The embedding write is fire-and-forget: the row and its FTS entry are
 * the source of truth, and a slow or absent Ollama must never hold up
 * indexing.
 */
export function indexRepoFromMetadata(
  fullPath: string,
  slugHint: string,
  metadata: RepoMetadata,
): Repo {
  const heuristicTags = inferTags({
    fullPath,
    languages: metadata.languages,
    readmeContent: metadata.readmeContent,
  });

  const input: UpsertRepoInput = {
    slug: slugHint,
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

  const { row } = upsertRepo(input);

  void indexRepoEmbedding({
    repoId: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    readmeContent: metadata.readmeContent,
  }).catch((error) => {
    console.error("[indexer] embedding index error", error);
  });

  return rowToRepo(row);
}

/**
 * Read and index the repo at `fullPath`.
 *
 * Returns `null` when the path isn't a repo (or vanished mid-flight),
 * which the watcher treats as "nothing to do" rather than an error —
 * directories appear and disappear all the time during a checkout.
 */
export async function indexRepoAtPath(fullPath: string): Promise<Repo | null> {
  if (!isRepoDir(fullPath)) return null;
  try {
    const { fullPath: root, metadata } = await readRepoMetadata(fullPath);
    const slugHint = slugFromNameAndPath(metadata.name, root);
    return indexRepoFromMetadata(root, slugHint, metadata);
  } catch (error) {
    console.error("[indexer] failed to index", fullPath, error);
    return null;
  }
}
