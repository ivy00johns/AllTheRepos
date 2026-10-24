/**
 * Catalog service — high-level facade over `db/queries.ts`.
 *
 * Exposed as the `catalogService` singleton expected by the
 * `catalog:*` and `groups:*` IPC handlers (`src/main/ipc/_services.ts`
 * declares the integration contract).
 *
 * Keeping the IPC handlers thin (just .parse + delegate) lets the same
 * service back the future CLI / tray surfaces without duplicating logic.
 */

import { existsSync } from "node:fs";

import type {
  CreateGroupInput,
  DeleteGroupResult,
  DeleteRepoResult,
  GetRepoResult,
  Group,
  ListReposInput,
  ListReposResult,
  Repo,
  RepoListQuery,
  RescanRepoResult,
  SetGroupMembersResult,
  SetRepoTagsResult,
  SmartFilter,
} from "@shared/types";

import {
  deleteGroupRow,
  deleteRepoBySlug,
  getRepoBySlug,
  getRepoIdBySlug,
  getRepoSummaryBySlug,
  insertGroup,
  listGroups as listGroupsRow,
  listRepos as listReposRow,
  markRepoOpened as markRepoOpenedRow,
  rowToRepo,
  setGroupMembersBySlugs,
  setUserTagsBySlug,
  updateGroupRow,
  upsertRepo,
  type UpsertRepoInput,
} from "@main/db/queries";
import { getSqlite } from "@main/db/client";

import { indexRepoEmbedding } from "./embedding";
import { deleteEmbedding } from "./vector-store";
import {
  canonicalPath,
  readRepoMetadata,
  slugFromNameAndPath,
} from "./metadata";
import { inferTags } from "./tag";

class CatalogService {
  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  list(input: ListReposInput): Promise<ListReposResult> {
    // `ListReposInput` from IPC drops the `smart` flag here — Phase 1 ignores
    // it per `contracts/ipc.v1.md > catalog:list` notes. Everything else maps
    // directly onto `RepoListQuery`.
    const query: RepoListQuery = {
      q: input.q,
      language: input.language ?? null,
      tags: input.tags,
      groupId: input.groupId ?? null,
      dirtyOnly: input.dirtyOnly,
      sort: input.sort,
      order: input.order,
      limit: input.limit,
      offset: input.offset,
    };
    return listReposRow(query);
  }

  get(slug: string): Promise<GetRepoResult> {
    return getRepoBySlug(slug);
  }

  // -------------------------------------------------------------------------
  // Single-repo refresh (`catalog:rescan`)
  // -------------------------------------------------------------------------

  /**
   * Refresh metadata for one repo. Re-reads disk, re-runs heuristic tagger,
   * upserts. Preserves slug, user tags, group memberships.
   *
   * Throws if no repo with the given slug exists — the IPC layer can let
   * the rejection bubble; `RescanRepoResultSchema` is non-null.
   */
  async rescan(slug: string): Promise<RescanRepoResult> {
    const sqlite = getSqlite();
    const row = sqlite
      .prepare("SELECT full_path FROM repos WHERE slug = ?")
      .get(slug) as { full_path: string } | undefined;
    if (!row) {
      throw new Error(`catalog:rescan: repo not found (slug=${slug})`);
    }

    const fullPath = canonicalPath(row.full_path);
    // A folder deleted or moved away has nothing to re-read. Return the stored
    // row unchanged instead of throwing: it reads back with `missing: true`, and
    // no scan time is stamped on a folder that is not there.
    if (!existsSync(fullPath)) {
      const stored = await getRepoSummaryBySlug(slug);
      if (!stored) {
        throw new Error(`catalog:rescan: repo not found (slug=${slug})`);
      }
      return stored;
    }

    const { metadata } = await readRepoMetadata(fullPath);
    const heuristicTags = inferTags({
      fullPath,
      languages: metadata.languages,
      readmeContent: metadata.readmeContent,
    });

    const input: UpsertRepoInput = {
      slug: slugFromNameAndPath(metadata.name, fullPath),
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
    const { row: upserted } = upsertRepo(input);

    // ATR-018: re-index the semantic embedding on rescan. Fire-and-forget and
    // content-hash gated — if the README is unchanged this is a no-op, and if
    // the embedding provider is down it degrades to FTS-only without blocking
    // (or failing) the rescan. `indexRepoEmbedding` never throws; the `.catch`
    // is belt-and-suspenders.
    void indexRepoEmbedding({
      repoId: upserted.id,
      slug: upserted.slug,
      name: upserted.name,
      description: upserted.description,
      readmeContent: metadata.readmeContent,
    }).catch((err) => {
      console.error("[backend] embedding index error", err);
    });

    return rowToRepo(upserted);
  }

  // -------------------------------------------------------------------------
  // Tag write (`catalog:setTags`)
  // -------------------------------------------------------------------------

  async setTags(slug: string, tags: string[]): Promise<SetRepoTagsResult> {
    const row = await setUserTagsBySlug(slug, tags);
    if (!row) {
      throw new Error(`catalog:setTags: repo not found (slug=${slug})`);
    }
    return rowToRepo(row);
  }

  // -------------------------------------------------------------------------
  // Groups
  // -------------------------------------------------------------------------

  listGroups(): Promise<Group[]> {
    return listGroupsRow();
  }

  createGroup(input: CreateGroupInput): Promise<Group> {
    return insertGroup({
      name: input.name,
      description: input.description ?? null,
      isSmart: input.isSmart,
      smartFilter: input.smartFilter ?? null,
      parentGroupId: input.parentGroupId ?? null,
    });
  }

  async renameGroup(id: number, name: string): Promise<Group> {
    const updated = await updateGroupRow(id, { name });
    if (!updated) {
      throw new Error(`groups:rename: group not found (id=${id})`);
    }
    return updated;
  }

  /**
   * Replace the rule behind a saved filter.
   *
   * Membership of a smart group is derived from this JSON on every read, so the
   * write re-fills the group — the repos it used to match leave and the ones it
   * now matches appear, without touching a single membership row (a smart group
   * never has any).
   *
   * Refused for a manual group rather than written and ignored: `isSmart` is
   * what decides whether the filter is consulted at all, so storing one on a
   * hand-picked list would leave a rule in the database that looks live and is
   * never evaluated.
   */
  async updateGroupFilter(
    id: number,
    smartFilter: SmartFilter,
  ): Promise<Group> {
    const existing = (await listGroupsRow()).find((group) => group.id === id);
    if (!existing) {
      throw new Error(`groups:updateFilter: group not found (id=${id})`);
    }
    if (!existing.isSmart) {
      throw new Error(
        `groups:updateFilter: group ${id} is not a saved filter`,
      );
    }
    const updated = await updateGroupRow(id, { smartFilter });
    if (!updated) {
      throw new Error(`groups:updateFilter: group not found (id=${id})`);
    }
    return updated;
  }

  async deleteGroup(id: number): Promise<DeleteGroupResult> {
    await deleteGroupRow(id);
    return { deleted: true, id };
  }

  async setGroupMembers(
    groupId: number,
    slugs: string[],
  ): Promise<SetGroupMembersResult> {
    const memberCount = await setGroupMembersBySlugs(groupId, slugs);
    return { groupId, memberCount };
  }

  // -------------------------------------------------------------------------
  // Delete (`catalog:delete`, ATR-028)
  // -------------------------------------------------------------------------

  /**
   * Remove one repo row from the catalog. Never touches the repo on disk.
   * The FTS delete trigger and the `repo_groups` cascade fire with the row;
   * the stored embedding is cleared best-effort — a vector-cleanup failure
   * never fails the delete (the row is the source of truth).
   */
  async deleteRepo(slug: string): Promise<DeleteRepoResult> {
    const deleted = deleteRepoBySlug(slug);
    if (!deleted) return { slug, deleted: false };
    try {
      deleteEmbedding(deleted.id);
    } catch (err) {
      console.error("[catalog] vector cleanup failed on delete", err);
    }
    return { slug, deleted: true };
  }

  // -------------------------------------------------------------------------
  // Helpers exposed for other services
  // -------------------------------------------------------------------------

  /** Repo by slug as the lightweight `Repo` (no readme/groups hydration). */
  getRepoLite(slug: string): Promise<Repo | null> {
    return getRepoSummaryBySlug(slug);
  }

  resolveRepoId(slug: string): Promise<number | null> {
    return getRepoIdBySlug(slug);
  }

  /** Stamp `repos.last_opened_at = now()`. Called from the git editor flow. */
  markOpened(slug: string): Promise<void> {
    return markRepoOpenedRow(slug);
  }
}

export const catalogService: CatalogService = new CatalogService();
