/**
 * The demo library — the data behind the browser bridge.
 *
 * This is the same repository set the README screenshots are built from
 * (`scripts/make-readme-shots.mjs`, 12 repos under `~/Code`), lifted out of that
 * Node-only script and extended into every shape the app reads. The screenshots
 * script already proved the data is well-formed against the IPC schemas (its own
 * spec checks tags carry a `source` and languages carry a `color`, the omission
 * that once made the whole catalog render blank); this module reuses the same
 * library so a browser review and a published screenshot cannot disagree about
 * what the demo machine holds.
 *
 * What each surface reads from here:
 *
 * | Surface          | Data                                              |
 * | ---------------- | ------------------------------------------------- |
 * | `/` catalog      | `DEMO_REPOS`, `DEMO_GROUPS`, `demoDetail`         |
 * | `/repos/$slug`   | the detail panel: README, tasks, curated links    |
 * | `/graph`         | `DEMO_GRAPH` — nodes, weighted edges, clusters    |
 * | repo Claude tab  | `demoClaudeRepoState` — CLAUDE.md, skills, agents |
 * | `/claude`        | `DEMO_CLAUDE_PROJECTS`, `demoGlobalUsage`         |
 * | `/processes`     | `DEMO_PROCESSES` — listening dev servers          |
 * | card port chips  | the same rows, matched to a repo by `repoSlug`    |
 * | `/settings`      | `DEMO_SETTINGS`, `DEMO_LAUNCHER`, `DEMO_UPDATE`   |
 *
 * Two deliberate departures from the screenshot layout, both so the rail and
 * the map have something to show:
 *
 *   - `sketchbook` and `old-experiment` sit loose at the top of the scan root
 *     rather than in a group folder, which is what a real library looks like
 *     once a few one-offs accumulate — and what gives the rail's
 *     "directly in this folder" row a top-level case to demonstrate.
 *   - The graph carries an `owner` edge between every pair of repos whose
 *     remote belongs to the same person. With nine such repos that is 36 faint
 *     links, which is the honest shape of that signal: it is a weak one, and
 *     the map is meant to show the strong links standing out from it.
 *
 * UUIDs, hashes and token counts are generated deterministically (a seeded
 * walk, never `Math.random`) so a reload does not reshuffle the demo.
 */

import type { RepoTask } from "@shared/types";
import type {
  ClaudeAgent,
  Group,
  Settings,
  ClaudeGlobalUsageInput,
  ClaudeGlobalUsageResult,
  ClaudeMcpServer,
  ClaudeProject,
  ClaudeRepoState,
  ClaudeSession,
  ClaudeSessionTranscriptResult,
  ClaudeSkill,
  DetectLauncherResult,
  GraphCluster,
  GraphEdge,
  GraphNode,
  GraphResult,
  GraphSignal,
  ListProcessesResult,
  ProcessInfo,
  Repo,
  RepoDetail,
  RepoLinkKind,
  RepoRelation,
  RepoRelationsResult,
  TokenUsage,
  TranscriptEvent,
  UpdateStatus,
} from "@shared/types";
import { colorForLanguage } from "@renderer/components/catalog/language-colors";

/** Where the demo library lives, so the rail has a scan root to anchor on. */
export const DEMO_ROOT = "/Users/demo/Code";

/** One clock for the whole module, so every derived date agrees. */
const LOADED_AT = Date.now();

const iso = (ms: number): string => new Date(ms).toISOString();

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** The slug rule the catalog uses: kebab name + a short path hash. */
const kebab = (value: string): string =>
  value
    .replace(/[A-Z]+/g, (match) => `-${match.toLowerCase()}`)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

/**
 * FNV-1a, rendered as eight hex characters.
 *
 * The catalog's real slugs suffix a sha1 prefix. This is the same width and the
 * same purpose (two repos named `api` must not collide) without pulling a hash
 * implementation into the renderer: these slugs are internal to the demo, and
 * nothing outside this module compares them against the database.
 */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const slugFor = (name: string, fullPath: string): string =>
  `${kebab(name)}-${shortHash(fullPath)}`;

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

/**
 * One row of the demo library.
 *
 * `hoursAgo` rather than a fixed date so the activity ramp shows a spread
 * whenever the page is opened; `group` doubles as the folder name.
 */
interface DemoSeed {
  name: string;
  /** Folder under the scan root, or `null` for a repo loose at the top. */
  group: string | null;
  language: string;
  languages: Array<{ name: string; bytes: number }>;
  tags: string[];
  remote: string | null;
  hoursAgo: number;
  message: string;
  description: string;
  sizeKb: number;
  dirty?: boolean;
  favorite?: boolean;
  readme: ReadmeKind;
}

type ReadmeKind = "project" | "service" | "notebooks" | "sketch";

const DEMO_SEEDS: DemoSeed[] = [
  {
    name: "lighthouse-ui",
    group: "design",
    language: "TypeScript",
    languages: [
      { name: "TypeScript", bytes: 182_000 },
      { name: "CSS", bytes: 41_000 },
      { name: "Shell", bytes: 3_400 },
    ],
    tags: ["ui", "electron", "tailwind"],
    remote: "git@github.com:ivy00johns/lighthouse-ui.git",
    hoursAgo: 3,
    message: "Polish the catalog toolbar spacing",
    description: "The desktop surface: catalog, filter chips and the detail rail.",
    sizeKb: 24_800,
    favorite: true,
    readme: "project",
  },
  {
    name: "ledger-core",
    group: "services",
    language: "Rust",
    languages: [
      { name: "Rust", bytes: 96_000 },
      { name: "TOML", bytes: 2_100 },
    ],
    tags: ["ledger", "cli"],
    remote: "git@github.com:ivy00johns/ledger-core.git",
    hoursAgo: 26,
    message: "Fail closed when a journal entry is unbalanced",
    description: "Double-entry ledger with an append-only journal.",
    sizeKb: 11_200,
    favorite: true,
    readme: "service",
  },
  {
    name: "mailroom",
    group: "services",
    language: "Go",
    languages: [
      { name: "Go", bytes: 74_000 },
      { name: "Makefile", bytes: 1_400 },
    ],
    tags: ["email", "queue"],
    remote: "git@github.com:ivy00johns/mailroom.git",
    hoursAgo: 5,
    dirty: true,
    message: "Retry the webhook delivery with backoff",
    description: "Inbound mail webhooks, normalised and queued.",
    sizeKb: 8_100,
    readme: "service",
  },
  {
    name: "edge-proxy",
    group: "infra",
    language: "Go",
    languages: [
      { name: "Go", bytes: 51_000 },
      { name: "HCL", bytes: 12_000 },
    ],
    tags: ["proxy", "terraform"],
    remote: "git@github.com:ivy00johns/edge-proxy.git",
    hoursAgo: 140,
    message: "Pin the upstream TLS floor to 1.2",
    description: "Tiny reverse proxy with per-tenant rate limits.",
    sizeKb: 6_600,
    readme: "sketch",
  },
  {
    name: "terraform-live",
    group: "infra",
    language: "HCL",
    languages: [{ name: "HCL", bytes: 38_000 }],
    tags: ["terraform", "aws"],
    remote: "git@github.com:ivy00johns/terraform-live.git",
    hoursAgo: 340,
    message: "Split the network stack out of the app stack",
    description: "The applied stack — every change here is a change in prod.",
    sizeKb: 1_900,
    readme: "sketch",
  },
  {
    name: "voxel-engine",
    group: "graphics",
    language: "C++",
    languages: [
      { name: "C++", bytes: 143_000 },
      { name: "GLSL", bytes: 29_000 },
      { name: "CMake", bytes: 4_000 },
    ],
    tags: ["renderer", "vulkan"],
    remote: "git@github.com:ivy00johns/voxel-engine.git",
    hoursAgo: 620,
    message: "Defer the voxel upload by one frame",
    description: "Chunked voxel renderer: sparse octree, GPU-persistent buffers.",
    sizeKb: 46_300,
    readme: "sketch",
  },
  {
    name: "pixel-forge",
    group: "graphics",
    language: "TypeScript",
    languages: [
      { name: "TypeScript", bytes: 88_000 },
      { name: "GLSL", bytes: 16_000 },
    ],
    tags: ["shaders", "editor"],
    remote: "git@github.com:ivy00johns/pixel-forge.git",
    hoursAgo: 1_100,
    message: "Add a node graph for the sprite atlas pass",
    description: "Sprite pipeline with a live shader preview.",
    sizeKb: 19_400,
    readme: "sketch",
  },
  {
    name: "weatherbot",
    group: "labs",
    language: "Python",
    languages: [
      { name: "Python", bytes: 33_000 },
      { name: "Jupyter Notebook", bytes: 61_000 },
    ],
    tags: ["data", "notebook"],
    remote: "git@github.com:ivy00johns/weatherbot.git",
    hoursAgo: 2_400,
    message: "Backfill the 2019 station readings",
    description: "Forecast deltas against the public station archive.",
    sizeKb: 73_800,
    readme: "notebooks",
  },
  {
    name: "sketchbook",
    group: null,
    language: "Jupyter Notebook",
    languages: [
      { name: "Jupyter Notebook", bytes: 120_000 },
      { name: "Python", bytes: 18_000 },
    ],
    tags: ["ml", "notes"],
    remote: null,
    hoursAgo: 3_900,
    message: "Two-layer net on the toy corpus, for the write-up",
    description: "Throwaway notebooks that never became a paper.",
    sizeKb: 28_100,
    readme: "notebooks",
  },
  {
    name: "orchestrator",
    group: "labs",
    language: "TypeScript",
    languages: [
      { name: "TypeScript", bytes: 64_000 },
      { name: "YAML", bytes: 5_500 },
    ],
    tags: ["agent", "queue"],
    remote: "git@github.com:ivy00johns/orchestrator.git",
    hoursAgo: 7_200,
    message: "Isolate each worker in its own worktree",
    description: "Dispatch layer: a work graph, a fleet, a merge queue.",
    sizeKb: 15_700,
    readme: "sketch",
  },
  {
    name: "docs-site",
    group: "web",
    language: "MDX",
    languages: [
      { name: "MDX", bytes: 84_000 },
      { name: "TypeScript", bytes: 21_000 },
    ],
    tags: ["docs", "astro"],
    remote: "https://github.com/somebodyelse/docs-site.git",
    hoursAgo: 11_000,
    message: "Document the plugin hooks",
    description: "A fork of a docs starter, kept for the plugin examples.",
    sizeKb: 12_900,
    readme: "project",
  },
  {
    name: "old-experiment",
    group: null,
    language: "JavaScript",
    languages: [{ name: "JavaScript", bytes: 9_400 }],
    tags: ["old"],
    remote: null,
    hoursAgo: 9_000,
    message: "Initial commit",
    description: "The first thing I ever deployed. Kept for sentimental reasons.",
    sizeKb: 700,
    readme: "sketch",
  },
];

const fullPathFor = (seed: DemoSeed): string =>
  seed.group ? `${DEMO_ROOT}/${seed.group}/${seed.name}` : `${DEMO_ROOT}/${seed.name}`;

const slugForSeed = (seed: DemoSeed): string =>
  slugFor(seed.name, fullPathFor(seed));

/** The slug of a repo, by name. Throws on a typo rather than inventing one. */
function slugOf(name: string): string {
  const seed = DEMO_SEEDS.find((s) => s.name === name);
  if (!seed) throw new Error(`[demo-library] no demo repo named ${name}`);
  return slugForSeed(seed);
}

// ---------------------------------------------------------------------------
// READMEs
// ---------------------------------------------------------------------------

/**
 * The READMEs.
 *
 * Four shapes rather than twelve bespoke files, chosen so the prose styling has
 * something to chew on in each state: `project` is the full treatment
 * (headings, fence, list, quote, table, rule, inline code, link), `service` and
 * `notebooks` are the middle range, and `sketch` is what most repos actually
 * have — a title and a sentence.
 */
const READMES: Record<ReadmeKind, string> = {
  project: [
    "# {name}",
    "",
    "{description}",
    "",
    "## Getting started",
    "",
    "Install and run it with the usual two commands:",
    "",
    "```bash",
    "pnpm install",
    "pnpm dev",
    "```",
    "",
    "### Notes",
    "",
    "- The [docs](https://example.com/docs) cover deployment.",
    "- Inline `pnpm build` output goes to `dist/`.",
    "- Blocks marked `_experimental_` may change.",
    "",
    "> Demo content from the browser bridge, not a real file.",
    "",
    "| Command | What it does |",
    "| --- | --- |",
    "| `pnpm dev` | Start the dev server |",
    "| `pnpm build` | Production build |",
    "",
    "---",
    "",
    "Finally a paragraph with **bold text** and an `inline code` span.",
    "",
  ].join("\n"),
  service: [
    "# {name}",
    "",
    "{description}",
    "",
    "## Running it",
    "",
    "```bash",
    "make run          # reads config.toml from the repo root",
    "make test         # unit + integration",
    "```",
    "",
    "## Layout",
    "",
    "- `cmd/` — entry points",
    "- `internal/` — the packages this service owns",
    "- `docs/` — decisions, one file per decision",
    "",
    "Nothing here talks to another service except through the queue.",
    "",
  ].join("\n"),
  notebooks: [
    "# {name}",
    "",
    "{description}",
    "",
    "Notebooks are numbered in the order they should be run:",
    "",
    "```python",
    "df = load_station_readings('2019')",
    "report(df, out='report.html')",
    "```",
    "",
    "- `01-load` — pull the archive",
    "- `02-clean` — drop the partial days",
    "- `03-report` — the figures in the write-up",
    "",
  ].join("\n"),
  sketch: [
    "# {name}",
    "",
    "{description}",
    "",
  ].join("\n"),
};

function readmeFor(seed: DemoSeed): string {
  return READMES[seed.readme]
    .replaceAll("{name}", seed.name)
    .replaceAll("{description}", seed.description);
}

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

const LANGUAGES_TOTAL = (seed: DemoSeed): number =>
  seed.languages.reduce((sum, language) => sum + language.bytes, 0);

function buildRepo(seed: DemoSeed, index: number): Repo {
  const fullPath = fullPathFor(seed);
  const readme = readmeFor(seed);
  const favorited = seed.favorite === true;
  return {
    id: index + 1,
    slug: slugForSeed(seed),
    name: seed.name,
    fullPath,
    remoteUrl: seed.remote,
    defaultBranch: "main",
    currentBranch: seed.name === "mailroom" ? "fix/webhook-retry" : "main",
    lastCommitHash: shortHash(`${seed.name}-head`),
    lastCommitDate: iso(LOADED_AT - seed.hoursAgo * 3_600_000),
    lastCommitMsg: seed.message,
    isDirty: seed.dirty === true,
    primaryLanguage: seed.language,
    languages: seed.languages.map((language) => ({
      name: language.name,
      bytes: language.bytes,
      color: colorForLanguage(language.name),
    })),
    tags: seed.tags.map((value) => ({ value, source: "user" as const })),
    description: seed.description,
    readmePreview: readme.slice(0, 400),
    readmeHash: shortHash(readme),
    sizeBytes: seed.sizeKb * 1024,
    lastScannedAt: iso(LOADED_AT - 18 * 60_000),
    // Spread over the last few days so `sort: "lastOpened"` has an order.
    lastOpenedAt: iso(LOADED_AT - (index * 7 + 1) * 3_600_000),
    isFavorite: favorited,
    favoritedAt: favorited ? iso(LOADED_AT - (index + 2) * 86_400_000) : null,
    createdAt: iso(Date.parse("2025-06-01T09:00:00.000Z")),
    updatedAt: iso(LOADED_AT - seed.hoursAgo * 3_600_000),
    source: "filesystem_scan",
  };
}

/** The catalog, newest commit first — the order the grid opens on. */
export const DEMO_REPOS: Repo[] = DEMO_SEEDS.map(buildRepo).sort(
  (a, b) => Date.parse(b.lastCommitDate ?? "") - Date.parse(a.lastCommitDate ?? ""),
);

const REPO_BY_SLUG = new Map(DEMO_REPOS.map((repo) => [repo.slug, repo]));

export function demoRepo(slug: string): Repo | null {
  return REPO_BY_SLUG.get(slug) ?? null;
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

const GROUP_NAMES: Array<{ folder: string; name: string; description: string }> = [
  { folder: "design", name: "Design", description: "The surface itself." },
  { folder: "services", name: "Services", description: "Long-running programs." },
  { folder: "infra", name: "Infra", description: "Everything applied to a host." },
  { folder: "graphics", name: "Graphics", description: "Pixels, one way or another." },
  { folder: "labs", name: "Labs", description: "Things that might not survive." },
  { folder: "web", name: "Web", description: "Sites and the odd fork." },
];

const countInFolder = (folder: string): number =>
  DEMO_SEEDS.filter((seed) => seed.group === folder).length;

/** Groups mirror the folders, which is what a curated library usually looks like. */
export const DEMO_GROUPS: Group[] = [
  ...GROUP_NAMES.map((entry, index) => ({
    id: index + 1,
    name: entry.name,
    description: entry.description,
    isSmart: false,
    smartFilter: null,
    parentGroupId: null,
    sortOrder: index,
    repoCount: countInFolder(entry.folder),
  })),
  {
    id: GROUP_NAMES.length + 1,
    name: "Needs work",
    description: "A dirty tree — something is uncommitted.",
    isSmart: true,
    smartFilter: { dirtyOnly: true },
    parentGroupId: null,
    sortOrder: GROUP_NAMES.length,
    repoCount: DEMO_REPOS.filter((repo) => repo.isDirty).length,
  },
];

function groupIdFor(seed: DemoSeed): number | null {
  if (!seed.group) return null;
  const index = GROUP_NAMES.findIndex((entry) => entry.folder === seed.group);
  return index === -1 ? null : index + 1;
}

export function demoDetail(slug: string): RepoDetail | null {
  const repo = demoRepo(slug);
  if (!repo) return null;
  const seed = DEMO_SEEDS.find((s) => slugForSeed(s) === slug);
  const groupId = seed ? groupIdFor(seed) : null;
  return {
    ...repo,
    readmeContent: seed ? readmeFor(seed) : null,
    groups: DEMO_GROUPS.filter((group) => group.id === groupId).map((group) => ({
      id: group.id,
      name: group.name,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function task(
  slug: string,
  name: string,
  command: string,
  detail: string | null,
): RepoTask {
  return { id: `${slug}:${name}`, name, command, detail, source: "package.json" };
}

const DEMO_TASKS: Record<string, RepoTask[]> = {
  [slugOf("lighthouse-ui")]: [
    task(slugOf("lighthouse-ui"), "dev", "pnpm dev", "vite --host"),
    task(slugOf("lighthouse-ui"), "build", "pnpm build", "tsc && vite build"),
    task(slugOf("lighthouse-ui"), "test", "pnpm test", "vitest run"),
    task(slugOf("lighthouse-ui"), "lint", "pnpm lint", "eslint ."),
    task(slugOf("lighthouse-ui"), "typecheck", "pnpm typecheck", "tsc --noEmit"),
  ],
  [slugOf("ledger-core")]: [
    task(slugOf("ledger-core"), "build", "cargo build", "--release"),
    task(slugOf("ledger-core"), "test", "cargo test", null),
  ],
  [slugOf("mailroom")]: [
    task(slugOf("mailroom"), "run", "make run", "go run ./cmd/mailroom"),
    task(slugOf("mailroom"), "test", "make test", "go test ./..."),
  ],
  [slugOf("docs-site")]: [
    task(slugOf("docs-site"), "dev", "pnpm dev", "astro dev"),
    task(slugOf("docs-site"), "build", "pnpm build", "astro build"),
  ],
  [slugOf("orchestrator")]: [
    task(slugOf("orchestrator"), "dev", "pnpm dev", "tsx watch src/index.ts"),
    task(slugOf("orchestrator"), "test", "pnpm test", "vitest run"),
  ],
  [slugOf("weatherbot")]: [
    task(slugOf("weatherbot"), "report", "make report", "python -m weatherbot.report"),
  ],
};

export function demoTasks(slug: string): RepoTask[] {
  return DEMO_TASKS[slug] ?? [];
}

// ---------------------------------------------------------------------------
// The relationship map
// ---------------------------------------------------------------------------

/**
 * Which cluster each repo belongs to.
 *
 * Derived from the links rather than the folders — that is the point of the
 * view: a cluster whose members sit in four folders is the thing worth seeing.
 * Three of these span more than one folder, so the inspector's "Scattered
 * clusters" list and its "Gather the strays" action both have something real.
 */
const CLUSTERS: Array<{ id: number; label: string; members: string[] }> = [
  {
    id: 0,
    label: "Design & docs",
    members: ["lighthouse-ui", "docs-site"],
  },
  {
    id: 1,
    label: "Services",
    members: ["ledger-core", "mailroom", "orchestrator"],
  },
  { id: 2, label: "Infra", members: ["edge-proxy", "terraform-live"] },
  { id: 3, label: "Graphics", members: ["voxel-engine", "pixel-forge"] },
  { id: 4, label: "Notebooks", members: ["weatherbot", "sketchbook"] },
  { id: 5, label: "Legacy", members: ["old-experiment"] },
];

const CLUSTER_OF = new Map<string, number>(
  CLUSTERS.flatMap((cluster) =>
    cluster.members.map((name) => [name, cluster.id] as const),
  ),
);

/** One curated assertion, as the graph builder and the store both want it. */
export interface CuratedSeed {
  from: string;
  to: string;
  kind: RepoLinkKind;
  why: string;
}

/**
 * Links a person asserted, which outrank every derived signal on the map.
 *
 * Exported because the browser bridge's store owns the live list: it seeds from
 * these three and {@link buildGraph} folds whatever it is handed, so a link
 * asserted in a browser tab reaches the map through the same builder the demo
 * library was built with.
 */
export const DEMO_CURATED_LINKS: CuratedSeed[] = [
  {
    from: "sketchbook",
    to: "weatherbot",
    kind: "related",
    why: "same forecasting idea — the notebook came first",
  },
  {
    from: "edge-proxy",
    to: "terraform-live",
    kind: "part-of",
    why: "that stack is what deploys this proxy",
  },
  {
    from: "old-experiment",
    to: "docs-site",
    kind: "supersedes",
    why: "the docs starter replaced this",
  },
];

/**
 * Derived links, by pair, before the owner mesh is added.
 *
 * Several pairs appear twice with different signals — a shared library *and* a
 * README that links the other repo is one edge carrying two reasons, which is
 * how the real builder reports them.
 */
const DERIVED: Array<{
  a: string;
  b: string;
  signals: GraphSignal[];
  why: string[];
}> = [
  {
    a: "ledger-core",
    b: "mailroom",
    signals: ["dependency"],
    why: ["shared: pgx", "shared: zerolog"],
  },
  {
    a: "edge-proxy",
    b: "terraform-live",
    signals: ["dependency", "submodule"],
    why: ["terraform providers", "edge-proxy is vendored as a submodule"],
  },
  {
    a: "voxel-engine",
    b: "pixel-forge",
    signals: ["dependency"],
    why: ["shared: glsl-shader-lib"],
  },
  {
    a: "weatherbot",
    b: "sketchbook",
    signals: ["dependency"],
    why: ["shared: pandas", "shared: jupyter"],
  },
  {
    a: "lighthouse-ui",
    b: "docs-site",
    signals: ["dependency", "reference"],
    why: ["shared: tailwindcss", "README links to docs-site"],
  },
  {
    a: "orchestrator",
    b: "ledger-core",
    signals: ["reference"],
    why: ["dispatch.ts writes through the ledger CLI"],
  },
];

const WEIGHT_OF: Record<GraphSignal, number> = {
  curated: 5,
  submodule: 3.5,
  dependency: 2.5,
  reference: 2,
  owner: 1,
  naming: 1,
};

/** Owner is read off the remote, exactly as the real builder does. */
function ownerOf(remote: string | null): string | null {
  if (!remote) return null;
  const match = /github\.com[:/]([^/]+)\//.exec(remote);
  return match?.[1] ?? null;
}

/**
 * Build the relationship map.
 *
 * Both inputs are injectable so the map can be rebuilt from live state: the
 * curves above are the seed, and `repos` carries the current folders and
 * favourites, so a move or a favourite toggled in a browser tab shows up here
 * rather than only in the list.
 */
export function buildGraph(
  curated: readonly CuratedSeed[] = DEMO_CURATED_LINKS,
  repos: readonly Repo[] = DEMO_REPOS,
): GraphResult {
  // Names are the seed vocabulary — the derived list and the curated links are
  // written in it — so the conversion comes off the repos being drawn, which is
  // also what lets a row the store dropped leave the map.
  const slugByName = new Map(repos.map((repo) => [repo.name, repo.slug]));

  interface Draft {
    source: string;
    target: string;
    signals: Set<GraphSignal>;
    why: string[];
    curated: NonNullable<GraphEdge["curated"]>;
  }

  const drafts = new Map<string, Draft>();
  const keyOf = (a: string, b: string): string =>
    a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
  const add = (
    aName: string,
    bName: string,
    signal: GraphSignal,
    why: string[],
    curated?: NonNullable<GraphEdge["curated"]>[number],
  ): void => {
    const source = slugByName.get(aName) ?? slugOf(aName);
    const target = slugByName.get(bName) ?? slugOf(bName);
    const key = keyOf(source, target);
    let draft = drafts.get(key);
    if (!draft) {
      draft = { source, target, signals: new Set(), why: [], curated: [] };
      drafts.set(key, draft);
    }
    draft.signals.add(signal);
    for (const reason of why) {
      if (!draft.why.includes(reason)) draft.why.push(reason);
    }
    if (curated) draft.curated.push(curated);
  };

  for (const link of DERIVED) {
    for (const signal of link.signals) {
      add(link.a, link.b, signal, link.why);
    }
  }

  for (const link of curated) {
    add(link.from, link.to, "curated", [link.why], {
      from: slugByName.get(link.from) ?? slugOf(link.from),
      to: slugByName.get(link.to) ?? slugOf(link.to),
      kind: link.kind,
      why: link.why,
    });
  }

  // The owner mesh: every pair whose remote belongs to the same person, read
  // off the rows being drawn so a dropped one takes its links with it.
  const owned = repos.filter((repo) => ownerOf(repo.remoteUrl) === "ivy00johns");
  for (let i = 0; i < owned.length; i += 1) {
    for (let j = i + 1; j < owned.length; j += 1) {
      const a = owned[i];
      const b = owned[j];
      if (!a || !b) continue;
      add(a.name, b.name, "owner", ["same remote owner"]);
    }
  }

  // Only the edges whose ends are both rows in this catalog can be drawn. The
  // derived list and the curated seed are written in the demo library's names,
  // so against any other catalog every one of them would point at a node that
  // is not on the map.
  const drawnSlugs = new Set(repos.map((repo) => repo.slug));
  const degree = new Map<string, number>();
  const edges: GraphEdge[] = [...drafts.values()]
    .filter((draft) => drawnSlugs.has(draft.source) && drawnSlugs.has(draft.target))
    .map((draft) => {
      const signals = [...draft.signals];
      const weight = signals.reduce(
        (sum, signal) => sum + WEIGHT_OF[signal],
        0,
      );
      degree.set(draft.source, (degree.get(draft.source) ?? 0) + 1);
      degree.set(draft.target, (degree.get(draft.target) ?? 0) + 1);
      const edge: GraphEdge = {
        source: draft.source,
        target: draft.target,
        weight,
        signals,
        why: draft.why,
      };
      if (draft.curated.length > 0) edge.curated = draft.curated;
      return edge;
    })
    .sort((a, b) => b.weight - a.weight);

  // One node per row handed in — the rows, not the seeds, are the catalog. A
  // repo the store dropped is not drawn, and one it moved reports its new
  // folder, which is what makes the cluster spread recompute.
  const nodes: GraphNode[] = repos.map((repo) => ({
    slug: repo.slug,
    name: repo.name,
    folder: repo.fullPath.slice(0, repo.fullPath.lastIndexOf("/")),
    language: repo.primaryLanguage ?? "Unknown",
    isFavorite: repo.isFavorite,
    lastCommitDate: repo.lastCommitDate,
    cluster: CLUSTER_OF.get(repo.name) ?? 0,
    degree: degree.get(repo.slug) ?? 0,
  }));

  const clusters: GraphCluster[] = CLUSTERS.map((cluster) => {
    const slugs = cluster.members.map(slugOf);
    const counts = new Map<string, number>();
    for (const slug of slugs) {
      const node = nodes.find((n) => n.slug === slug);
      const folder = node?.folder ?? DEMO_ROOT;
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    const folders = [...counts.entries()]
      .map(([folder, count]) => ({ folder, count }))
      .sort((a, b) => b.count - a.count || a.folder.localeCompare(b.folder));
    const dominantFolder = folders[0]?.folder ?? DEMO_ROOT;
    return {
      id: cluster.id,
      label: cluster.label,
      size: slugs.length,
      slugs,
      folders,
      folderSpread: folders.length,
      dominantFolder,
      strays: slugs.filter(
        (slug) => nodes.find((n) => n.slug === slug)?.folder !== dominantFolder,
      ),
    };
  });

  return { nodes, edges, clusters, builtAt: iso(LOADED_AT) };
}

/** The whole map. Built once — every route reads the same instance. */
export const DEMO_GRAPH: GraphResult = buildGraph();


/**
 * Curated links touching one repo, resolved to the other end.
 *
 * Read straight off the curated edges so the detail panel's "Curated links"
 * list and the accent arrows on the map can never disagree: they are the same
 * assertions, presented twice. `relationsFrom` takes the graph so the browser
 * bridge's store can ask its live one; `demoRelations` asks the frozen demo.
 */
export function relationsFrom(
  graph: GraphResult,
  slug: string,
): RepoRelationsResult {
  const nameOf = new Map(graph.nodes.map((node) => [node.slug, node.name]));
  const relations: RepoRelation[] = [];
  for (const edge of graph.edges) {
    for (const link of edge.curated ?? []) {
      const outgoing = link.from === slug;
      const incoming = link.to === slug;
      if (!outgoing && !incoming) continue;
      const otherSlug = outgoing ? link.to : link.from;
      relations.push({
        slug: otherSlug,
        name: nameOf.get(otherSlug) ?? otherSlug,
        kind: link.kind,
        direction: outgoing ? "outgoing" : "incoming",
        why: link.why,
        source: "ui",
        createdAt: iso(LOADED_AT - 6 * 86_400_000),
      });
    }
  }
  return { relations };
}

/** Curated links touching one repo, off the frozen demo graph. */
export function demoRelations(slug: string): RepoRelationsResult {
  return relationsFrom(DEMO_GRAPH, slug);
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

const CLAUDE_MD: Record<string, string> = {
  "lighthouse-ui": [
    "# lighthouse-ui",
    "",
    "The desktop surface. Read this before touching anything under `src/renderer`.",
    "",
    "## Commands",
    "",
    "```bash",
    "pnpm dev          # renderer + electron",
    "pnpm typecheck    # all three tsconfigs",
    "pnpm lint",
    "```",
    "",
    "## Rules",
    "",
    "- Never edit `src/shared/schemas.ts` and a handler in the same commit: the",
    "  schema is the contract, and a change there belongs on its own.",
    "- Every IPC answer is validated on the way out. A field the schema rejects",
    "  fails the whole read, so an omission shows up as an empty screen.",
    "- Prefer editing an existing component to adding a new one.",
    "",
    "> The catalog is the product. Everything else is plumbing.",
    "",
    "| File | Why it matters |",
    "| --- | --- |",
    "| `catalog-shell.tsx` | the grid, the rail and the detail panel |",
    "| `browser-bridge.ts` | the demo bridge, browser tabs only |",
    "",
    "See the [`docs/`](https://example.com/docs) folder for the decisions behind",
    "the **layout** rules.",
    "",
  ].join("\n"),
  "ledger-core": [
    "# ledger-core",
    "",
    "Double-entry ledger, append-only journal. Money is `i64` minor units, never",
    "a float — there is a test that fails the build if a float appears in a",
    "balance path.",
    "",
    "```bash",
    "cargo test        # the journal property tests matter most",
    "```",
    "",
    "- Journals are immutable once written; corrections are new entries.",
    "- An unbalanced entry is a hard error, not a warning.",
    "",
  ].join("\n"),
  "docs-site": [
    "# docs-site",
    "",
    "A fork of a docs starter, kept for the plugin examples.",
    "",
    "```bash",
    "pnpm dev",
    "```",
    "",
  ].join("\n"),
  orchestrator: [
    "# orchestrator",
    "",
    "Dispatch layer: a work graph, a fleet of workers, a merge queue.",
    "",
    "```bash",
    "pnpm test --filter worktree",
    "```",
    "",
    "- One worker per worktree; never share a checkout between two workers.",
    "- The merge queue is serial by design. Do not parallelise it.",
    "",
  ].join("\n"),
};

function usage(totalTokens: number, seedOffset = 0): TokenUsage {
  const inputTokens = Math.round(totalTokens * 0.34) + seedOffset;
  const cacheCreationInputTokens = Math.round(totalTokens * 0.22);
  const cacheReadInputTokens = Math.round(totalTokens * 0.31);
  const outputTokens =
    totalTokens -
    inputTokens -
    cacheCreationInputTokens -
    cacheReadInputTokens;
  return {
    inputTokens,
    outputTokens: Math.max(0, outputTokens),
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens,
  };
}

/** Deterministic 0..1 noise. Stable across reloads, unlike `Math.random`. */
function noise(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43_758.5453;
  return value - Math.floor(value);
}

interface SessionSeed {
  id: string;
  messages: number;
  tokens: number;
  /** Hours before "now" that the session started. */
  startedHoursAgo: number;
  /** Hours before "now" that it last did something. */
  lastHoursAgo: number;
}

const uuid = (seed: number): string => {
  const hex = (n: number): string =>
    Math.floor(noise(seed + n) * 0xffff)
      .toString(16)
      .padStart(4, "0");
  return `${hex(1)}${hex(2)}-${hex(3)}-4${hex(4).slice(1)}-a${hex(5).slice(1)}-${hex(6)}${hex(7)}${hex(8)}`;
};

const SESSIONS: Record<string, SessionSeed[]> = {
  "lighthouse-ui": [
    { id: uuid(11), messages: 412, tokens: 218_400, startedHoursAgo: 9, lastHoursAgo: 3 },
    { id: uuid(12), messages: 168, tokens: 84_900, startedHoursAgo: 52, lastHoursAgo: 48 },
    { id: uuid(13), messages: 96, tokens: 31_200, startedHoursAgo: 190, lastHoursAgo: 186 },
  ],
  "ledger-core": [
    { id: uuid(21), messages: 233, tokens: 121_600, startedHoursAgo: 27, lastHoursAgo: 26 },
    { id: uuid(22), messages: 74, tokens: 28_100, startedHoursAgo: 310, lastHoursAgo: 308 },
  ],
  "docs-site": [
    { id: uuid(31), messages: 58, tokens: 19_800, startedHoursAgo: 300, lastHoursAgo: 299 },
  ],
  orchestrator: [
    { id: uuid(41), messages: 301, tokens: 152_300, startedHoursAgo: 8, lastHoursAgo: 6 },
    { id: uuid(42), messages: 187, tokens: 71_400, startedHoursAgo: 30, lastHoursAgo: 29 },
    { id: uuid(43), messages: 122, tokens: 44_050, startedHoursAgo: 96, lastHoursAgo: 95 },
    { id: uuid(44), messages: 61, tokens: 18_600, startedHoursAgo: 400, lastHoursAgo: 399 },
  ],
};

/** Claude's own directory hash: the absolute path with every `/` as a `-`. */
const projectHashFor = (repo: Repo): string =>
  repo.fullPath.replaceAll("/", "-");

const SKILLS: Record<string, Array<{ name: string; description: string }>> = {
  "lighthouse-ui": [
    {
      name: "catalog-ui",
      description: "Conventions for the grid, the rail and the detail panel.",
    },
    {
      name: "prose-guard",
      description: "Check a sentence against the house style before it ships.",
    },
  ],
  "ledger-core": [
    {
      name: "ledger-rules",
      description: "The invariants a journal entry has to satisfy.",
    },
  ],
  "docs-site": [
    { name: "docs-style", description: "How a page in this site is written." },
  ],
  orchestrator: [
    {
      name: "worktrees",
      description: "One worker per worktree — how to set that up.",
    },
    { name: "merge-queue", description: "Landing a branch through the queue." },
  ],
};

const AGENTS: Record<string, Array<{ name: string; description: string }>> = {
  "lighthouse-ui": [
    {
      name: "reviewer",
      description: "Reads a diff against the layout rules and reports drift.",
    },
  ],
  orchestrator: [
    {
      name: "planner",
      description: "Turns a goal into a work graph before anyone starts.",
    },
  ],
};

const MCP_SERVERS: Record<string, ClaudeMcpServer[]> = {
  "lighthouse-ui": [
    {
      name: "alltherepos",
      type: "stdio",
      command: "node",
      args: ["mcp/dist/index.js"],
      configuredIn: "project",
      status: "running",
    },
    {
      name: "playwright",
      type: "stdio",
      command: "npx",
      args: ["@playwright/mcp"],
      configuredIn: "global",
      status: "configured",
    },
  ],
  "ledger-core": [
    {
      name: "context7",
      type: "sse",
      command: null,
      args: null,
      configuredIn: "global",
      status: "configured",
    },
  ],
  "docs-site": [
    {
      name: "astro-docs",
      type: "http",
      command: null,
      args: null,
      configuredIn: "project",
      status: "unavailable",
    },
  ],
  orchestrator: [
    {
      name: "alltherepos",
      type: "stdio",
      command: "node",
      args: ["mcp/dist/index.js"],
      configuredIn: "project",
      status: "running",
    },
  ],
};

function sessionFrom(slug: string, seed: SessionSeed): ClaudeSession {
  return {
    id: seed.id,
    projectHash: `-Users-demo-Code-${slug}`,
    startedAt: iso(LOADED_AT - seed.startedHoursAgo * 3_600_000),
    lastActivityAt: iso(LOADED_AT - seed.lastHoursAgo * 3_600_000),
    messageCount: seed.messages,
    tokenUsage: usage(seed.tokens),
    filePath: `/Users/demo/.claude/projects/-Users-demo-Code-${slug}/${seed.id}.jsonl`,
    sizeBytes: seed.messages * 2_400,
  };
}

/**
 * Full Claude state for one repo.
 *
 * Four repos have it and eight do not, on purpose: the tab has an empty state
 * worth looking at too, and a demo where every repo is identical hides it.
 */
export function demoClaudeRepoState(slug: string): ClaudeRepoState {
  const repo = demoRepo(slug);
  const empty: ClaudeRepoState = {
    hasClaude: false,
    claudeMdPath: null,
    claudeMdContent: null,
    settingsPath: null,
    generatedAt: LOADED_AT,
    skills: [],
    agents: [],
    mcpServers: [],
    sessions: [],
    totalTokens: 0,
  };
  if (!repo) return empty;

  const claudeMd = CLAUDE_MD[repo.name];
  if (!claudeMd) return empty;

  const sessions = (SESSIONS[repo.name] ?? []).map((seed) =>
    sessionFrom(repo.name, seed),
  ).map((session) => ({ ...session, projectHash: projectHashFor(repo) }));

  const skills: ClaudeSkill[] = (SKILLS[repo.name] ?? []).map((skill) => ({
    name: skill.name,
    description: skill.description,
    path: `${repo.fullPath}/.claude/skills/${skill.name}/SKILL.md`,
    frontmatter: { name: skill.name, description: skill.description },
  }));

  const agents: ClaudeAgent[] = (AGENTS[repo.name] ?? []).map((agent) => ({
    name: agent.name,
    description: agent.description,
    path: `${repo.fullPath}/.claude/agents/${agent.name}.md`,
    frontmatter: { name: agent.name, description: agent.description },
  }));

  return {
    hasClaude: true,
    claudeMdPath: `${repo.fullPath}/CLAUDE.md`,
    claudeMdContent: claudeMd,
    settingsPath: `${repo.fullPath}/.claude/settings.json`,
    generatedAt: LOADED_AT,
    skills,
    agents,
    mcpServers: MCP_SERVERS[repo.name] ?? [],
    sessions,
    totalTokens: sessions.reduce(
      (sum, session) => sum + session.tokenUsage.totalTokens,
      0,
    ),
  };
}

/** A project Claude knows about but the catalog does not — the unmatched row. */
const UNMATCHED_PROJECT = {
  hash: "-Users-demo-scratch-notes",
  repoPath: "/Users/demo/scratch/notes",
  repoSlug: null,
};

/** Every Claude project, i.e. one row per `~/.claude.json` entry. */
export const DEMO_CLAUDE_PROJECTS: ClaudeProject[] = [
  ...DEMO_REPOS.filter((repo) => Boolean(CLAUDE_MD[repo.name])).map((repo) => {
    const state = demoClaudeRepoState(repo.slug);
    const last = state.sessions.reduce<string | null>((latest, session) => {
      if (!session.lastActivityAt) return latest;
      if (!latest) return session.lastActivityAt;
      return Date.parse(session.lastActivityAt) > Date.parse(latest)
        ? session.lastActivityAt
        : latest;
    }, null);
    return {
      hash: projectHashFor(repo),
      repoPath: repo.fullPath,
      repoSlug: repo.slug,
      sessionCount: state.sessions.length,
      lastActivityAt: last,
      totalTokens: state.totalTokens,
    };
  }),
  {
    ...UNMATCHED_PROJECT,
    sessionCount: 2,
    lastActivityAt: iso(LOADED_AT - 64 * 3_600_000),
    totalTokens: 26_700,
  },
];

// -- global usage -----------------------------------------------------------

const ymd = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const atMidnight = (date: Date): Date => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

/** Monday of the ISO week containing `date`. */
function mondayOf(date: Date): Date {
  const copy = atMidnight(date);
  const day = (copy.getDay() + 6) % 7; // 0 = Monday
  copy.setDate(copy.getDate() - day);
  return copy;
}

/** A plausible day of work: quiet weekends, a ramp that decays with age. */
function tokensForDay(dayIndex: number, date: Date): number {
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  const recency = 0.45 + 0.55 * (dayIndex / 180);
  const roll = 0.15 + 0.85 * noise(dayIndex * 1.7 + 31);
  const base = weekend ? 9_000 : 78_000;
  return Math.round(base * recency * roll);
}

/** Usage is generated for the whole history and filtered by the range asked for. */
function buildGlobalUsage(): ClaudeGlobalUsageResult {
  const today = atMidnight(new Date(LOADED_AT));
  const days: Array<{ date: string; totalTokens: number }> = [];
  for (let i = 179; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    days.push({ date: ymd(date), totalTokens: tokensForDay(i, date) });
  }

  const weeks = new Map<string, number>();
  const months = new Map<string, number>();
  for (const day of days) {
    const weekStart = ymd(mondayOf(new Date(`${day.date}T00:00:00`)));
    weeks.set(weekStart, (weeks.get(weekStart) ?? 0) + day.totalTokens);
    const monthStart = `${day.date.slice(0, 7)}-01`;
    months.set(monthStart, (months.get(monthStart) ?? 0) + day.totalTokens);
  }

  const byWeek = [...weeks.entries()]
    .map(([weekStart, totalTokens]) => ({ weekStart, totalTokens }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  const last13 = byWeek.slice(-13);

  /**
   * A project's own weekly series. Real per-project series are what the
   * sparkline draws, so each one gets a share of the tail with its own wiggle
   * rather than a scaled copy of the global line.
   */
  const byProject = DEMO_CLAUDE_PROJECTS.map((project, index) => {
    const share = project.totalTokens / Math.max(1, totalOf(DEMO_CLAUDE_PROJECTS));
    return {
      hash: project.hash,
      repoPath: project.repoPath,
      repoSlug: project.repoSlug,
      totalTokens: project.totalTokens,
      byWeek: last13.map((week, weekIndex) => ({
        weekStart: week.weekStart,
        totalTokens: Math.round(
          week.totalTokens * share * (0.6 + 0.8 * noise(index * 13 + weekIndex)),
        ),
      })),
    };
  });

  return {
    totalTokens: days.reduce((sum, day) => sum + day.totalTokens, 0),
    byProject,
    byDay: days,
    byWeek,
    byMonth: [...months.entries()]
      .map(([monthStart, totalTokens]) => ({ monthStart, totalTokens }))
      .sort((a, b) => a.monthStart.localeCompare(b.monthStart)),
  };
}

function totalOf(projects: ClaudeProject[]): number {
  return projects.reduce((sum, project) => sum + project.totalTokens, 0);
}

const GLOBAL_USAGE = buildGlobalUsage();

/**
 * Global usage for a range.
 *
 * Only the requested window is returned, because the heatmap fills a fixed
 * trailing window from whatever it is given: handing it the whole history would
 * quietly ignore the range selector.
 */
export function demoGlobalUsage(
  input: ClaudeGlobalUsageInput,
): ClaudeGlobalUsageResult {
  const from = input.from ?? null;
  const to = input.to ?? null;
  if (!from && !to) return GLOBAL_USAGE;
  const byDay = GLOBAL_USAGE.byDay.filter(
    (day) => (!from || day.date >= from) && (!to || day.date <= to),
  );
  const inRange = new Set(byDay.map((day) => day.date));
  const scale = (weekStart: string): boolean => {
    // Keep a week when any of its days survived the filter.
    for (let i = 0; i < 7; i += 1) {
      const date = new Date(`${weekStart}T00:00:00`);
      date.setDate(date.getDate() + i);
      if (inRange.has(ymd(date))) return true;
    }
    return false;
  };
  return {
    ...GLOBAL_USAGE,
    totalTokens: byDay.reduce((sum, day) => sum + day.totalTokens, 0),
    byDay,
    byWeek: GLOBAL_USAGE.byWeek.filter((week) => scale(week.weekStart)),
    byMonth: GLOBAL_USAGE.byMonth.filter((month) => {
      const prefix = month.monthStart.slice(0, 7);
      return byDay.some((day) => day.date.startsWith(prefix));
    }),
  };
}

// -- transcripts ------------------------------------------------------------

const TRANSCRIPT_EVENTS_PER_PAGE = 12;
const TRANSCRIPT_PAGES = 3;

/**
 * A session's transcript, paged by cursor the way the real reader is.
 *
 * The events are invented from the session id, so any session the UI opens has
 * something to page through and the "Load more" control is exercisable.
 */
export function demoTranscript(
  sessionId: string,
  cursor: number,
): ClaudeSessionTranscriptResult {
  const total = TRANSCRIPT_EVENTS_PER_PAGE * TRANSCRIPT_PAGES;
  const start = Math.max(0, cursor);
  const end = Math.min(total, start + TRANSCRIPT_EVENTS_PER_PAGE);
  const seed = [...sessionId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);

  const events: TranscriptEvent[] = [];
  for (let i = start; i < end; i += 1) {
    const roll = noise(seed + i);
    const isUser = roll < 0.4;
    const isTool = roll >= 0.4 && roll < 0.55;
    const type = isUser ? "user" : isTool ? "tool_use" : "assistant";
    const text = isUser
      ? SUMMARIES[i % SUMMARIES.length]
      : isTool
        ? `Read src/renderer/lib/browser-bridge.ts (${120 + i * 7} lines)`
        : REPLIES[i % REPLIES.length];
    events.push({
      type,
      timestamp: iso(LOADED_AT - (start - i + 20) * 90_000),
      uuid: uuid(seed + i * 3),
      message: isTool
        ? { content: [{ type: "tool_use", name: "Read", text }] }
        : { role: isUser ? "user" : "assistant", content: [{ type: "text", text }] },
    });
  }

  const nextCursor = end < total ? end : null;
  return { events, nextCursor, hasMore: nextCursor !== null };
}

const SUMMARIES = [
  "The rail row narrows the grid but the scope chip keeps the old folder name.",
  "Give the Claude tab a collapsed default — it buries the README otherwise.",
  "Check the graph with the owner signal switched off; it should thin out.",
  "Can you look at the settings page and tell me if the update row reads clearly?",
  "The prose gate is complaining about a sentence I did not write.",
  "Make the demo bridge cover every route so I can review it in a browser tab.",
];

const REPLIES = [
  "Found it — the chip was built from the folder the row was rendered under, not the one it filters to. Fixed, and the assertion now reads the chip's text.",
  "Wrapped it in the same disclosure the tasks list uses, so the README keeps the first screen.",
  "It does thin out: the mesh drops from 36 links to the eight that carry a stronger signal, which is the point of the filter.",
  "The update row states the version, the check button and why this build cannot install — it reads clearly, but the refusal sentence is long.",
  "That sentence is in the changelog, not the docs. The gate only reads tracked prose.",
  "Done: the bridge now answers the graph, Claude, process and settings reads from one demo library.",
];

// ---------------------------------------------------------------------------
// Listening dev servers
// ---------------------------------------------------------------------------

function processRow(
  pid: number,
  port: number,
  command: string,
  commandLine: string,
  minutesAgo: number,
  cwd: string | null,
): ProcessInfo {
  return {
    pid,
    ppid: Math.max(1, pid - 900),
    command,
    commandLine,
    port,
    protocol: "tcp",
    cwd,
    repoSlug: cwd
      ? (DEMO_REPOS.find((repo) => repo.fullPath === cwd)?.slug ?? null)
      : null,
    firstSeenAt: LOADED_AT - minutesAgo * 60_000,
    observedAt: LOADED_AT,
  };
}

/**
 * The listening servers.
 *
 * Two ports on one repo, so a card shows a row of chips rather than a lone one;
 * one row with no repo, so `(unmatched)` renders; and every matched row points
 * at a slug the catalog actually holds, which is what makes the chip clickable
 * through to the repo.
 */
export const DEMO_PROCESSES: ListProcessesResult = {
  processes: [
    processRow(
      41_220,
      3_000,
      "node",
      "node node_modules/.bin/vite --port 3000",
      18,
      `${DEMO_ROOT}/design/lighthouse-ui`,
    ),
    processRow(
      41_231,
      4_000,
      "node",
      "node node_modules/.bin/storybook dev -p 4000",
      6,
      `${DEMO_ROOT}/design/lighthouse-ui`,
    ),
    processRow(
      41_244,
      5_173,
      "node",
      "node node_modules/.bin/astro dev --port 5173",
      2,
      `${DEMO_ROOT}/web/docs-site`,
    ),
    processRow(
      41_260,
      8_080,
      "mailroom",
      "./mailroom serve --config config.toml --port 8080",
      47,
      `${DEMO_ROOT}/services/mailroom`,
    ),
    processRow(
      41_271,
      11_434,
      "ollama",
      "ollama serve",
      183,
      "/Users/demo/Library/Caches/ollama",
    ),
  ],
  snapshotAt: LOADED_AT,
};

// ---------------------------------------------------------------------------
// Settings, launcher detection, updates
// ---------------------------------------------------------------------------

export const DEMO_SETTINGS: Settings = {
  scanPaths: [DEMO_ROOT],
  ollamaBaseUrl: "http://localhost:11434",
  ollamaEmbedModel: "nomic-embed-text",
  openaiEmbedModel: null,
  defaultEditor: "vscode",
  defaultTerminal: "iterm2",
  identities: ["ivy00johns"],
  adHocNoticeDismissed: true,
  schemaVersion: 1,
};

export const DEMO_LAUNCHER: DetectLauncherResult = {
  editors: [
    {
      id: "vscode",
      name: "Visual Studio Code",
      available: true,
      scheme: "vscode",
      appPath: "/Applications/Visual Studio Code.app",
      cliPath: "/usr/local/bin/code",
    },
    {
      id: "cursor",
      name: "Cursor",
      available: true,
      scheme: "cursor",
      appPath: "/Applications/Cursor.app",
      cliPath: "/usr/local/bin/cursor",
    },
    {
      id: "zed",
      name: "Zed",
      available: true,
      scheme: "zed",
      appPath: "/Applications/Zed.app",
      cliPath: null,
    },
    {
      id: "sublime",
      name: "Sublime Text",
      available: true,
      scheme: "subl",
      appPath: "/Applications/Sublime Text.app",
      cliPath: "/usr/local/bin/subl",
    },
    {
      id: "xcode",
      name: "Xcode",
      available: false,
      scheme: "xcode",
      appPath: null,
      cliPath: null,
    },
  ],
  terminals: [
    {
      id: "terminal",
      name: "Terminal",
      available: true,
      appPath: "/System/Applications/Utilities/Terminal.app",
    },
    {
      id: "iterm2",
      name: "iTerm2",
      available: true,
      appPath: "/Applications/iTerm.app",
    },
    {
      id: "warp",
      name: "Warp",
      available: false,
      appPath: null,
    },
  ],
  defaults: { editor: "vscode", terminal: "iterm2" },
};

/**
 * An update waiting for a person.
 *
 * `canInstall: false` with `signature: "ad-hoc"` on purpose: it is the common
 * case (a local build, or a DMG that has not been notarised), and it is the one
 * that exercises the settings row's explanation instead of a bare button.
 */
export const DEMO_UPDATE: UpdateStatus = {
  state: "available",
  currentVersion: "0.1.8",
  newVersion: "0.1.9",
  releaseUrl:
    "https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.9",
  message:
    "Checked 12 minutes ago — a newer release is published. This is demo data: " +
    "there is no such release, and nothing on this screen was read from a feed.",
  checkedAt: iso(LOADED_AT - 12 * 60_000),
  canInstall: false,
  signature: "ad-hoc",
  progress: null,
};

/** Exposed for the demo's own tests, which check the numbers add up. */
export const DEMO_META = {
  loadedAt: LOADED_AT,
  languagesTotal: (seed: string): number => {
    const found = DEMO_SEEDS.find((s) => s.name === seed);
    return found ? LANGUAGES_TOTAL(found) : 0;
  },
} as const;
