/**
 * Unit test for the demo rows behind the README screenshots
 * (`scripts/make-readme-shots.mjs`).
 *
 * This exists because the rows were wrong once, in a way nothing reported.
 * `TagSchema` requires a `source` and `LanguageBytesSchema` requires a `color`;
 * the demo data omitted both, so the *output* validation every IPC handler
 * applies rejected each list read, and the app rendered an empty catalog with
 * no error on screen and nothing in the console. The only symptom was a
 * screenshot timing out minutes into an Electron launch.
 *
 * So the rows are checked against the real schemas here, where a mismatch is a
 * failing assertion instead of a silent blank window. It is fast: no Electron,
 * no database, just the data and the contract.
 *
 * The script is imported by URL rather than by path: it is a `.mjs` CLI with no
 * type declarations, and loading it dynamically keeps TypeScript out of a
 * resolution problem it cannot solve — the same trick the `verify-release` and
 * `release-notes` specs use.
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
  "make-readme-shots.mjs",
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
}

interface ShotsModule {
  demoRows(root: string): DemoRow[];
}

/** Stands in for the script's default `~/Code`, without touching `$HOME`. */
const ROOT = "/Users/example/Code";

let rows: DemoRow[];

beforeAll(async () => {
  const shots = (await import(
    pathToFileURL(SCRIPT).href
  )) as unknown as ShotsModule;
  rows = shots.demoRows(ROOT);
});

describe("the demo library behind the screenshots", () => {
  test("every row's languages satisfy the schema the IPC layer validates", () => {
    // The exact check that was missing: `color` is required, and a row that
    // omits it makes the whole list read fail — not just that row.
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

  test("the languages are non-empty and the bytes look like a composition", () => {
    for (const row of rows) {
      expect(row.languages.length, `${row.name} has no languages`).toBeGreaterThan(
        0,
      );
      const typed = row.languages as Array<{ bytes: number }>;
      expect(typed.reduce((sum, l) => sum + l.bytes, 0)).toBeGreaterThan(0);
      expect(row.primaryLanguage.length).toBeGreaterThan(0);
    }
  });

  test("names and slugs are unique, so no card shadows another", () => {
    const names = rows.map((row) => row.name);
    const slugs = rows.map((row) => row.slug);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("every row is anchored under the scan root that is configured", () => {
    for (const row of rows) {
      expect(row.fullPath.startsWith(`${ROOT}/`), row.fullPath).toBe(true);
      // The catalog shows the path below the scan root, so a row outside it
      // would render as an absolute temp path in a published screenshot.
      expect(row.slug.length).toBeGreaterThan(0);
    }
  });

  test("dates parse, because the activity ramp sorts and labels them", () => {
    for (const row of rows) {
      expect(Number.isNaN(Date.parse(row.lastCommitDate)), row.name).toBe(false);
    }
  });

  test("the library spans every recency bucket the ramp draws", () => {
    // Not cosmetic: a library that is all "3 hours ago" would show one edge of
    // the activity ramp and misrepresent it as the whole scale.
    const ages = rows.map(
      (row) => Date.now() - Date.parse(row.lastCommitDate),
    );
    const days = ages.map((age) => age / 86_400_000);
    expect(days.some((d) => d < 1)).toBe(true);
    expect(days.some((d) => d >= 7)).toBe(true);
    expect(days.some((d) => d >= 180)).toBe(true);
  });

  test("the library mixes ownership and dirty states", () => {
    expect(rows.some((row) => row.remoteUrl === null)).toBe(true);
    expect(
      rows.some((row) => row.remoteUrl?.includes("github.com:ivy00johns/")),
    ).toBe(true);
    expect(rows.some((row) => !row.remoteUrl?.includes("ivy00johns"))).toBe(true);
    expect(rows.some((row) => row.isDirty === 1)).toBe(true);
  });
});
