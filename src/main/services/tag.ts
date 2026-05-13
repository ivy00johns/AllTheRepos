/**
 * Heuristic tag inference for repos.
 *
 * Direct port of `lib/tag/heuristic.ts`. Pure function — given a repo root
 * path + parsed languages + README content, returns a deduplicated `Tag[]`
 * capped at 12 entries.
 */

import fs from "node:fs";
import path from "node:path";

import type { LanguageBytes, Tag } from "@shared/types";

export interface HeuristicInput {
  fullPath: string;
  languages: LanguageBytes[];
  readmeContent: string | null;
}

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
  tauri: "tauri",
  "@tauri-apps/api": "tauri",
};

function addTag(set: Map<string, Tag>, value: string): void {
  if (!set.has(value)) {
    set.set(value, { value, source: "heuristic" });
  }
}

function detectPackageJson(root: string, out: Map<string, Tag>): void {
  const raw = readFileSafe(path.join(root, "package.json"));
  if (!raw) return;
  let pkg: {
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
  addTag(out, "node");
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  };
  for (const key of Object.keys(deps ?? {})) {
    const tag = JS_FRAMEWORKS[key];
    if (tag) addTag(out, tag);
  }
  if (pkg.engines?.bun) addTag(out, "bun");
}

function detectCargo(root: string, out: Map<string, Tag>): void {
  const raw = readFileSafe(path.join(root, "Cargo.toml"));
  if (!raw) return;
  addTag(out, "rust");
  if (/\baxum\s*=/.test(raw)) addTag(out, "axum");
  if (/\btauri\s*=/.test(raw)) addTag(out, "tauri");
  if (/\bbevy\s*=/.test(raw)) addTag(out, "bevy");
  if (/\btokio\s*=/.test(raw)) addTag(out, "tokio");
  if (/\bactix-web\s*=/.test(raw)) addTag(out, "actix");
  if (/\brocket\s*=/.test(raw)) addTag(out, "rocket");
}

function detectGoMod(root: string, out: Map<string, Tag>): void {
  const raw = readFileSafe(path.join(root, "go.mod"));
  if (!raw) return;
  addTag(out, "go");
  if (/github\.com\/gin-gonic\/gin/.test(raw)) addTag(out, "gin");
  if (/github\.com\/labstack\/echo/.test(raw)) addTag(out, "echo");
  if (/github\.com\/gofiber\/fiber/.test(raw)) addTag(out, "fiber");
}

function detectPython(root: string, out: Map<string, Tag>): void {
  const py = readFileSafe(path.join(root, "pyproject.toml"));
  const req = readFileSafe(path.join(root, "requirements.txt"));
  if (!py && !req) return;
  addTag(out, "python");
  const blob = `${py ?? ""}\n${req ?? ""}`;
  if (/\bdjango\b/i.test(blob)) addTag(out, "django");
  if (/\bflask\b/i.test(blob)) addTag(out, "flask");
  if (/\bfastapi\b/i.test(blob)) addTag(out, "fastapi");
  if (/\btorch\b|\bpytorch\b/i.test(blob)) addTag(out, "pytorch");
  if (/\btensorflow\b/i.test(blob)) addTag(out, "tensorflow");
  if (/\bnumpy\b/i.test(blob)) addTag(out, "numpy");
}

function detectRuby(root: string, out: Map<string, Tag>): void {
  const raw = readFileSafe(path.join(root, "Gemfile"));
  if (!raw) return;
  addTag(out, "ruby");
  if (/\brails\b/.test(raw)) addTag(out, "rails");
  if (/\bsinatra\b/.test(raw)) addTag(out, "sinatra");
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
  if (existsDir(path.join(root, ".github", "workflows"))) {
    addTag(out, "ci");
  }
  if (existsFile(path.join(root, ".gitlab-ci.yml"))) addTag(out, "ci");
  if (existsFile(path.join(root, "circle.yml"))) addTag(out, "ci");
  if (existsFile(path.join(root, ".circleci", "config.yml"))) addTag(out, "ci");
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
  if (existsFile(path.join(root, "build.gradle"))) addTag(out, "gradle");
  if (existsFile(path.join(root, "build.gradle.kts"))) addTag(out, "gradle");
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

/**
 * Run all heuristic detectors on a repo root and return a deduplicated Tag[].
 * Capped at 12 tags.
 */
export function inferTags(input: HeuristicInput): Tag[] {
  const out = new Map<string, Tag>();
  const root = input.fullPath;

  detectPackageJson(root, out);
  detectCargo(root, out);
  detectGoMod(root, out);
  detectPython(root, out);
  detectRuby(root, out);
  detectDocker(root, out);
  detectCI(root, out);
  detectMonorepo(root, out);
  detectOtherEcosystems(root, out);

  // Primary language as a tag (lowercase) — helps search match "typescript" etc.
  const primary = input.languages[0]?.name?.toLowerCase();
  if (primary) addTag(out, primary);

  return [...out.values()].slice(0, 12);
}

/** Legacy alias kept for callers ported from `lib/tag/heuristic.ts`. */
export const heuristicTagsForRepo = inferTags;
