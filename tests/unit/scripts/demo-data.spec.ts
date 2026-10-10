/**
 * Unit test for the demo catalog behind `scripts/demo-data.mjs`.
 *
 * The demo profile is what a public video shows in place of a real library, so
 * two classes of mistake are worth failing fast on:
 *
 *   1. **Schema drift.** `TagSchema` requires a `source` and
 *      `LanguageBytesSchema` requires a `color`. A row that omits either makes
 *      the *whole* catalog list read fail validation, and the app renders an
 *      empty catalog with no error anywhere. That exact fault shipped once in
 *      `make-readme-shots.mjs` and was visible only as a screenshot timeout.
 *   2. **A graph with nothing to show.** The relationship view derives its
 *      edges from disk and the DB, so a dataset that drops the `refs` or
 *      `deps` fields renders a demo that no longer demonstrates anything.
 *
 * The script is imported by URL rather than by path: it is a `.mjs` CLI with
 * no type declarations, and loading it dynamically keeps TypeScript out of a
 * resolution problem it cannot solve.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import { LanguageBytesSchema, TagSchema } from "@shared/schemas";

const SCRIPT = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "scripts",
  "demo-data.mjs",
);

interface DemoRow {
  slug: string;
  name: string;
  fullPath: string;
  remoteUrl: string | null;
  defaultBranch: string;
  currentBranch: string;
  lastCommitHash: string;
  lastCommitDate: string;
  lastCommitMsg: string;
  isDirty: number;
  primaryLanguage: string;
  languages: unknown[];
  tags: unknown[];
  description: string;
  sizeBytes: number;
  readmeContent: string;
}

interface DemoLink {
  fromSlug: string | undefined;
  toSlug: string | undefined;
  kind: string;
  why: string;
}

interface DemoFile {
  path: string;
  content: string;
}

interface DemoModule {
  demoRepos(root: string): DemoRow[];
  demoLinks(root: string): DemoLink[];
  demoFiles(root: string): DemoFile[];
}

/** Stands in for the script's default demo folder, without touching $HOME. */
const ROOT = "/Users/example/.alltherepos-demo/Code";

let rows: DemoRow[];
let links: DemoLink[];
let files: DemoFile[];

beforeAll(async () => {
  const demo = (await import(
    pathToFileURL(SCRIPT).href
  )) as unknown as DemoModule;
  rows = demo.demoRepos(ROOT);
  links = demo.demoLinks(ROOT);
  files = demo.demoFiles(ROOT);
});

describe("the demo catalog", () => {
  test("every row's languages satisfy the schema the IPC layer validates", () => {
    for (const row of rows) {
      const parsed = row.languages.map((language) =>
        LanguageBytesSchema.safeParse(language),
      );
      const bad = parsed.filter((result) => !result.success);
      expect(
        bad.length,
        `${row.name} has ${bad.length} language(s) the schema rejects: ${JSON.stringify(
          bad.map((result) => result.error?.issues[0]?.message),
        )}`,
      ).toBe(0);
    }
  });

  test("every row's tags satisfy the schema the IPC layer validates", () => {
    for (const row of rows) {
      for (const tag of row.tags) {
        expect(
          TagSchema.safeParse(tag).success,
          `${row.name} has a tag the schema rejects: ${JSON.stringify(tag)}`,
        ).toBe(true);
      }
    }
  });

  test("names and slugs are unique, so no card shadows another", () => {
    const names = rows.map((row) => row.name);
    const slugs = rows.map((row) => row.slug);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("every row is anchored under the demo root", () => {
    for (const row of rows) {
      expect(row.fullPath.startsWith(`${ROOT}/`), row.fullPath).toBe(true);
    }
  });

  test("the library mixes ownership, dirty and local-only states", () => {
    expect(rows.some((row) => row.remoteUrl === null)).toBe(true);
    expect(rows.filter((row) => row.remoteUrl?.includes("github.com")).length).toBe(
      rows.length - 2,
    );
    expect(rows.some((row) => !row.remoteUrl?.includes("ivy00johns"))).toBe(true);
    expect(rows.some((row) => row.isDirty === 1)).toBe(true);
  });

  test("the library spans the whole recency ramp", () => {
    const days = rows.map(
      (row) => (Date.now() - Date.parse(row.lastCommitDate)) / 86_400_000,
    );
    expect(days.some((d) => d < 1)).toBe(true);
    expect(days.some((d) => d >= 7)).toBe(true);
    expect(days.some((d) => d >= 180)).toBe(true);
  });
});

describe("the demo graph data", () => {
  /** Repos grouped by the name token the graph clusters them on. */
  function families(): Map<string, string[]> {
    const known = new Set([
      "atlas",
      "sentinel",
      "mailroom",
      "forge",
      "ledger",
    ]);
    const out = new Map<string, string[]>();
    for (const row of rows) {
      for (const token of known) {
        if (row.name.includes(token)) {
          if (!out.has(token)) out.set(token, []);
          out.get(token)!.push(row.fullPath);
        }
      }
    }
    return out;
  }

  test("there are enough name families to form visible clusters", () => {
    const byFamily = families();
    expect(byFamily.size).toBeGreaterThanOrEqual(5);
    for (const [token, paths] of byFamily) {
      expect(paths.length, `${token} has only ${paths.length}`).toBeGreaterThanOrEqual(2);
    }
  });

  test("at least three families scatter across folders, which is the point of /graph", () => {
    const scattered = [...families().values()].filter((paths) => {
      const folders = new Set(paths.map((p) => path.dirname(p)));
      return folders.size > 1;
    });
    expect(scattered.length).toBeGreaterThanOrEqual(3);
  });

  test("readmes link to other repos' GitHub pages, so the reference signal fires", () => {
    const linked = rows.filter((row) =>
      /https:\/\/github\.com\/[^/\s]+\/[^)\s]+/.test(row.readmeContent ?? ""),
    );
    // Enough linked readmes that the signal raises edges, not just a stray one.
    expect(linked.length).toBeGreaterThanOrEqual(10);
  });

  test("repos that declare dependencies get a package.json on disk", () => {
    const pkgFiles = files.filter((file) => file.path.endsWith("package.json"));
    expect(pkgFiles.length).toBeGreaterThanOrEqual(5);
    for (const file of pkgFiles) {
      const parsed = JSON.parse(file.content) as {
        dependencies?: Record<string, string>;
      };
      expect(Object.keys(parsed.dependencies ?? {}).length).toBeGreaterThan(0);
    }
  });

  test("at least one repo vendors another, so the submodule signal fires", () => {
    const modules = files.filter((file) => file.path.endsWith(".gitmodules"));
    expect(modules.length).toBeGreaterThanOrEqual(1);
    expect(modules[0].content).toContain("github.com");
  });

  test("every curated link resolves to a repo in the demo library and never itself", () => {
    const slugs = new Set(rows.map((row) => row.slug));
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const link of links) {
      expect(link.fromSlug, `${link.why} has no from`).toBeDefined();
      expect(link.toSlug, `${link.why} has no to`).toBeDefined();
      expect(slugs.has(link.fromSlug!), link.fromSlug).toBe(true);
      expect(slugs.has(link.toSlug!), link.toSlug).toBe(true);
      expect(link.fromSlug).not.toBe(link.toSlug);
      // A curated link outranks every derived signal, so it must carry a reason.
      expect(link.why.length).toBeGreaterThan(0);
    }
  });
});
