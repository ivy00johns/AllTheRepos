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

import type {
  CreateGroupInput,
  DeleteGroupResult,
  GetRepoResult,
  Group,
  ListReposInput,
  ListReposResult,
  Repo,
  RepoListQuery,
  RescanRepoResult,
  SetGroupMembersResult,
  SetRepoTagsResult,
} from "@shared/types";

import {
  deleteGroupRow,
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

import { canonicalPath, readRepoMetadata, slugFromNameAndPath } from "./metadata";
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
