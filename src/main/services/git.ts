/**
 * Git service — per-repo git status / branches / editor URI resolution.
 *
 * Exposed as the `gitService` singleton consumed by the `git:*` IPC
 * handlers. The handlers feed the resolved URI through
 * `openExternalAllowlisted` themselves — this service NEVER calls
 * `shell.openExternal` directly (Phase 1 contract).
 */

import simpleGit, { type SimpleGit } from "simple-git";

import type {
  GitBranch,
  GitStatus,
  OpenInEditorInput,
} from "@shared/types";

import { getSqlite } from "@main/db/client";

import { catalogService } from "./catalog";
import { getSettings } from "./settings";

function repoPathBySlug(slug: string): string | null {
  const sqlite = getSqlite();
  const row = sqlite
    .prepare("SELECT full_path FROM repos WHERE slug = ?")
    .get(slug) as { full_path: string } | undefined;
  return row?.full_path ?? null;
}

class GitService {
  /**
   * Returns a fresh `git:status`-shaped object for the repo at `slug`.
   * Heavyweight — runs `git status` + branch tracking lookups. The
   * renderer SHOULD debounce calls.
   *
   * Throws if no repo matches the slug; the IPC layer surfaces the
   * rejection to the renderer.
   */
  async status(slug: string): Promise<GitStatus> {
    const fullPath = repoPathBySlug(slug);
    if (!fullPath) {
      throw new Error(`git:status: repo not found (slug=${slug})`);
    }

    const git: SimpleGit = simpleGit({ baseDir: fullPath });

    let isDirty = false;
    let currentBranch: string | null = null;
    let upstream: string | null = null;
    let ahead = 0;
    let behind = 0;

    try {
      const status = await git.status();
      currentBranch = status.current ?? null;
      upstream = status.tracking ?? null;
      ahead = status.ahead ?? 0;
      behind = status.behind ?? 0;
      isDirty =
        status.files.length > 0 ||
        status.not_added.length > 0 ||
        status.modified.length > 0 ||
        status.renamed.length > 0 ||
        status.deleted.length > 0 ||
        status.created.length > 0;
    } catch (err) {
      console.error("[backend] git:status failed", { slug, err });
    }

    return {
      slug,
      isDirty,
      ahead,
      behind,
      currentBranch,
      upstream,
    };
  }

  /**
   * Returns local branches with last-commit metadata. Failures per branch
   * are coerced to `null` fields — partial data is better than empty.
   *
   * Throws if no repo matches the slug.
   */
  async branches(slug: string): Promise<GitBranch[]> {
    const fullPath = repoPathBySlug(slug);
    if (!fullPath) {
      throw new Error(`git:branches: repo not found (slug=${slug})`);
    }

    const git: SimpleGit = simpleGit({ baseDir: fullPath });

    let branchSummary: Awaited<ReturnType<SimpleGit["branchLocal"]>>;
    try {
      branchSummary = await git.branchLocal();
    } catch (err) {
      console.error("[backend] git:branches branch list failed", { slug, err });
      return [];
    }

    const out: GitBranch[] = [];
    for (const name of branchSummary.all) {
      let lastCommitHash: string | null = null;
      let lastCommitDate: string | null = null;
      let lastCommitMsg: string | null = null;
      try {
        // `simple-git`'s `log({ from, to })` requires both. For one branch's
        // HEAD we invoke `git log -1 <branch>` via raw() — the simplest way
        // to get hash + ISO date + subject in one shot.
        const raw = await git.raw([
          "log",
          "-1",
          "--pretty=%H%x09%aI%x09%s",
          name,
        ]);
        const line = raw.trim().split("\n")[0];
        if (line) {
          const [hash, date, ...rest] = line.split("\t");
          lastCommitHash = hash || null;
          lastCommitDate = date ? new Date(date).toISOString() : null;
          lastCommitMsg = rest.join("\t") || null;
        }
      } catch {
        // ignore per-branch log failures — leave the fields null
      }
      out.push({
        name,
        isCurrent: name === branchSummary.current,
        lastCommitHash,
        lastCommitDate,
        lastCommitMsg,
      });
    }
    return out;
  }

  /**
   * Resolve the editor URI for the given repo + editor preference. The
   * IPC handler then passes the URI through `openExternalAllowlisted`.
   *
   * Returns `{ uri: null }` when no launchable editor is configured —
   * the renderer renders a friendly toast in that case.
   */
  async resolveEditorUri(
    input: OpenInEditorInput,
  ): Promise<{ uri: string | null }> {
    const fullPath = repoPathBySlug(input.slug);
    if (!fullPath) return { uri: null };

    const settings = getSettings();
    const editor = input.editor ?? settings.defaultEditor;
    if (editor === "none") return { uri: null };

    // Both vscode:// and cursor:// accept `/file/<absolute path>` for opening
    // a directory. encodeURI() handles spaces / unicode in the path safely.
    const encoded = encodeURI(fullPath);
    switch (editor) {
      case "vscode":
        return { uri: `vscode://file${encoded}` };
      case "cursor":
        return { uri: `cursor://file${encoded}` };
      default:
        return { uri: null };
    }
  }

  /** Stamp `repos.last_opened_at = now()`. Called from the open-editor flow. */
  markOpened(slug: string): Promise<void> {
    return catalogService.markOpened(slug);
  }
}

export const gitService: GitService = new GitService();
