/**
 * Unit test for `scripts/make-test-badge.mjs`.
 *
 * The script exists because a hand-maintained count went stale twice, so what it
 * has to get right is narrow and worth pinning: the count it reads is the count
 * in the report, the number is readable (commas), the badge is wide enough not
 * to clip it, it goes red when the suite does, and a missing report fails loudly
 * instead of publishing "0 passing".
 *
 * No test run here: the report is a fixture, so this is fast and does not depend
 * on the suite it describes.
 *
 * The script is imported by URL (a `.mjs` CLI with no declarations).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const SCRIPTS = path.resolve(__dirname, "..", "..", "..", "scripts");

interface Facts {
  tests: number;
  failed: number;
  success: boolean;
}

interface WriteResult extends Facts {
  ok: boolean;
  current: boolean;
  badgePath: string;
  message: string;
}

interface MakeTestBadgeModule {
  REPORT_PATH: string;
  BADGE_PATH: string;
  badgeFacts(report: Record<string, unknown> | null): Facts;
  renderBadge(input: { tests: number; failed: number }): string;
  escapeXml(text: string): string;
  writeBadge(options?: {
    reportPath?: string;
    badgePath?: string;
    check?: boolean;
  }): WriteResult;
}

let badge: MakeTestBadgeModule;

beforeAll(async () => {
  badge = (await import(
    pathToFileURL(path.join(SCRIPTS, "make-test-badge.mjs")).href
  )) as MakeTestBadgeModule;
});

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) cleanupTmp(dirs.pop());
});

/** A throwaway checkout holding a report, returning its paths. */
function fixture(report: unknown | "missing") {
  const dir = makeTmpDir("atr-badge");
  dirs.push(dir);
  const reportPath = path.join(dir, ".vitest-results.json");
  if (report !== "missing") {
    fs.writeFileSync(reportPath, JSON.stringify(report));
  }
  return { dir, reportPath, badgePath: path.join(dir, "docs/images/tests.svg") };
}

/** Vitest's `--reporter=json` output, which is Jest-compatible. */
const REPORT = {
  numTotalTestSuites: 54,
  numTotalTests: 1189,
  numPassedTests: 1189,
  numFailedTests: 0,
  success: true,
};

describe("badgeFacts", () => {
  test("reads the counts a real Vitest report carries", () => {
    expect(badge.badgeFacts(REPORT)).toEqual({
      tests: 1189,
      failed: 0,
      success: true,
    });
  });

  test("a failure makes the badge a failure, however many passed", () => {
    expect(
      badge.badgeFacts({
        numTotalTests: 1189,
        numFailedTests: 3,
        success: false,
      }),
    ).toEqual({ tests: 1189, failed: 3, success: false });
  });

  test("refuses a report with no test counts rather than publishing 0 passing", () => {
    // A coverage summary, an empty report or the wrong reporter all land here,
    // and a badge that says the suite is empty is worse than no badge.
    expect(() => badge.badgeFacts({} as Record<string, unknown>)).toThrow(
      /numTotalTests/,
    );
    expect(() => badge.badgeFacts(null)).toThrow(/numTotalTests/);
  });
});

describe("renderBadge", () => {
  test("is a flat 20px badge labelled tests, with the count and the word passing", () => {
    const svg = badge.renderBadge({ tests: 1189, failed: 0 });

    expect(svg).toContain('height="20"');
    expect(svg).toContain(">tests</text>");
    expect(svg).toContain("1,189 passing");
    expect(svg).toContain('fill="#4c1"');
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  test("turns red and reports the failures when the suite failed", () => {
    const svg = badge.renderBadge({ tests: 1189, failed: 3 });

    expect(svg).toContain("3 failing");
    expect(svg).toContain('fill="#e05d44"');
    expect(svg).not.toContain("#4c1");
  });

  test("groups the digits, and does not when there is nothing to group", () => {
    expect(badge.renderBadge({ tests: 1189, failed: 0 })).toContain("1,189 passing");
    expect(badge.renderBadge({ tests: 356, failed: 0 })).toContain("356 passing");
    expect(badge.renderBadge({ tests: 1234567, failed: 0 })).toContain(
      "1,234,567 passing",
    );
  });

  test("widens with the count, so a six-digit suite is not clipped", () => {
    const width = (svg: string) => Number(/width="(\d+)"/.exec(svg)![1]);
    const small = width(badge.renderBadge({ tests: 356, failed: 0 }));
    const large = width(badge.renderBadge({ tests: 1234567, failed: 0 }));
    const failing = width(badge.renderBadge({ tests: 1189, failed: 3 }));

    expect(large).toBeGreaterThan(small);
    // A thousand-count badge is wider than its own text needs, which is what
    // "not clipped" means in a file with no font metrics behind it.
    expect(large).toBeGreaterThan("1,234,567 passing".length * 6);
    expect(failing).toBeGreaterThan("3 failing".length * 6);
  });

  test("escapes text that lands in the SVG's attributes", () => {
    expect(badge.escapeXml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
    expect(badge.renderBadge({ tests: 1, failed: 0 })).not.toContain("&amp;amp;");
  });
});

describe("writeBadge", () => {
  test("writes the badge where the README expects it, creating the directory", () => {
    const { reportPath, badgePath } = fixture(REPORT);

    const result = badge.writeBadge({ reportPath, badgePath });

    expect(result.ok).toBe(true);
    expect(result.message).toBe("1,189 passing");
    expect(fs.existsSync(badgePath)).toBe(true);
    expect(fs.readFileSync(badgePath, "utf8")).toBe(
      badge.renderBadge({ tests: 1189, failed: 0 }),
    );
  });

  test("reports the file as current when it already matches", () => {
    const { reportPath, badgePath } = fixture(REPORT);
    badge.writeBadge({ reportPath, badgePath });

    expect(badge.writeBadge({ reportPath, badgePath }).current).toBe(true);
  });

  test("fails loudly when the report was never written", () => {
    const { reportPath, badgePath } = fixture("missing");

    expect(() => badge.writeBadge({ reportPath, badgePath })).toThrow(
      /pnpm test:report/,
    );
    expect(fs.existsSync(badgePath)).toBe(false);
  });

  test("--check refuses a stale badge and leaves it alone", () => {
    const { reportPath, badgePath } = fixture(REPORT);
    fs.mkdirSync(path.dirname(badgePath), { recursive: true });
    fs.writeFileSync(badgePath, "<svg>the wrong badge</svg>");

    const stale = badge.writeBadge({ reportPath, badgePath, check: true });

    expect(stale.ok).toBe(false);
    expect(stale.message).toContain("pnpm badges");
    expect(fs.readFileSync(badgePath, "utf8")).toBe("<svg>the wrong badge</svg>");

    badge.writeBadge({ reportPath, badgePath });
    expect(badge.writeBadge({ reportPath, badgePath, check: true }).ok).toBe(true);
  });
});

describe("the CLI", () => {
  const cli = (args: string[]) =>
    spawnSync("node", [path.join(SCRIPTS, "make-test-badge.mjs"), ...args], {
      encoding: "utf8",
    });

  test("writes the badge and says what it wrote", () => {
    const { reportPath, badgePath } = fixture(REPORT);

    const result = cli(["--report", reportPath, "--out", badgePath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tests 1,189 passing");
    expect(fs.existsSync(badgePath)).toBe(true);
  });

  test("exits 1, with a reason, when there is no report", () => {
    const { reportPath, badgePath } = fixture("missing");

    const result = cli(["--report", reportPath, "--out", badgePath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pnpm test:report");
  });

  test("--check exits 1 when the committed badge is out of date", () => {
    const { reportPath, badgePath } = fixture(REPORT);

    const result = cli(["--report", reportPath, "--out", badgePath, "--check"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pnpm badges");
  });
});
