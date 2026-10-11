/**
 * Heuristic tag inference for repos.
 *
 * Deterministic, manifest-first (docs/plans/2026-10-10-useful-repo-tags.md,
 * step 1–2). Given a repo root plus parsed languages, returns a deduplicated
 * `Tag[]` of at most `MAX_TAGS` entries, ordered by usefulness: purpose first,
 * then frameworks, language, tooling.
 *
 * Rules:
 * - Never read the README: its prose can say anything, and purpose is decided
 *   from manifests, dependencies, entrypoints and build layout instead.
 * - Never run repository code.
 * - Format-only languages (JSON, YAML, Markdown, …) never become tags. They say
 *   nothing about what a repo is for.
 */

import fs from "node:fs";
import path from "node:path";

import type { LanguageBytes, Tag } from "@shared/types";

export interface HeuristicInput {
  fullPath: string;
  languages: LanguageBytes[];
  /** Not used for classification (README text is untrusted prose). Kept for callers. */
  readmeContent: string | null;
}

/** Usefulness cap — a few well-supported tags beat a full quota. */
export const MAX_TAGS = 6;

/**
 * Tooling that says how a repo ships. These always keep their slot under the
 * cap, so a repo with many frameworks still shows its CI and Docker setup.
 */
const RESERVED_TOOLING = new Set(["docker", "ci"]);

/**
 * A remembered answer to a cleanup proposal. `add`: the user rejected a tag the
 * rules wanted to add, so it stays off. `keep`: the user rejected removing a
 * tag, so it stays on.
 */
export type TagRejectionKind = "add" | "keep";

/**
 * Apply remembered cleanup answers to a freshly inferred heuristic set.
 *
 * `current` is the stored heuristic set, used only to restore `keep` values.
 * Pure: it reads no database and no disk, so the rescan merge and the cleanup
 * preview share one rule.
 */
export function applyTagRejections(
  inferred: Tag[],
  current: Tag[],
  rejections: ReadonlyMap<string, TagRejectionKind>,
): Tag[] {
  const out: Tag[] = [];
  const seen = new Set<string>();
  for (const t of current) {
    if (t.source === "user" || seen.has(t.value)) continue;
    if (rejections.get(t.value) !== "keep") continue;
    seen.add(t.value);
    out.push({ value: t.value, source: "heuristic" });
  }
  for (const t of inferred) {
    if (seen.has(t.value) || rejections.get(t.value) === "add") continue;
    seen.add(t.value);
    out.push(t);
  }
  return out;
}

/** Languages that describe a file format or documentation, not a program. */
const FORMAT_ONLY_LANGUAGES = new Set([
  "json",
  "jsonc",
  "json5",
  "yaml",
  "toml",
  "xml",
  "ini",
  "csv",
  "markdown",
  "mdx",
  "text",
  "plain text",
  "restructuredtext",
  "asciidoc",
  "svg",
  "lock",
]);

/** Safe file read — returns null on any failure (ENOENT, permission, binary blowup). */
function readFileSafe(fp: string, maxBytes = 256 * 1024): string | null {
  try {
    const stat = fs.statSync(fp);
    if (!stat.isFile()) return null;
    if (stat.size > maxBytes) {
      const buf = Buffer.alloc(maxBytes);
      const fd = fs.openSync(fp, "r");
      try {
        fs.readSync(fd, buf, 0, maxBytes, 0);
      } finally {
        fs.closeSync(fd);
      }
      return buf.toString("utf8");
    }
    return fs.readFileSync(fp, "utf8");
  } catch {
    return null;
  }
}

function existsFile(fp: string): boolean {
  try {
    return fs.statSync(fp).isFile();
  } catch {
    return false;
  }
}

function existsDir(fp: string): boolean {
  try {
    return fs.statSync(fp).isDirectory();
  } catch {
    return false;
  }
}

/** Root-level entry names, bounded to a single directory read. */
function rootEntries(root: string): string[] {
  try {
    return fs.readdirSync(root);
  } catch {
    return [];
  }
}

const JS_FRAMEWORKS: Record<string, string> = {
  next: "next",
  react: "react",
  "react-dom": "react",
  vue: "vue",
  svelte: "svelte",
  "@sveltejs/kit": "sveltekit",
  express: "express",
  fastify: "fastify",
  hono: "hono",
  "@nestjs/core": "nestjs",
  remix: "remix",
  "@remix-run/node": "remix",
  astro: "astro",
  electron: "electron",
  tauri: "tauri",
  "@tauri-apps/api": "tauri",
};

/** Framework tags that mean "this repo has a browser front end". */
const FRONTEND_FRAMEWORKS = new Set([
  "react",
  "vue",
  "svelte",
  "sveltekit",
  "next",
  "remix",
  "astro",
]);

/** Framework tags that mean "this repo serves requests". */
const SERVER_FRAMEWORKS = new Set([
  "express",
  "fastify",
  "hono",
  "nestjs",
  "axum",
  "actix",
  "rocket",
  "gin",
  "echo",
  "fiber",
  "fastapi",
  "flask",
  "django",
  "rails",
  "sinatra",
]);

/** Framework tags that mean "this repo is a desktop application". */
const DESKTOP_FRAMEWORKS = new Set(["electron", "tauri"]);

/** Purpose evidence gathered while reading manifests. */
interface Evidence {
  frameworks: Set<string>;
  cli: boolean;
  library: boolean;
  infrastructure: boolean;
  docs: boolean;
  hasManifest: boolean;
}

function addTag(set: Map<string, Tag>, value: string): void {
  if (!set.has(value)) {
    set.set(value, { value, source: "heuristic" });
  }
}

function detectPackageJson(
  root: string,
  out: Map<string, Tag>,
  ev: Evidence,
): void {
  const raw = readFileSafe(path.join(root, "package.json"));
  if (!raw) return;
  let pkg: {
    private?: boolean;
    main?: unknown;
    exports?: unknown;
    types?: unknown;
    bin?: unknown;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    engines?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(raw);
  } catch {
    return;
  }
  ev.hasManifest = true;
  addTag(out, "node");
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  };
  for (const key of Object.keys(deps)) {
    const tag = JS_FRAMEWORKS[key];
    if (tag) {
      addTag(out, tag);
      ev.frameworks.add(tag);
    }
  }
  if (pkg.engines?.bun) addTag(out, "bun");
  if (pkg.bin !== undefined) ev.cli = true;
  const hasEntry =
    pkg.main !== undefined ||
    pkg.exports !== undefined ||
    pkg.types !== undefined;
  if (hasEntry && pkg.private !== true) ev.library = true;
}

function detectCargo(root: string, out: Map<string, Tag>, ev: Evidence): void {
  const raw = readFileSafe(path.join(root, "Cargo.toml"));
  if (!raw) return;
  ev.hasManifest = true;
  addTag(out, "rust");
  const frameworks: Array<[RegExp, string]> = [
    [/\baxum\s*=/, "axum"],
    [/\btauri\s*=/, "tauri"],
    [/\bbevy\s*=/, "bevy"],
    [/\btokio\s*=/, "tokio"],
    [/\bactix-web\s*=/, "actix"],
    [/\brocket\s*=/, "rocket"],
  ];
  for (const [re, tag] of frameworks) {
    if (re.test(raw)) {
      addTag(out, tag);
      ev.frameworks.add(tag);
    }
  }
  if (/\bclap\s*=/.test(raw) || /^\[\[bin\]\]/m.test(raw)) ev.cli = true;
  if (/^\[lib\]/m.test(raw) && !/^\[\[bin\]\]/m.test(raw)) ev.library = true;
}

function detectGoMod(root: string, out: Map<string, Tag>, ev: Evidence): void {
  const raw = readFileSafe(path.join(root, "go.mod"));
  if (!raw) return;
  ev.hasManifest = true;
  addTag(out, "go");
  const frameworks: Array<[RegExp, string]> = [
    [/github\.com\/gin-gonic\/gin/, "gin"],
    [/github\.com\/labstack\/echo/, "echo"],
    [/github\.com\/gofiber\/fiber/, "fiber"],
  ];
  for (const [re, tag] of frameworks) {
    if (re.test(raw)) {
      addTag(out, tag);
      ev.frameworks.add(tag);
    }
  }
  if (existsDir(path.join(root, "cmd"))) ev.cli = true;
}

function detectPython(root: string, out: Map<string, Tag>, ev: Evidence): void {
  const py = readFileSafe(path.join(root, "pyproject.toml"));
  const req = readFileSafe(path.join(root, "requirements.txt"));
  if (!py && !req) return;
  ev.hasManifest = true;
  addTag(out, "python");
  const blob = `${py ?? ""}\n${req ?? ""}`;
  const frameworks: Array<[RegExp, string]> = [
    [/\bdjango\b/i, "django"],
    [/\bflask\b/i, "flask"],
    [/\bfastapi\b/i, "fastapi"],
    [/\btorch\b|\bpytorch\b/i, "pytorch"],
    [/\btensorflow\b/i, "tensorflow"],
    [/\bnumpy\b/i, "numpy"],
  ];
  for (const [re, tag] of frameworks) {
    if (re.test(blob)) {
      if (SERVER_FRAMEWORKS.has(tag)) ev.frameworks.add(tag);
      addTag(out, tag);
    }
  }
  if (py && /^\[project\.scripts\]/m.test(py)) ev.cli = true;
  if (py && /^\[tool\.poetry\.scripts\]/m.test(py)) ev.cli = true;
  if (py && /^\[project\]/m.test(py) && !/^\[project\.scripts\]/m.test(py)) {
    ev.library = true;
  }
}

function detectRuby(root: string, out: Map<string, Tag>, ev: Evidence): void {
  const raw = readFileSafe(path.join(root, "Gemfile"));
  if (!raw) return;
  ev.hasManifest = true;
  addTag(out, "ruby");
  if (/\brails\b/.test(raw)) {
    addTag(out, "rails");
    ev.frameworks.add("rails");
  }
  if (/\bsinatra\b/.test(raw)) {
    addTag(out, "sinatra");
    ev.frameworks.add("sinatra");
  }
}

function detectDocker(root: string, out: Map<string, Tag>): void {
  if (
    existsFile(path.join(root, "Dockerfile")) ||
    existsFile(path.join(root, "docker-compose.yml")) ||
    existsFile(path.join(root, "docker-compose.yaml"))
  ) {
    addTag(out, "docker");
  }
}

function detectCI(root: string, out: Map<string, Tag>): void {
  if (
    existsDir(path.join(root, ".github", "workflows")) ||
    existsFile(path.join(root, ".gitlab-ci.yml")) ||
    existsFile(path.join(root, "circle.yml")) ||
    existsFile(path.join(root, ".circleci", "config.yml"))
  ) {
    addTag(out, "ci");
  }
}

function detectMonorepo(root: string, out: Map<string, Tag>): void {
  if (
    existsFile(path.join(root, "pnpm-workspace.yaml")) ||
    existsFile(path.join(root, "lerna.json")) ||
    existsFile(path.join(root, "turbo.json")) ||
    existsFile(path.join(root, "nx.json"))
  ) {
    addTag(out, "monorepo");
  }
}

function detectOtherEcosystems(root: string, out: Map<string, Tag>): void {
  if (existsFile(path.join(root, "pom.xml"))) addTag(out, "java");
  if (
    existsFile(path.join(root, "build.gradle")) ||
    existsFile(path.join(root, "build.gradle.kts"))
  ) {
    addTag(out, "gradle");
  }
  if (existsFile(path.join(root, "composer.json"))) addTag(out, "php");
  if (existsFile(path.join(root, "Package.swift"))) addTag(out, "swift");
  if (existsFile(path.join(root, "mix.exs"))) addTag(out, "elixir");
  if (existsFile(path.join(root, "pubspec.yaml"))) addTag(out, "dart");
  if (
    existsFile(path.join(root, "flake.nix")) ||
    existsFile(path.join(root, "default.nix"))
  ) {
    addTag(out, "nix");
  }
}

/** Root-level infrastructure evidence: IaC files or the conventional directories. */
function detectInfrastructureEvidence(root: string, ev: Evidence): void {
  const names = rootEntries(root);
  const iacDirs = new Set([
    "terraform",
    "infra",
    "infrastructure",
    "k8s",
    "kubernetes",
    "helm",
    "ansible",
  ]);
  for (const name of names) {
    if (name.endsWith(".tf")) ev.infrastructure = true;
    if (iacDirs.has(name) && existsDir(path.join(root, name)))
      ev.infrastructure = true;
  }
  if (
    existsFile(path.join(root, "Chart.yaml")) ||
    existsFile(path.join(root, "Pulumi.yaml"))
  ) {
    ev.infrastructure = true;
  }
}

/** Root-level docs-site evidence, only meaningful when no code manifest exists. */
function detectDocsEvidence(root: string, ev: Evidence): void {
  if (
    existsFile(path.join(root, "mkdocs.yml")) ||
    existsFile(path.join(root, "book.toml")) ||
    existsFile(path.join(root, "docusaurus.config.js")) ||
    existsFile(path.join(root, "docusaurus.config.ts")) ||
    existsDir(path.join(root, "docs"))
  ) {
    ev.docs = true;
  }
}

/**
 * The single purpose a repo most plausibly serves, from the evidence collected.
 * Ordered so the more specific signal wins: a desktop shell beats the web UI it
 * hosts, a CLI beats a library, a server beats nothing.
 */
function purposeFrom(ev: Evidence, root: string): string | null {
  if ([...ev.frameworks].some((f) => DESKTOP_FRAMEWORKS.has(f)))
    return "desktop-app";
  if (ev.cli) return "cli";
  const frontend = [...ev.frameworks].some((f) => FRONTEND_FRAMEWORKS.has(f));
  if (frontend || existsFile(path.join(root, "index.html"))) return "web-app";
  if ([...ev.frameworks].some((f) => SERVER_FRAMEWORKS.has(f))) return "api";
  if (ev.infrastructure) return "infrastructure";
  if (ev.library) return "library";
  if (ev.docs && !ev.hasManifest) return "docs";
  return null;
}

/**
 * Run all heuristic detectors on a repo root and return a deduplicated Tag[].
 * Ordered by usefulness and capped at `MAX_TAGS`.
 */
export function inferTags(input: HeuristicInput): Tag[] {
  const out = new Map<string, Tag>();
  const root = input.fullPath;
  const ev: Evidence = {
    frameworks: new Set(),
    cli: false,
    library: false,
    infrastructure: false,
    docs: false,
    hasManifest: false,
  };

  detectPackageJson(root, out, ev);
  detectCargo(root, out, ev);
  detectGoMod(root, out, ev);
  detectPython(root, out, ev);
  detectRuby(root, out, ev);
  detectInfrastructureEvidence(root, ev);
  detectDocsEvidence(root, ev);
  detectDocker(root, out);
  detectCI(root, out);
  detectMonorepo(root, out);
  detectOtherEcosystems(root, out);

  // Reserved tooling is counted against the cap up front, so it always fits.
  const reserved = [...out.values()].filter((t) =>
    RESERVED_TOOLING.has(t.value),
  );
  const budget = MAX_TAGS - reserved.length;
  const has = (value: string) => ordered.some((t) => t.value === value);

  // Purpose leads the list; it is the most useful thing a tag can say.
  const ordered: Tag[] = [];
  const purpose = purposeFrom(ev, root);
  if (purpose) ordered.push({ value: purpose, source: "heuristic" });

  // Frameworks and runtimes, in detection order, within the budget.
  for (const tag of out.values()) {
    if (ordered.length >= budget) break;
    if (RESERVED_TOOLING.has(tag.value) || has(tag.value)) continue;
    ordered.push(tag);
  }

  // Primary *programming* language, lowercased. Format-only languages never
  // reach here, so a configuration-heavy repo cannot be tagged "json".
  const primary = input.languages
    .map((l) => l.name.toLowerCase())
    .find((name) => !FORMAT_ONLY_LANGUAGES.has(name));
  if (primary && ordered.length < budget && !has(primary)) {
    ordered.push({ value: primary, source: "heuristic" });
  }

  for (const tag of reserved) {
    if (!has(tag.value)) ordered.push(tag);
  }

  return ordered;
}

/** Legacy alias kept for callers ported from `lib/tag/heuristic.ts`. */
export const heuristicTagsForRepo = inferTags;
