/**
 * Git sync — fetch and pull, one repo or many.
 *
 * "Pull the latest" across a machine holding 150 repos is the operation
 * this app exists to make cheap, so it's built for the batch case from
 * the start: a run over a selection reports per-repo outcomes and never
 * lets one failure abort the rest.
 *
 * ## Safety
 *
 * Pulling is the one git operation here that can rewrite your working
 * tree, so it refuses rather than improvises:
 *
 *   - **Uncommitted changes block it.** A merge into a dirty tree is how
 *     people lose work. Commit or stash first — the app won't decide for
 *     you.
 *   - **No upstream, no pull.** A branch with no tracking ref has nothing
 *     to pull from; guessing a remote would be worse than saying so.
 *   - **Fast-forward only.** `--ff-only` means a pull can never produce a
 *     merge commit or a conflicted tree you then have to untangle inside
 *     a GUI that has no conflict resolution. Diverged branches are
 *     reported, not merged.
 *
 * Fetch has none of those hazards — it only updates remote refs — so it
 * runs unconditionally and is the safe way to refresh ahead/behind counts
 * across the whole catalog.
 */

import simpleGit, { type SimpleGit } from "simple-git";

import { getSqlite } from "@main/db/client";

/** Why a pull was refused, or how it turned out. */
export type SyncOutcome =
  | "updated"
  | "already-current"
  | "fetched"
  | "no-remote"
  | "no-upstream"
  | "dirty"
  | "diverged"
  | "missing"
  | "failed";

export interface SyncEntry {
  slug: string;
  name: string;
  outcome: SyncOutcome;
  /** Commits pulled in, when the outcome is `updated`. */
  received: number;
  ahead: number;
  behind: number;
  currentBranch: string | null;
  /** Human-readable detail. Always set for a non-success outcome. */
  message: string | null;
}

export interface SyncResult {
  entries: SyncEntry[];
  updated: number;
  failed: number;
}

const OUTCOME_MESSAGES: Record<SyncOutcome, string | null> = {
  updated: null,
  "already-current": "Already up to date",
  fetched: null,
  "no-remote": "No remote configured",
  "no-upstream": "Branch isn't tracking a remote branch",
  dirty: "Uncommitted changes — commit or stash first",
  diverged: "Local and remote have diverged — merge or rebase manually",
  missing: "Folder is no longer on disk",
  failed: "Pull failed",
};

interface RepoRow {
  slug: string;
  name: string;
  full_path: string;
}

function reposBySlugs(slugs: string[]): RepoRow[] {
  if (slugs.length === 0) return [];
  const placeholders = slugs.map(() => "?").join(",");
  return getSqlite()
    .prepare(
      `SELECT slug, name, full_path FROM repos WHERE slug IN (${placeholders})`,
    )
    .all(...slugs) as RepoRow[];
}

/** Keep the catalog's cached git fields in step with what we just did. */
function updateCachedGitState(
  slug: string,
  fields: { isDirty: boolean; currentBranch: string | null },
): void {
  try {
    getSqlite()
      .prepare(
        "UPDATE repos SET is_dirty = ?, current_branch = ?, updated_at = ? WHERE slug = ?",
      )
      .run(
        fields.isDirty ? 1 : 0,
        fields.currentBranch,
        new Date().toISOString(),
        slug,
      );
  } catch (error) {
    console.error("[git-sync] failed to update cached state", slug, error);
  }
}

function entry(
  repo: { slug: string; name: string },
  outcome: SyncOutcome,
  extra: Partial<SyncEntry> = {},
): SyncEntry {
  return {
    slug: repo.slug,
    name: repo.name,
    outcome,
    received: 0,
    ahead: 0,
    behind: 0,
    currentBranch: null,
    message: OUTCOME_MESSAGES[outcome],
    ...extra,
  };
}

class GitSyncService {
  /**
   * Update remote-tracking refs without touching the working tree.
   *
   * Safe on every repo unconditionally, which makes it the right way to
   * refresh "how far behind am I" across the whole catalog.
   */
  async fetch(slugs: string[]): Promise<SyncResult> {
    return this.run(slugs, "fetch");
  }

  /** Fast-forward to the tracked upstream where it's safe to do so. */
  async pull(slugs: string[]): Promise<SyncResult> {
    return this.run(slugs, "pull");
  }

  private async run(
    slugs: string[],
    mode: "fetch" | "pull",
  ): Promise<SyncResult> {
    const repos = reposBySlugs(slugs);
    const bySlug = new Map(repos.map((r) => [r.slug, r]));

    // Repos run concurrently but in bounded waves: `git fetch` is network
    // bound, so serialising 150 of them would take minutes, while
    // launching 150 at once would open 150 SSH connections at the remote.
    const CONCURRENCY = 6;
    const entries: SyncEntry[] = [];
    const queue = [...slugs];

    const worker = async (): Promise<void> => {
      for (;;) {
        const slug = queue.shift();
        if (!slug) return;
        const repo = bySlug.get(slug);
        if (!repo) {
          entries.push(entry({ slug, name: slug }, "missing"));
          continue;
        }
        entries.push(await this.runOne(repo, mode));
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, slugs.length) }, worker),
    );

    // Preserve the caller's order — the UI lists them as given.
    const order = new Map(slugs.map((slug, index) => [slug, index]));
    entries.sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0));

    return {
      entries,
      updated: entries.filter((e) => e.outcome === "updated").length,
      failed: entries.filter(
        (e) => e.outcome === "failed" || e.outcome === "missing",
      ).length,
    };
  }

  private async runOne(
    repo: RepoRow,
    mode: "fetch" | "pull",
  ): Promise<SyncEntry> {
    const git: SimpleGit = simpleGit({ baseDir: repo.full_path });

    let status;
    try {
      status = await git.status();
    } catch {
      // `git status` failing almost always means the folder is gone or
      // is no longer a repo.
      return entry(repo, "missing");
    }

    const currentBranch = status.current ?? null;
    const isDirty = status.files.length > 0;
    updateCachedGitState(repo.slug, { isDirty, currentBranch });

    let remotes: Array<{ name: string }> = [];
    try {
      remotes = await git.getRemotes(false);
    } catch {
      /* treated as no remotes below */
    }
    if (remotes.length === 0) {
      return entry(repo, "no-remote", { currentBranch });
    }

    try {
      await git.fetch(["--prune"]);
    } catch (error) {
      return entry(repo, "failed", {
        currentBranch,
        message: `Fetch failed: ${(error as Error).message.split("\n")[0]}`,
      });
    }

    // Re-read after fetching so ahead/behind reflect the new refs.
    const after = await git.status().catch(() => status);
    const ahead = after.ahead ?? 0;
    const behind = after.behind ?? 0;
    const upstream = after.tracking ?? null;

    if (mode === "fetch") {
      return entry(repo, "fetched", {
        currentBranch,
        ahead,
        behind,
        message: null,
      });
    }

    if (!upstream) return entry(repo, "no-upstream", { currentBranch, ahead });
    if (behind === 0) {
      return entry(repo, "already-current", { currentBranch, ahead, behind });
    }
    // Both ahead AND behind means the histories have diverged; a
    // fast-forward is impossible and anything else needs a human.
    if (ahead > 0) {
      return entry(repo, "diverged", { currentBranch, ahead, behind });
    }
    if (isDirty) return entry(repo, "dirty", { currentBranch, ahead, behind });

    try {
      await git.pull(["--ff-only"]);
    } catch (error) {
      return entry(repo, "failed", {
        currentBranch,
        ahead,
        behind,
        message: `Pull failed: ${(error as Error).message.split("\n")[0]}`,
      });
    }

    const final = await git.status().catch(() => after);
    updateCachedGitState(repo.slug, {
      isDirty: final.files.length > 0,
      currentBranch: final.current ?? currentBranch,
    });

    return entry(repo, "updated", {
      currentBranch: final.current ?? currentBranch,
      received: behind,
      ahead: final.ahead ?? 0,
      behind: final.behind ?? 0,
      message: null,
    });
  }
}

export const gitSyncService = new GitSyncService();
