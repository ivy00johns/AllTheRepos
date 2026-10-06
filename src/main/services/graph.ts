/**
 * Relationship graph.
 *
 * Answers "how do my projects connect?" — and, more usefully, "which
 * projects belong together but don't live together?"
 *
 * ## What actually connects two repos
 *
 * Measured against a real 263-repo machine before any of this was built,
 * because the intuitive answer turned out to be wrong. Repos do NOT cite
 * each other much (the largest hub was referenced by four READMEs) and
 * NONE of them depend on each other as packages. What genuinely clusters
 * them is shared *tooling*: 206 libraries are each used by between 3 and
 * 25 repos, and that is the signal that recovers the families you'd draw
 * by hand.
 *
 * So the graph is multi-signal, and every edge records which signals
 * produced it so the UI can filter and the number can be justified:
 *
 * | Signal       | Meaning                                    |
 * | ------------ | ------------------------------------------ |
 * | `dependency` | Shared distinctive libraries               |
 * | `reference`  | One README links to the other's GitHub repo |
 * | `submodule`  | One repo vendors the other                 |
 * | `owner`      | Same remote owner (a clone family)         |
 * | `naming`     | Shared name family (`pwnagotchi-*`)        |
 *
 * ## Rarity, not popularity
 *
 * Everything is weighted by inverse frequency. Fifty-six repos use
 * TypeScript, so sharing it means nothing; four use `crewai`, so sharing
 * that means a great deal. Without this the graph collapses into one
 * hairball where every JavaScript project touches every other.
 *
 * ## Folders are context, not edges
 *
 * Living in the same directory is deliberately NOT an edge. It's the
 * thing the graph is meant to critique — if co-location drew lines, the
 * graph would simply redraw the folder tree and could never tell you the
 * tree is wrong.
 */

import fs from "node:fs";
import path from "node:path";

import type {
  GraphEdge,
  GraphNode,
  GraphResult,
  GraphSignal,
  RepoLinkKind,
} from "@shared/types";

import { getSqlite } from "@main/db/client";
import { listLinks } from "@main/db/links";

/**
 * A dependency shared by more repos than this is ambient and says
 * nothing about kinship.
 *
 * Tuned against the real catalog, where 25% was far too generous: at
 * that threshold `typescript` (56 repos), `eslint` and `tailwindcss` all
 * counted as "distinctive" and fused every web project into a single
 * 123-repo blob — half the catalog in one meaningless cluster. 5% keeps
 * only libraries specific enough to imply a shared purpose.
 */
const DEP_MAX_SHARE = 0.05;
const DEP_MIN_REPOS = 2;

/**
 * Floor for the "ambient" cutoff.
 *
 * A pure percentage collapses on small catalogs: at twenty repos, 5% is
 * one, so every shared library looks ambient and the graph comes back
 * empty. Six is the smallest cutoff that still means "a handful of
 * projects", and it only binds below ~120 repos.
 */
const DEP_MAX_REPOS_FLOOR = 6;

/**
 * Edges below this are noise — one incidental shared library.
 * Dropping them is what keeps the graph readable.
 */
const MIN_EDGE_WEIGHT = 0.25;

/** Owners above this are ambient too — your own account covers everything. */
const OWNER_MAX_REPOS = 25;

/**
 * A name token shared by more repos than this is a prefix habit, not a
 * family.
 *
 * Measured against the real catalog at the old cap of 12: naming produced
 * 344 of 627 edges, and 297 of them had NO other signal corroborating
 * them. `claude-mem`, `claude-dev`, `claude-task-viewer` and friends were
 * fused into a clique purely because you name things "claude-*". That is
 * the same trap `DEP_MAX_SHARE` already avoids for libraries — common
 * means ambient, not related — so the same rule applies here.
 *
 * Four keeps genuine pairs and small families (`pwnagotchi-tools` /
 * `pwnagotchi-plugins`) while dropping naming conventions.
 */
const NAME_MAX_FAMILY = 4;

/** Name tokens this short or this common carry no signal. */
const NAME_STOPWORDS = new Set([
  "ai",
  "api",
  "app",
  "cli",
  "web",
  "test",
  "tests",
  "docs",
  "tool",
  "tools",
  "code",
  "core",
  "data",
  "new",
  "old",
  "my",
  "the",
  "v1",
  "v2",
  "v3",
  "main",
  "demo",
  "project",
]);

/** Per-signal base weights, before rarity scaling. */
const SIGNAL_WEIGHT: Record<GraphSignal, number> = {
  // A curated link is an assertion, not an inference. It outranks
  // everything the graph works out for itself.
  curated: 4,
  submodule: 3,
  reference: 2.5,
  dependency: 1,
  owner: 1.2,
  naming: 1,
};

interface RepoRow {
  slug: string;
  name: string;
  full_path: string;
  remote_url: string | null;
  primary_language: string | null;
  readme_content: string | null;
  is_favorite: number;
  last_commit_date: string | null;
}

function readRepos(): RepoRow[] {
  return getSqlite()
    .prepare(
      `SELECT slug, name, full_path, remote_url, primary_language,
              readme_content, is_favorite, last_commit_date
         FROM repos`,
    )
    .all() as RepoRow[];
}

/** Owner segment of a git remote, or null. */
function remoteOwner(remote: string | null): string | null {
  if (!remote) return null;
  const scp = /^(?:[\w.-]+@)?[\w.-]+:(?!\/\/)(.+)$/.exec(remote.trim());
  const proto = /^[a-z][\w+.-]*:\/\/(?:[^@/]+@)?[^/]+\/(.+)$/i.exec(
    remote.trim(),
  );
  const pathname = scp?.[1] ?? proto?.[1];
  if (!pathname) return null;
  const segments = pathname
    .replace(/\.git\/?$/i, "")
    .split("/")
    .filter(Boolean);
  return segments.length >= 2 ? segments[0].toLowerCase() : null;
}

/** `owner/repo` key of a git remote, for matching README links. */
function remoteKey(remote: string | null): string | null {
  if (!remote) return null;
  const scp = /^(?:[\w.-]+@)?[\w.-]+:(?!\/\/)(.+)$/.exec(remote.trim());
  const proto = /^[a-z][\w+.-]*:\/\/(?:[^@/]+@)?[^/]+\/(.+)$/i.exec(
    remote.trim(),
  );
  const pathname = scp?.[1] ?? proto?.[1];
  if (!pathname) return null;
  const segments = pathname
    .replace(/\.git\/?$/i, "")
    .split("/")
    .filter(Boolean);
  if (segments.length < 2) return null;
  return `${segments[0]}/${segments[segments.length - 1]}`.toLowerCase();
}

/** Dependency names declared at a repo's root, or an empty list. */
function readDependencies(root: string): string[] {
  try {
    const raw = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  } catch {
    return [];
  }
}

/** Remote URLs a repo vendors as submodules. */
function readSubmodules(root: string): string[] {
  try {
    const raw = fs.readFileSync(path.join(root, ".gitmodules"), "utf8");
    return [...raw.matchAll(/url\s*=\s*(\S+)/g)].map((m) => m[1]);
  } catch {
    return [];
  }
}

/**
 * Meaningful tokens in a repo name.
 *
 * `PredictTheMadness` → `predict`, `madness`; `pwnagotchi-tools` →
 * `pwnagotchi`. camelCase is split so families spelled both ways still
 * meet.
 */
function nameTokens(name: string): string[] {
  return name
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 4 && !NAME_STOPWORDS.has(t));
}

/** Undirected pair key, order-independent. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * Community detection by label propagation.
 *
 * Chosen over modularity optimisation because it's ~20 lines, runs in
 * milliseconds on a few hundred nodes, and needs no cluster count up
 * front. Neighbours are visited in a fixed order and ties break on the
 * lowest label, so the same graph always yields the same clusters —
 * without that the view would reshuffle on every open.
 */
function detectClusters(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, number> {
  const neighbours = new Map<string, Array<{ slug: string; weight: number }>>();
  for (const node of nodes) neighbours.set(node.slug, []);
  for (const edge of edges) {
    neighbours
      .get(edge.source)
      ?.push({ slug: edge.target, weight: edge.weight });
    neighbours
      .get(edge.target)
      ?.push({ slug: edge.source, weight: edge.weight });
  }

  const labels = new Map<string, string>();
  for (const node of nodes) labels.set(node.slug, node.slug);
  const order = [...nodes].map((n) => n.slug).sort();

  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const slug of order) {
      const mine = neighbours.get(slug) ?? [];
      if (mine.length === 0) continue;
      const score = new Map<string, number>();
      for (const { slug: other, weight } of mine) {
        const label = labels.get(other)!;
        score.set(label, (score.get(label) ?? 0) + weight);
      }
      let best = labels.get(slug)!;
      let bestScore = score.get(best) ?? 0;
      for (const [label, value] of [...score.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      )) {
        if (value > bestScore) {
          best = label;
          bestScore = value;
        }
      }
      if (best !== labels.get(slug)) {
        labels.set(slug, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Compact the surviving labels into small stable integers, ordered by
  // cluster size so cluster 0 is always the biggest.
  const members = new Map<string, string[]>();
  for (const [slug, label] of labels) {
    if (!members.has(label)) members.set(label, []);
    members.get(label)!.push(slug);
  }
  const ranked = [...members.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
  const out = new Map<string, number>();
  ranked.forEach(([, slugs], index) => {
    for (const slug of slugs) out.set(slug, index);
  });
  return out;
}

class GraphService {
  /**
   * Build the whole graph.
   *
   * Reads every repo's `package.json` and `.gitmodules` from disk, which
   * is a few hundred small files — fast enough to do on demand rather
   * than maintaining an index that could go stale.
   */
  build(): GraphResult {
    const repos = readRepos();
    const total = repos.length;
    const bySlug = new Map(repos.map((r) => [r.slug, r]));

    // ---- gather per-repo facts -------------------------------------
    const deps = new Map<string, string[]>();
    const subs = new Map<string, string[]>();
    const depFrequency = new Map<string, number>();
    const ownerMembers = new Map<string, string[]>();
    const tokenMembers = new Map<string, string[]>();
    const keyToSlug = new Map<string, string>();

    for (const repo of repos) {
      const dependencies = readDependencies(repo.full_path);
      deps.set(repo.slug, dependencies);
      for (const dep of new Set(dependencies)) {
        depFrequency.set(dep, (depFrequency.get(dep) ?? 0) + 1);
      }

      subs.set(repo.slug, readSubmodules(repo.full_path));

      const owner = remoteOwner(repo.remote_url);
      if (owner) {
        if (!ownerMembers.has(owner)) ownerMembers.set(owner, []);
        ownerMembers.get(owner)!.push(repo.slug);
      }

      for (const token of new Set(nameTokens(repo.name))) {
        if (!tokenMembers.has(token)) tokenMembers.set(token, []);
        tokenMembers.get(token)!.push(repo.slug);
      }

      const key = remoteKey(repo.remote_url);
      if (key) keyToSlug.set(key, repo.slug);
    }

    // ---- accumulate weighted edges ---------------------------------
    const pairs = new Map<
      string,
      {
        source: string;
        target: string;
        weight: number;
        signals: Set<GraphSignal>;
        why: string[];
        curated: Array<{
          from: string;
          to: string;
          kind: RepoLinkKind;
          why: string | null;
        }>;
      }
    >();

    const add = (
      a: string,
      b: string,
      signal: GraphSignal,
      weight: number,
      why: string,
    ) => {
      if (a === b) return;
      const key = pairKey(a, b);
      let entry = pairs.get(key);
      if (!entry) {
        const [source, target] = a < b ? [a, b] : [b, a];
        entry = {
          source,
          target,
          weight: 0,
          signals: new Set(),
          why: [],
          curated: [],
        };
        pairs.set(key, entry);
      }
      entry.weight += weight * SIGNAL_WEIGHT[signal];
      entry.signals.add(signal);
      // Keep the explanation short — the UI shows it on hover.
      if (entry.why.length < 4 && !entry.why.includes(why)) entry.why.push(why);
    };

    // Dependencies, scaled by how rare the library is.
    const maxShare = Math.max(
      DEP_MAX_REPOS_FLOOR,
      Math.floor(total * DEP_MAX_SHARE),
    );
    const depToRepos = new Map<string, string[]>();
    for (const [slug, list] of deps) {
      for (const dep of new Set(list)) {
        const frequency = depFrequency.get(dep) ?? 0;
        if (frequency < DEP_MIN_REPOS || frequency > maxShare) continue;
        if (!depToRepos.has(dep)) depToRepos.set(dep, []);
        depToRepos.get(dep)!.push(slug);
      }
    }
    /*
     * Dependency edges are cosine-normalised, not summed raw.
     *
     * A repo declaring eighty dependencies would otherwise out-link
     * every sparse repo simply by being large, and the raw sums ran into
     * the hundreds — numbers that couldn't be compared to anything.
     * Dividing by sqrt(|A|·|B|) makes the weight "what share of each
     * one's distinctive tooling is shared", which is comparable across
     * every pair.
     */
    const distinctiveCount = new Map<string, number>();
    for (const [dep, slugs] of depToRepos) {
      for (const slug of slugs) {
        distinctiveCount.set(slug, (distinctiveCount.get(slug) ?? 0) + 1);
      }
      void dep;
    }
    const rawDep = new Map<string, number>();
    for (const [dep, slugs] of depToRepos) {
      const idf = Math.log(total / slugs.length);
      const sorted = [...slugs].sort();
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const key = pairKey(sorted[i], sorted[j]);
          rawDep.set(key, (rawDep.get(key) ?? 0) + idf);
        }
      }
    }
    for (const [dep, slugs] of depToRepos) {
      const sorted = [...slugs].sort();
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i];
          const b = sorted[j];
          const key = pairKey(a, b);
          if (!rawDep.has(key)) continue;
          const norm = Math.sqrt(
            (distinctiveCount.get(a) ?? 1) * (distinctiveCount.get(b) ?? 1),
          );
          // Emit once per pair, then clear so later deps don't re-add it.
          add(a, b, "dependency", rawDep.get(key)! / (norm || 1), dep);
          rawDep.delete(key);
        }
      }
    }

    // README links to another catalogued repo's GitHub page.
    for (const repo of repos) {
      if (!repo.readme_content) continue;
      const seen = new Set<string>();
      for (const match of repo.readme_content.matchAll(
        /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g,
      )) {
        const key =
          `${match[1]}/${match[2].replace(/\.git$/, "")}`.toLowerCase();
        const other = keyToSlug.get(key);
        if (!other || other === repo.slug || seen.has(other)) continue;
        seen.add(other);
        add(repo.slug, other, "reference", 1, "links to it");
      }
    }

    // Submodules — one repo vendoring another.
    for (const [slug, urls] of subs) {
      for (const url of urls) {
        const other = keyToSlug.get(remoteKey(url) ?? "");
        if (other && other !== slug)
          add(slug, other, "submodule", 1, "submodule");
      }
    }

    // Same remote owner, when that owner isn't ambient.
    for (const [owner, slugs] of ownerMembers) {
      if (slugs.length < 2 || slugs.length > OWNER_MAX_REPOS) continue;
      const idf = Math.log(total / slugs.length);
      const sorted = [...slugs].sort();
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          add(sorted[i], sorted[j], "owner", idf / 2, `both from ${owner}`);
        }
      }
    }

    // Shared name family.
    for (const [token, slugs] of tokenMembers) {
      if (slugs.length < 2 || slugs.length > NAME_MAX_FAMILY) continue;
      const idf = Math.log(total / slugs.length);
      const sorted = [...slugs].sort();
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          add(sorted[i], sorted[j], "naming", idf / 2, `“${token}”`);
        }
      }
    }

    // Curated links — asserted by a person or an agent, never derived.
    // `listLinks` joins through to slugs already, so no id mapping is
    // needed here and `readRepos` is left exactly as it is.
    for (const link of listLinks()) {
      const from = link.fromSlug;
      const to = link.toSlug;
      if (!bySlug.has(from) || !bySlug.has(to)) continue;
      add(from, to, "curated", 1, link.why ?? link.kind);
      pairs.get(pairKey(from, to))?.curated.push({
        from,
        to,
        kind: link.kind,
        why: link.why,
      });
    }

    // ---- assemble --------------------------------------------------
    const edges: GraphEdge[] = [...pairs.values()]
      // A curated link is a human assertion and must never be discarded
      // as noise, however weak the derived signals between the pair are.
      .filter(
        (entry) =>
          entry.signals.has("curated") || entry.weight >= MIN_EDGE_WEIGHT,
      )
      .map((entry) => ({
        source: entry.source,
        target: entry.target,
        weight: Math.round(entry.weight * 100) / 100,
        signals: [...entry.signals].sort(),
        why: entry.why,
        ...(entry.curated.length > 0 ? { curated: entry.curated } : {}),
      }))
      // Strongest first, so a UI cap keeps the meaningful edges.
      .sort((a, b) => b.weight - a.weight);

    const nodes: GraphNode[] = repos.map((repo) => {
      const dir = repo.full_path.slice(0, repo.full_path.lastIndexOf("/"));
      return {
        slug: repo.slug,
        name: repo.name,
        folder: dir,
        language: repo.primary_language,
        isFavorite: Boolean(repo.is_favorite),
        lastCommitDate: repo.last_commit_date,
        cluster: 0,
        degree: 0,
      };
    });

    const clusters = detectClusters(nodes, edges);
    const degree = new Map<string, number>();
    for (const edge of edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }
    for (const node of nodes) {
      node.cluster = clusters.get(node.slug) ?? 0;
      node.degree = degree.get(node.slug) ?? 0;
    }

    return {
      nodes,
      edges,
      clusters: this.summariseClusters(nodes, bySlug),
      builtAt: new Date().toISOString(),
    };
  }

  /**
   * Describe each cluster, and how scattered it is on disk.
   *
   * `folderSpread` is the payoff: a cluster of eight repos living in one
   * folder is organised, the same eight across five folders is the thing
   * you'd want to fix. Clusters of one are dropped — a repo related to
   * nothing is a fact about the repo, not a group.
   */
  private summariseClusters(
    nodes: GraphNode[],
    bySlug: Map<string, RepoRow>,
  ): GraphResult["clusters"] {
    const groups = new Map<number, GraphNode[]>();
    for (const node of nodes) {
      if (!groups.has(node.cluster)) groups.set(node.cluster, []);
      groups.get(node.cluster)!.push(node);
    }

    return [...groups.entries()]
      .filter(([, members]) => members.length >= 2)
      .map(([id, members]) => {
        const folders = new Map<string, number>();
        for (const member of members) {
          folders.set(member.folder, (folders.get(member.folder) ?? 0) + 1);
        }
        const ranked = [...folders.entries()].sort((a, b) => b[1] - a[1]);
        // Name the cluster after its most connected member — that's
        // almost always the project the others orbit.
        const hub = [...members].sort(
          (a, b) => b.degree - a.degree || a.name.localeCompare(b.name),
        )[0];
        return {
          id,
          label: hub ? hub.name : `Cluster ${id}`,
          size: members.length,
          slugs: members.map((m) => m.slug).sort(),
          folders: ranked.map(([folder, count]) => ({ folder, count })),
          folderSpread: ranked.length,
          dominantFolder: ranked[0]?.[0] ?? "",
          /** Members not in the cluster's main folder — the reorg candidates. */
          strays: members
            .filter((m) => m.folder !== (ranked[0]?.[0] ?? ""))
            .map((m) => m.slug),
        };
      })
      .sort((a, b) => b.size - a.size || a.label.localeCompare(b.label))
      .filter(() => bySlug.size > 0);
  }
}

export const graphService = new GraphService();
