/**
 * Unit test for `scripts/check-read-only.mjs`.
 *
 * The script exists because a promise about what a program will not do has no
 * test under it unless somebody writes one. A file-management feature shipped
 * with preflights, a dirty-tree refusal and a journal — real safeguards, all of
 * them guarding an operation nobody wanted — and nothing in CI said a word,
 * because no gate read what the main process does to a disk.
 *
 * Most of what is asserted here is the *boundary*, not the ban, because the ban
 * is the easy half:
 *
 *   - a verb is only judged when its receiver is a name bound to `node:fs`. This
 *     repository has a local `truncate(text)` in `services/embedding.ts` that
 *     clips a string for an embeddings API, and a gate that reads it as
 *     `fs.truncate` fails on correct code — which is how a gate gets deleted;
 *   - a write inside a waived file is only allowed when the verb is the one the
 *     waiver names, so `db/migration.ts` cannot quietly grow a `rename`;
 *   - a comment is not read, because the reasoning about all of this belongs in
 *     the source.
 *
 * The last test runs the gate over this repository's own main process. It is the
 * only case here that can be red for a reason outside this file, and it asserts
 * that the walk *read* a real number of files: a gate that passes by reading
 * nothing passes for the wrong reason, which is the failure mode the sibling
 * script specs were each rewritten to avoid.
 *
 * The script is imported by URL (a `.mjs` CLI with no declarations) and driven
 * through its exported functions with the root injected, the way the other
 * script specs here run theirs — no child process.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "check-read-only.mjs");

interface Finding {
  file: string;
  line: number;
  call: string;
  rule: string;
  why: string;
}

interface Observed {
  findings: Finding[];
  filesRead: number;
  callsSeen: number;
}

interface Waiver {
  calls: string[];
  why: string;
}

interface ReadOnlyModule {
  READ_ONLY_DIRS: string[];
  DESTRUCTIVE_CALLS: Set<string>;
  WRITE_CALLS: Set<string>;
  WRITE_WAIVERS: Record<string, Waiver>;
  callsIn(text: string, fileName?: string): Array<{ verb: string; onFs: boolean }>;
  judgeFile(file: string, text: string, waivers?: Record<string, Waiver>): Finding[];
  auditReadOnly(
    root?: string,
    dirs?: string[],
    waivers?: Record<string, Waiver>,
  ): Observed;
  assess(observed: Observed): { ok: boolean; code: number; lines: string[] };
  run(options?: { root?: string; log?: (line: string) => void }): number;
}

let script: ReadOnlyModule;

beforeAll(async () => {
  script = (await import(pathToFileURL(SCRIPT).href)) as unknown as ReadOnlyModule;
});

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) cleanupTmp(roots.pop());
});

/** A throwaway repository holding just the main-process file a case needs. */
function fixture(files: Record<string, string>): string {
  const dir = makeTmpDir("atr-read-only");
  roots.push(dir);

  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(dir, "src", "main", name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }

  return dir;
}

/** The verbs the gate judged, in order — what a finding is really about. */
function judged(observed: Observed): string[] {
  return observed.findings.map((finding) => finding.call);
}

describe("what the read-only gate catches", () => {
  test("a delete, with no exemption and no waiver", () => {
    const verdict = script.judgeFile(
      "src/main/services/catalog.ts",
      `import fs from "node:fs/promises";
       export async function tidy(dir: string) {
         await fs.rm(dir, { recursive: true, force: true });
       }`,
    );

    expect(judged({ findings: verdict, filesRead: 1, callsSeen: 0 })).toEqual([
      "fs.rm",
    ]);
    expect(verdict[0]?.rule).toBe("destructive");
  });

  test("the same delete reached through a destructured import", () => {
    const verdict = script.judgeFile(
      "src/main/services/catalog.ts",
      `import { rmdir, rmSync } from "node:fs";
       export function tidy(dir: string) {
         rmSync(dir);
         rmdir(dir);
       }`,
    );

    expect(judged({ findings: verdict, filesRead: 1, callsSeen: 0 })).toEqual([
      "rmSync",
      "rmdir",
    ]);
  });

  test("a delete handed to a shell", () => {
    const verdict = script.judgeFile(
      "src/main/services/catalog.ts",
      `import { execFile } from "node:child_process";
       export function tidy(dir: string) {
         execFile("rm", ["-rf", dir]);
       }`,
    );

    expect(verdict.map((finding) => finding.rule)).toEqual(["shell"]);
  });

  test("a move, which is only ever a write somewhere it was not waived", () => {
    const verdict = script.judgeFile(
      "src/main/services/move.ts",
      `import fs from "node:fs/promises";
       export async function relocate(from: string, to: string) {
         await fs.mkdir(to, { recursive: true });
         await fs.rename(from, to);
       }`,
    );

    expect(judged({ findings: verdict, filesRead: 1, callsSeen: 0 })).toEqual([
      "fs.mkdir",
      "fs.rename",
    ]);
    expect(verdict.every((finding) => finding.rule === "write")).toBe(true);
  });

  test("a copy, because copying is how a file is quietly replaced", () => {
    const verdict = script.judgeFile(
      "src/main/services/catalog.ts",
      `import { cpSync } from "node:fs";
       export function duplicate(from: string, to: string) {
         cpSync(from, to, { recursive: true });
       }`,
    );

    expect(judged({ findings: verdict, filesRead: 1, callsSeen: 0 })).toEqual([
      "cpSync",
    ]);
  });
});

describe("what it deliberately does not catch", () => {
  test("a local function that happens to share a verb with node:fs", () => {
    // `services/embedding.ts` really does this: `truncate(text)` clips a string.
    const verdict = script.judgeFile(
      "src/main/services/embedding.ts",
      `const truncate = (text: string) => text.slice(0, 4000);
       export const embed = (text: string) => truncate(text);`,
    );

    expect(verdict).toEqual([]);
  });

  test("a method on something that is not the filesystem", () => {
    const verdict = script.judgeFile(
      "src/main/services/catalog.ts",
      `declare const db: { truncate(): void; remove(id: string): void };
       export const tidy = () => {
         db.truncate();
         db.remove("x");
       };`,
    );

    expect(verdict).toEqual([]);
  });

  test("a read, however it is spelled", () => {
    const verdict = script.judgeFile(
      "src/main/services/catalog.ts",
      `import fs from "node:fs/promises";
       export async function look(dir: string) {
         const names = await fs.readdir(dir);
         const stat = await fs.stat(dir);
         const text = await fs.readFile(names[0] ?? dir, "utf8");
         return { stat, text };
       }`,
    );

    expect(verdict).toEqual([]);
  });

  test("a comment describing a delete", () => {
    const verdict = script.judgeFile(
      "src/main/services/catalog.ts",
      `// This used to call fs.rm(dir, { recursive: true }).
       export const nothing = 1;`,
    );

    expect(verdict).toEqual([]);
  });
});

describe("the write waivers", () => {
  const waivers: Record<string, Waiver> = {
    "src/main/services/settings.ts": {
      calls: ["writeFileSync"],
      why: "test fixture",
    },
  };

  test("allow exactly the verb they name", () => {
    expect(
      script.judgeFile(
        "src/main/services/settings.ts",
        `import { writeFileSync } from "node:fs";
         export const save = (p: string, body: string) => writeFileSync(p, body);`,
        waivers,
      ),
    ).toEqual([]);
  });

  test("do not allow a second verb in the same file", () => {
    const findings = script.judgeFile(
      "src/main/services/settings.ts",
      `import { renameSync, writeFileSync } from "node:fs";
       export const save = (p: string, body: string) => {
         writeFileSync(p, body);
         renameSync(p, p + ".bak");
       };`,
      waivers,
    );

    expect(findings.map((finding) => finding.call)).toEqual(["renameSync"]);
    expect(findings[0]?.rule).toBe("unwaived");
  });

  test("name every file that may write, so a new one is a decision", () => {
    // Four files, all of them inside the app's own data directory. A fifth is a
    // change somebody has to make on purpose.
    expect(Object.keys(script.WRITE_WAIVERS).sort()).toEqual([
      "src/main/db/client.ts",
      "src/main/db/migration.ts",
      "src/main/services/settings.ts",
      "src/main/window/window-memory.ts",
    ]);
    for (const [file, waiver] of Object.entries(script.WRITE_WAIVERS)) {
      expect(file.startsWith("src/main/")).toBe(true);
      expect(waiver.why.length).toBeGreaterThan(20);
    }
  });
});

describe("the verdict", () => {
  test("names the file and the line, because a failure has to be findable", () => {
    const root = fixture({
      "services/move.ts": `import fs from "node:fs/promises";
export async function relocate(from: string, to: string) {
  await fs.rename(from, to);
}`,
    });

    const verdict = script.assess(script.auditReadOnly(root));
    expect(verdict.code).toBe(1);
    expect(verdict.lines.join("\n")).toContain("services/move.ts:3");
  });

  test("reports reading nothing as a failure, not a pass", () => {
    // The failure mode the sibling gate was rewritten for: a check that passes
    // because it read an empty directory proved nothing at all.
    const root = makeTmpDir("atr-read-only-empty");
    roots.push(root);

    const verdict = script.assess(script.auditReadOnly(root));
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe(2);
    expect(verdict.lines.join("\n")).toContain("proved nothing");
  });
});

describe("this repository", () => {
  test("has a main process that only reads", () => {
    const observed = script.auditReadOnly(ROOT);

    expect(observed.findings.map((finding) => `${finding.file}:${finding.line}`)).toEqual([]);
    // Not a formality: `src/main` is the whole Node half of the app.
    expect(observed.filesRead).toBeGreaterThan(50);
    expect(observed.callsSeen).toBeGreaterThan(1000);
  });

  test("fails on the code this repository used to carry", () => {
    // The gate's reason for existing, kept as a test: the file-management
    // services named here are gone, and if a rename or a destination mkdir ever
    // comes back to a file with no waiver, this is the check that says so.
    const verdict = script.judgeFile(
      "src/main/services/folder.ts",
      `import fs from "node:fs/promises";
       export async function rename(from: string, to: string) {
         await fs.mkdir(to, { recursive: true });
         await fs.rename(from, to);
       }`,
    );

    expect(verdict.length).toBe(2);
  });
});
