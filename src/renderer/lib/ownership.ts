/**
 * Repo ownership inference.
 *
 * "Is this mine, or did I clone it?" is one of the first questions you
 * ask when looking at a machine holding hundreds of repos — a fork of
 * someone's agent framework and your own agent framework look identical
 * in a flat list, and only one of them is yours to change.
 *
 * There is no ownership column in the catalog, and adding one would
 * require a full rescan. Everything needed is already on the row: the
 * remote URL. This module derives ownership from `remoteUrl` against a
 * set of "identities" (GitHub/GitLab handles that belong to the user).
 *
 * Identities come from Settings when the user has configured them, and
 * are otherwise inferred from the catalog itself — see `inferIdentities`.
 *
 * PURE module: no DOM, no Node, no IPC.
 */

import type { Repo } from "@shared/types";

/**
 * Ownership classification.
 *
 * - `mine`     — the remote is under one of the user's own handles.
 * - `external` — the remote belongs to someone else (a clone or a fork).
 * - `local`    — no remote at all. Could still be the user's work, just
 *                never published — deliberately its own bucket because
 *                "unpublished" is actionable in a way "cloned" is not.
 */
export type Ownership = "mine" | "external" | "local";

export interface OwnershipInfo {
  kind: Ownership;
  /** The parsed owner handle, or `null` for `local`. */
  owner: string | null;
  /** Hosting provider host, e.g. `github.com`. `null` for `local`. */
  host: string | null;
  /** Short human label for chips and filters. */
  label: string;
}

/**
 * Parse the owner + host out of a git remote URL.
 *
 * Handles the three shapes that actually appear in the wild:
 *   - `https://github.com/owner/repo.git`
 *   - `git@github.com:owner/repo.git`
 *   - `ssh://git@gitlab.com/group/subgroup/repo.git`
 *
 * For nested GitLab groups the FIRST path segment is the owner, which is
 * the one that maps to a user or top-level org.
 */
export function parseRemote(
  remoteUrl: string | null | undefined,
): { owner: string; host: string; repo: string } | null {
  if (!remoteUrl) return null;
  const url = remoteUrl.trim();
  if (!url) return null;

  // scp-like syntax: git@host:owner/repo.git
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)(.+)$/.exec(url);
  let host: string;
  let pathname: string;

  if (scp) {
    host = scp[1];
    pathname = scp[2];
  } else {
    const proto = /^[a-z][\w+.-]*:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i.exec(url);
    if (!proto) return null;
    host = proto[1].replace(/:\d+$/, "");
    pathname = proto[2];
  }

  const segments = pathname
    .replace(/\.git\/?$/i, "")
    .split("/")
    .filter(Boolean);
  if (segments.length < 2) return null;

  return {
    owner: segments[0],
    host: host.toLowerCase(),
    repo: segments[segments.length - 1],
  };
}

/**
 * Classify one repo.
 *
 * `identities` is compared case-insensitively — git hosts treat handles
 * as case-insensitive and users type them inconsistently.
 */
export function ownershipOf(
  repo: Pick<Repo, "remoteUrl">,
  identities: readonly string[],
): OwnershipInfo {
  const parsed = parseRemote(repo.remoteUrl);
  if (!parsed) {
    return { kind: "local", owner: null, host: null, label: "Local only" };
  }
  const normalized = new Set(identities.map((i) => i.toLowerCase()));
  const isMine = normalized.has(parsed.owner.toLowerCase());
  return {
    kind: isMine ? "mine" : "external",
    owner: parsed.owner,
    host: parsed.host,
    label: isMine ? "Mine" : parsed.owner,
  };
}

/**
 * Infer the user's handles from the catalog when Settings has none.
 *
 * Heuristic: on a personal machine the single most common remote owner
 * is overwhelmingly the machine's owner — you clone many repos from many
 * different orgs, but you push to exactly one account. Any owner holding
 * at least `MIN_SHARE` of remotes, or clearly leading the distribution,
 * is treated as the user.
 *
 * This is a bootstrap only. The Settings field is authoritative once set,
 * so a wrong guess is one click away from being fixed rather than baked in.
 */
const MIN_REPOS_FOR_INFERENCE = 4;
const MIN_SHARE = 0.2;

export function inferIdentities(repos: readonly Repo[]): string[] {
  const counts = new Map<string, number>();
  let withRemote = 0;
  for (const repo of repos) {
    const parsed = parseRemote(repo.remoteUrl);
    if (!parsed) continue;
    withRemote++;
    const key = parsed.owner.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (withRemote < MIN_REPOS_FOR_INFERENCE) return [];

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [topOwner, topCount] = ranked[0] ?? [];
  if (!topOwner) return [];
  // Require both a real share of the catalog AND a clear lead over the
  // runner-up, so a machine full of one org's repos isn't misread.
  const runnerUp = ranked[1]?.[1] ?? 0;
  if (topCount / withRemote < MIN_SHARE) return [];
  if (topCount <= runnerUp) return [];
  return [topOwner];
}

/** Display order for grouping / filter chips. */
export const OWNERSHIP_ORDER: readonly Ownership[] = [
  "mine",
  "local",
  "external",
];

export const OWNERSHIP_LABELS: Record<Ownership, string> = {
  mine: "Mine",
  local: "Local only",
  external: "Cloned",
};

/**
 * Description shown in filter UI, so the distinction between "local only"
 * and "cloned" doesn't have to be guessed from the label alone.
 */
export const OWNERSHIP_HINTS: Record<Ownership, string> = {
  mine: "Published under your account",
  local: "No git remote — never pushed anywhere",
  external: "Cloned or forked from someone else",
};
