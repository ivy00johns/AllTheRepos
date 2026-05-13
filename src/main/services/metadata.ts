/**
 * Per-repo metadata reader.
 *
 * Port of `lib/git/metadata.ts`. Pure Node-process code — no DB, no Electron
 * APIs — so it works in both the main process (rescan path) and the scanner
 * worker thread.
 *
 * macOS path quirk: `fs.realpathSync` is required because `/tmp` symlinks to
 * `/private/tmp`. The MVP's tag-write path failed when canonical paths were
 * compared as strings without realpath resolution (memory observations 604,
 * 606). The `canonicalPath` helper is the only safe way to compare repo
 * paths against DB rows.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import simpleGit, { type SimpleGit } from "simple-git";
import gitUrlParse from "git-url-parse";

import type { LanguageBytes } from "@shared/types";
import { languageForPath } from "./languages";

export interface RepoMetadata {
  name: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
  currentBranch: string | null;
  lastCommitHash: string | null;
  lastCommitDate: string | null;
  lastCommitMsg: string | null;
  isDirty: boolean;
  sizeBytes: number | null;
  primaryLanguage: string | null;
  languages: LanguageBytes[];
  readmeContent: string | null;
  readmeHash: string | null;
  description: string | null;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "target",
  "build",
  "dist",
  ".next",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".turbo",
  "out",
  ".cache",
]);

const README_CANDIDATES = [
  "README.md",
  "README.mdx",
  "README.MD",
  "readme.md",
  "Readme.md",
  "README",
  "README.rst",
  "README.txt",
];

const README_MAX_BYTES = 200 * 1024; // 200KB

/**
 * Resolve symlinks + relative segments to the canonical absolute path. ALWAYS
 * use this when comparing paths to DB rows or to each other (memory 604/606
 * documents the `/tmp` → `/private/tmp` macOS bug this prevents).
 */
export function canonicalPath(p: string): string {
  try {
    return fs.realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

function readReadme(root: string): { content: string | null; hash: string | null } {
  for (const name of README_CANDIDATES) {
    const fp = path.join(root, name);
    try {
      const stat = fs.statSync(fp);
      if (!stat.isFile()) continue;
      const size = Math.min(stat.size, README_MAX_BYTES);
      const buf = Buffer.alloc(size);
      const fd = fs.openSync(fp, "r");
      try {
        fs.readSync(fd, buf, 0, size, 0);
      } finally {
        fs.closeSync(fd);
      }
      const content = buf.toString("utf8");
      const hash = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex");
      return { content, hash };
    } catch {
      // try next
    }
  }
  return { content: null, hash: null };
}

function firstMarkdownParagraph(content: string | null): string | null {
  if (!content) return null;
  const lines = content.split(/\r?\n/);
  const buf: string[] = [];
  let seenBody = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!seenBody) {
      if (trimmed.startsWith("#") || trimmed.length === 0) {
        if (trimmed.length > 0) seenBody = false;
        continue;
      }
      seenBody = true;
      buf.push(trimmed);
    } else {
      if (trimmed.length === 0) break;
      buf.push(trimmed);
    }
  }
  const para = buf.join(" ").trim();
  if (!para) return null;
  return para.length > 240 ? para.slice(0, 240) + "..." : para;
}

interface LangCounter {
  bytes: number;
  color: string;
}

function walkForLanguages(
  root: string,
  maxDepth = 2,
): Map<string, LangCounter> {
  const counts = new Map<string, LangCounter>();
  const queue: Array<{ dir: string; depth: number }> = [
    { dir: root, depth: 0 },
  ];
  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".") && ent.name !== ".github") {
        if (ent.isDirectory()) continue;
      }
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        if (depth < maxDepth) queue.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!ent.isFile()) continue;
      const lang = languageForPath(ent.name);
      if (!lang) continue;
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        continue;
      }
      const existing = counts.get(lang.name);
      if (existing) {
        existing.bytes += size;
      } else {
        counts.set(lang.name, { bytes: size, color: lang.color });
      }
    }
  }
  return counts;
}

function repoSize(root: string, maxDepth = 2): number {
  let total = 0;
  const queue: Array<{ dir: string; depth: number }> = [
    { dir: root, depth: 0 },
  ];
  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        if (depth < maxDepth) queue.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!ent.isFile()) continue;
      try {
        total += fs.statSync(full).size;
      } catch {
        // ignore
      }
    }
  }
  return total;
}

function argmaxLanguage(counts: Map<string, LangCounter>): {
  primary: string | null;
  languages: LanguageBytes[];
} {
  const languages: LanguageBytes[] = [...counts.entries()]
    .map(([name, v]) => ({ name, bytes: v.bytes, color: v.color }))
    .sort((a, b) => b.bytes - a.bytes);
  const primary = languages[0]?.name ?? null;
  return { primary, languages };
}

export async function readRepoMetadata(
  gitDir: string,
): Promise<{ fullPath: string; metadata: RepoMetadata }> {
  // gitDir looks like /foo/bar/.git — the repo root is its parent
  const root = canonicalPath(
    gitDir.endsWith(path.sep + ".git") || gitDir.endsWith("/.git")
      ? path.dirname(gitDir)
      : gitDir,
  );

  const git: SimpleGit = simpleGit({ baseDir: root });

  let remoteUrl: string | null = null;
  try {
    const remotes = await git.getRemotes(true);
    const origin =
      remotes.find((r) => r.name === "origin") ?? remotes[0] ?? null;
    if (origin?.refs?.fetch) {
      remoteUrl = origin.refs.fetch;
    }
  } catch {
    /* ignore */
  }

  let currentBranch: string | null = null;
  let defaultBranch: string | null = null;
  try {
    const status = await git.status();
    currentBranch = status.current ?? null;
  } catch {
    /* ignore */
  }
  try {
    const branches = await git.branch();
    if (branches.all.includes("main")) defaultBranch = "main";
    else if (branches.all.includes("master")) defaultBranch = "master";
    else defaultBranch = currentBranch;
  } catch {
    /* ignore */
  }

  let lastCommitHash: string | null = null;
  let lastCommitDate: string | null = null;
  let lastCommitMsg: string | null = null;
  try {
    const log = await git.log({ maxCount: 1 });
    const latest = log.latest;
    if (latest) {
      lastCommitHash = latest.hash;
      lastCommitDate = new Date(latest.date).toISOString();
      lastCommitMsg = latest.message;
    }
  } catch {
    /* ignore */
  }

  let isDirty = false;
  try {
    const status = await git.status();
    isDirty =
      status.files.length > 0 ||
      status.not_added.length > 0 ||
      status.modified.length > 0 ||
      status.renamed.length > 0 ||
      status.deleted.length > 0 ||
      status.created.length > 0;
  } catch {
    /* ignore */
  }

  const readme = readReadme(root);
  const counts = walkForLanguages(root);
  const { primary, languages } = argmaxLanguage(counts);
  const sizeBytes = repoSize(root);

  const name = path.basename(root);

  let description: string | null = null;
  try {
    const pkgRaw = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { description?: string };
    if (pkg.description) description = pkg.description;
  } catch {
    /* ignore */
  }
  if (!description) {
    description = firstMarkdownParagraph(readme.content);
  }

  // Normalize remote URL via git-url-parse for safety (handles ssh/https).
  if (remoteUrl) {
    try {
      const parsed = gitUrlParse(remoteUrl);
      if (parsed.toString("https")) {
        remoteUrl = parsed.toString("https");
      }
    } catch {
      /* keep original */
    }
  }

  return {
    fullPath: root,
    metadata: {
      name,
      remoteUrl,
      defaultBranch,
      currentBranch,
      lastCommitHash,
      lastCommitDate,
      lastCommitMsg,
      isDirty,
      sizeBytes,
      primaryLanguage: primary,
      languages,
      readmeContent: readme.content,
      readmeHash: readme.hash,
      description,
    },
  };
}

export function slugFromNameAndPath(name: string, fullPath: string): string {
  const kebab = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const hash = crypto
    .createHash("sha1")
    .update(fullPath)
    .digest("hex")
    .slice(0, 6);
  const base = kebab.length > 0 ? kebab : "repo";
  return `${base}-${hash}`;
}
