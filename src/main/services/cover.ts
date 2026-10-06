/**
 * Cover resolution — find a project's own artwork on disk.
 *
 * A generated cover always exists (see `renderer/lib/cover.ts`), but a
 * project's real hero image or logo is a far stronger memory hook, so we
 * look for one first.
 *
 * Two sources, in order:
 *   1. The first non-badge image referenced by the README. That's the
 *      image the project's author chose to lead with.
 *   2. A conventional artwork path on disk (`docs/screenshot.png`,
 *      `assets/logo.png`, …).
 *
 * Only LOCAL files are considered. Remote images would need network
 * access from the main process and would then be blocked by the
 * renderer CSP anyway, so a remote-only README yields no cover and falls
 * back to generated art.
 *
 * Security: every candidate path is resolved and then checked to be
 * inside the repo directory. A README containing `![](../../../.ssh/id_rsa)`
 * must not be able to read outside the repo, and a symlink pointing out
 * of the tree is rejected by the same realpath check.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { catalogService } from "@main/services/catalog";

/** Data URLs above this size bloat the IPC payload for no visual gain. */
const MAX_IMAGE_BYTES = 1_500_000;

/** Extensions the renderer can display inline. */
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

/**
 * Hosts and path fragments that mean "this is a status badge, not
 * artwork". Badges are the most common image in a README by an order of
 * magnitude, and a shields.io rectangle is the least useful possible
 * cover.
 */
const BADGE_PATTERNS = [
  "shields.io",
  "badge.fury.io",
  "codecov.io",
  "travis-ci",
  "circleci.com",
  "appveyor",
  "coveralls.io",
  "badgen.net",
  "/badge",
  "badge.svg",
  "buymeacoffee",
  "ko-fi.com",
  "opencollective",
  "/workflows/",
  "actions/workflow",
];

function isBadge(reference: string): boolean {
  const lower = reference.toLowerCase();
  return BADGE_PATTERNS.some((pattern) => lower.includes(pattern));
}

function isRemote(reference: string): boolean {
  return /^(https?:)?\/\//i.test(reference) || reference.startsWith("data:");
}

/**
 * Conventional artwork locations, most-specific first. A file named
 * `screenshot` beats one named `logo`: a screenshot shows what the
 * project *is*, a logo only shows what it's called.
 */
const FILE_CANDIDATES = [
  "docs/screenshot.png",
  "docs/screenshot.jpg",
  "docs/preview.png",
  "docs/hero.png",
  "docs/assets/header.png",
  "assets/screenshot.png",
  "assets/preview.png",
  "assets/banner.png",
  "assets/logo.png",
  ".github/banner.png",
  ".github/hero.png",
  "screenshot.png",
  "screenshot.jpg",
  "preview.png",
  "banner.png",
  "logo.png",
  "logo.svg",
  "icon.png",
  "public/og-image.png",
  "public/logo.png",
  "static/logo.png",
];

export interface CoverResult {
  /** Data URL, or `null` when the repo ships no usable artwork. */
  src: string | null;
  /** Where it came from — surfaced in the detail panel. */
  source: "readme" | "file" | null;
  /** Repo-relative path of the chosen image, for display. */
  relativePath: string | null;
}

const EMPTY: CoverResult = { src: null, source: null, relativePath: null };

/**
 * Pull image references out of a README in document order, skipping
 * badges and remote URLs. Handles both markdown and the raw HTML that
 * hero sections are usually written in.
 */
function readmeImageRefs(readme: string): string[] {
  const refs: string[] = [];
  const push = (ref: string | undefined) => {
    if (!ref) return;
    const trimmed = ref.trim().replace(/^<|>$/g, "").split(/\s+/)[0];
    if (!trimmed || isRemote(trimmed) || isBadge(trimmed)) return;
    refs.push(trimmed);
  };

  // Markdown: ![alt](path "title")
  for (const match of readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    push(match[1]);
  }
  // HTML: <img src="path">
  for (const match of readme.matchAll(
    /<img[^>]+src\s*=\s*["']([^"']+)["']/gi,
  )) {
    push(match[1]);
  }
  return refs;
}

/**
 * Resolve a repo-relative reference to an absolute path, refusing
 * anything that escapes the repo directory.
 *
 * `realpath` is applied to both sides so a symlink inside the repo that
 * points at `/etc` is rejected rather than followed.
 */
async function safeResolve(
  repoRoot: string,
  reference: string,
): Promise<string | null> {
  // Strip any query/fragment a README may carry on an image path.
  const cleaned = decodeURIComponent(reference.split(/[?#]/)[0]);
  if (!cleaned || path.isAbsolute(cleaned)) return null;

  const candidate = path.resolve(repoRoot, cleaned);
  let realRoot: string;
  let realCandidate: string;
  try {
    realRoot = await fs.realpath(repoRoot);
    realCandidate = await fs.realpath(candidate);
  } catch {
    return null;
  }
  const withSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (!realCandidate.startsWith(withSep)) return null;
  return realCandidate;
}

async function readAsDataUrl(absolutePath: string): Promise<string | null> {
  const ext = path.extname(absolutePath).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) return null;
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_IMAGE_BYTES) {
      return null;
    }
    const buffer = await fs.readFile(absolutePath);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * In-memory cache keyed by slug.
 *
 * Covers are read once per app session. They're only invalidated by a
 * rescan or a move, both of which call `invalidateCover`, so a catalog
 * scroll never re-reads the same PNG.
 */
const cache = new Map<string, CoverResult>();

export function invalidateCover(slug?: string): void {
  if (slug) cache.delete(slug);
  else cache.clear();
}

class CoverService {
  async resolve(slug: string): Promise<CoverResult> {
    const cached = cache.get(slug);
    if (cached) return cached;

    const detail = await catalogService.get(slug);
    if (!detail) return EMPTY;

    const result = await this.resolveForRepo(
      detail.fullPath,
      detail.readmeContent,
    );
    cache.set(slug, result);
    return result;
  }

  /** Split out from `resolve` so it can be unit-tested without the DB. */
  async resolveForRepo(
    fullPath: string,
    readme: string | null,
  ): Promise<CoverResult> {
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isDirectory()) return EMPTY;
    } catch {
      // Repo is missing from disk — nothing to read.
      return EMPTY;
    }

    if (readme) {
      for (const reference of readmeImageRefs(readme)) {
        const absolute = await safeResolve(fullPath, reference);
        if (!absolute) continue;
        const src = await readAsDataUrl(absolute);
        if (src) {
          return {
            src,
            source: "readme",
            relativePath: path.relative(fullPath, absolute),
          };
        }
      }
    }

    for (const candidate of FILE_CANDIDATES) {
      const absolute = await safeResolve(fullPath, candidate);
      if (!absolute) continue;
      const src = await readAsDataUrl(absolute);
      if (src) {
        return { src, source: "file", relativePath: candidate };
      }
    }

    return EMPTY;
  }
}

export const coverService = new CoverService();
