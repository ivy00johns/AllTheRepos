/**
 * Unit test for `src/shared/github-refusal.ts` — the one definition of "GitHub
 * declined to answer".
 *
 * Three places used to decide this for themselves: a copied `isRefusal` in the
 * packaged update check, another in `scripts/check-updater-feed.mjs`, and a
 * `raw.includes("401") || …` chain in the app. Each was right, and nothing kept
 * them right — the failure mode is that one of them is edited and the other two
 * go on quietly describing a different status as a different kind of problem.
 *
 * So most of what is asserted here is *not* about the predicates, which are two
 * lines each. It is about the copies being gone: the files that used to carry
 * their own version now read this one, and the strings they print come out of it
 * rather than being typed next to it. That is the property an edit can actually
 * break.
 *
 * The module is imported through a relative path from the file it lives in, for
 * the same reason the e2e spec imports it that way: these run in a plain Node
 * process (vitest) and a bundled one (electron-vite), and the path works in both.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const MODULE = path.join(ROOT, "src", "shared", "github-refusal.ts");
const DATA = path.join(ROOT, "src", "shared", "github-refusal.json");

const read = (relative: string) =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

interface Refusal {
  REFUSED_STATUSES: readonly number[];
  ANONYMOUS_READ_REFUSAL: string;
  REFUSED_REQUEST_MESSAGE: string;
  isRefusalStatus(status: number): boolean;
  isRefusalText(raw: string): boolean;
}

let refusal: Refusal;

beforeAll(async () => {
  refusal = (await import(pathToFileURL(MODULE).href)) as unknown as Refusal;
});

describe("the statuses that mean GitHub declined to answer", () => {
  test("are the three a person cannot act on", () => {
    // 403 and 429 are the allowance running out; 401 is GitHub asking who you
    // are, which an anonymous check can never answer either.
    for (const status of [401, 403, 429]) {
      expect(refusal.isRefusalStatus(status), String(status)).toBe(true);
    }
  });

  test("and not 404, which is the rot everything else is looking for", () => {
    // The claim that must stay false: an anonymous reader gets 404 for a release
    // that does not exist AND for a repo it may not see, and both of those are
    // exactly what the feed check exists to fail on.
    for (const status of [200, 404, 500, 0]) {
      expect(refusal.isRefusalStatus(status), String(status)).toBe(false);
    }
    expect(refusal.REFUSED_STATUSES).not.toContain(404);
  });

  test("the same answer when the status arrives inside an error's text", () => {
    // Which is the shape electron-updater hands the app: an `HttpError` whose
    // message carries the status inside a dump of headers.
    expect(refusal.isRefusalText("HttpError: 403 Forbidden")).toBe(true);
    expect(refusal.isRefusalText("Response status code does not indicate success: 429")).toBe(
      true,
    );
    expect(refusal.isRefusalText("401 Unauthorized")).toBe(true);
    expect(refusal.isRefusalText("HttpError: 404 Not Found")).toBe(false);
  });
});

describe("the words", () => {
  test("name the same thing in the app, the feed check and the update check", () => {
    // One grep over a run should find all of them, which is why both sentences
    // name the refusal in the same terms rather than each inventing its own.
    expect(refusal.ANONYMOUS_READ_REFUSAL).toMatch(/^GitHub refused the /);
    expect(refusal.REFUSED_REQUEST_MESSAGE).toMatch(/^GitHub refused the /);
    expect(refusal.REFUSED_REQUEST_MESSAGE).toContain(
      refusal.ANONYMOUS_READ_REFUSAL.replace("anonymous read", "request"),
    );
  });

  test("are the ones the app tells a person, unchanged", () => {
    expect(refusal.REFUSED_REQUEST_MESSAGE).toBe(
      "GitHub refused the request — an anonymous check is rate-limited. Try again later.",
    );
    expect(refusal.ANONYMOUS_READ_REFUSAL).toBe(
      "GitHub refused the anonymous read",
    );
  });
});

describe("where the definition lives", () => {
  test("the data is the JSON, and this module re-exports it rather than restating it", () => {
    // The reason the definition is data at all: two of the readers are plain Node
    // scripts with no build step, and Node cannot import a `.ts` file. A module
    // that carried its own copy would be the drift this change removed.
    const data = JSON.parse(fs.readFileSync(DATA, "utf8")) as {
      refusedStatuses: number[];
      anonymousRead: string;
      requestRefused: string;
    };

    expect(refusal.REFUSED_STATUSES).toEqual(data.refusedStatuses);
    expect(refusal.ANONYMOUS_READ_REFUSAL).toBe(data.anonymousRead);
    expect(refusal.REFUSED_REQUEST_MESSAGE).toBe(data.requestRefused);
  });

  test("the files that used to keep their own copy now read this one", () => {
    const readers: Array<[string, RegExp]> = [
      ["src/main/services/updater.ts", /@shared\/github-refusal/],
      ["tests/e2e/packaged-update-check.spec.ts", /src\/shared\/github-refusal/],
      ["scripts/check-updater-feed.mjs", /github-refusal\.json/],
      ["scripts/refused-update-check.mjs", /github-refusal\.json/],
    ];

    for (const [file, reads] of readers) {
      expect(read(file), file).toMatch(reads);
    }
  });

  test("and none of them still decides it for itself", () => {
    // The three copies, by the shape each one had. `graph.ts`-style false
    // positives are not a risk here: these are exact strings that only the
    // copies contained.
    expect(read("src/main/services/updater.ts")).not.toContain('raw.includes("403")');
    expect(read("scripts/check-updater-feed.mjs")).not.toContain(
      "status === 403 || status === 429",
    );
    expect(read("tests/e2e/packaged-update-check.spec.ts")).not.toMatch(
      /function isRefusal\b/,
    );
    // ... and the words are not typed into any of them either.
    for (const file of [
      "src/main/services/updater.ts",
      "scripts/check-updater-feed.mjs",
      "scripts/refused-update-check.mjs",
      "tests/e2e/packaged-update-check.spec.ts",
    ]) {
      expect(read(file), file).not.toContain("GitHub refused the anonymous read");
    }
  });

  test("and the file with the data in it explains itself nowhere else", () => {
    // The split is deliberate and has a cost: JSON cannot carry a comment, so
    // the reasoning lives in the module and the data file is three keys. A reader
    // who lands on the JSON has to be able to find the why.
    expect(fs.statSync(MODULE).isFile()).toBe(true);
    expect(read("src/shared/github-refusal.ts")).toContain(
      "Why JSON rather than this module alone",
    );
  });
});
