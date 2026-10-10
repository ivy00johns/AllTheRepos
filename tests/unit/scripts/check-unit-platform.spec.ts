/**
 * Unit test for `scripts/check-unit-platform.mjs`.
 *
 * The script exists because `tests/unit/scripts/point-sdkroot.spec.ts` passed on
 * the Mac it was written on and failed on the Linux runner, for a reason nothing
 * in the repository could see: it drove `run()` without a platform, and `run()`
 * defaults that to `process.platform`. The spec had made an assertion about the
 * machine. Running the suite again on a platform the host is not is the only
 * check that reads that class of mistake off the machine's own answer instead of
 * guessing at it from the source.
 *
 * What is asserted here is the judgement, because the judgement is where this
 * gate can be wrong in both directions:
 *
 *   - a spec that fails on the other platform and is nobody's business but its
 *     own is a spec that will fail on a runner, named with its file;
 *   - an exemption that stops being needed fails the gate, since a suppression
 *     that suppresses nothing is a line the next reader has to re-derive;
 *   - and a report with no tests in it is neither of those, so it is "nothing
 *     was checked" rather than a pass.
 *
 * The wiring is asserted too, and for the reason `point-sdkroot.spec.ts` asserts
 * its own: a gate that nothing runs is a file, not a gate. `pnpm test` does not
 * run this config on purpose — an exempt spec is supposed to fail under it — so
 * the only things holding it in place are the script, the workflow step and the
 * package script, none of which any test of the judgement would notice.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "check-unit-platform.mjs");
const CONFIG = path.join(ROOT, "vitest.other-platform.config.ts");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "ci.yml");

interface Exemption {
  file: string;
  why: string;
}

interface Partition {
  files: number;
  assertions: number;
  failed: string[];
  unexpected: string[];
  unnecessary: string[];
}

interface Survivors {
  stillFailing: string[];
  cleared: string[];
}

interface CheckUnitPlatformModule {
  OTHER_PLATFORM: Record<string, string>;
  REPORT: string;
  CONFIG: string;
  SPECS_THAT_NEED_THE_HOST: Exemption[];
  partition(
    report: unknown,
    exempt?: Exemption[],
  ): Partition;
  survivors(unexpected: string[], retryFailed: string[]): Survivors;
}

let gate: CheckUnitPlatformModule;

beforeAll(async () => {
  gate = (await import(
    pathToFileURL(SCRIPT).href
  )) as unknown as CheckUnitPlatformModule;
});

/** A vitest JSON report with one entry per `[name, status]` pair. */
function reportOf(
  suites: Array<[string, "passed" | "failed", (string | null)[]?]>,
): unknown {
  return {
    testResults: suites.map(([name, status, testStatuses]) => ({
      name: path.join(ROOT, name),
      status,
      assertionResults: (testStatuses ?? []).map((testStatus) => ({
        status: testStatus,
      })),
    })),
  };
}

describe("the platform a run is pointed at", () => {
  test("a Mac is pointed at Linux, which is what the unit job runs on", () => {
    expect(gate.OTHER_PLATFORM.darwin).toBe("linux");
  });

  test("the runner is pointed at darwin, which is what most specs assumed", () => {
    expect(gate.OTHER_PLATFORM.linux).toBe("darwin");
  });

  test("a platform that is neither is pointed at darwin", () => {
    expect(gate.OTHER_PLATFORM.win32).toBe("darwin");
  });

  test("no platform is ever pointed at itself", () => {
    // The whole check is that the platform differs from the host's. A mapping
    // that named the host would run the ordinary suite and report it as the
    // other-platform one — a green light for a run that checked nothing.
    for (const [host, target] of Object.entries(gate.OTHER_PLATFORM)) {
      expect(target).not.toBe(host);
    }
  });
});

describe("what the report says about the run", () => {
  test("a failing spec nobody exempted is named", () => {
    const partition = gate.partition(
      reportOf([["tests/unit/a.spec.ts", "failed", ["failed", "passed"]]]),
      [],
    );

    expect(partition.unexpected).toEqual(["tests/unit/a.spec.ts"]);
    expect(partition.unnecessary).toEqual([]);
  });

  test("a failing spec that is exempt is held back", () => {
    const exempt: Exemption[] = [{ file: "tests/unit/a.spec.ts", why: "native" }];
    const partition = gate.partition(
      reportOf([["tests/unit/a.spec.ts", "failed", ["failed"]]]),
      exempt,
    );

    expect(partition.unexpected).toEqual([]);
    expect(partition.unnecessary).toEqual([]);
    expect(partition.failed).toEqual(["tests/unit/a.spec.ts"]);
  });

  test("an exemption that suppressed nothing is an exemption to remove", () => {
    const exempt: Exemption[] = [{ file: "tests/unit/a.spec.ts", why: "native" }];
    const partition = gate.partition(
      reportOf([["tests/unit/a.spec.ts", "passed", ["passed"]]]),
      exempt,
    );

    expect(partition.unnecessary).toEqual(["tests/unit/a.spec.ts"]);
    expect(partition.unexpected).toEqual([]);
  });

  test("a file that failed to load counts even with no failing test in it", () => {
    // A collection error — an import that does not resolve under the other
    // platform — leaves a failed suite with nothing in `assertionResults`. Read
    // only from the tests, that file would be invisible here and would pass as
    // a spec that does not care which platform it is on.
    const partition = gate.partition(
      reportOf([["tests/unit/a.spec.ts", "failed", ["passed", "passed"]]]),
      [],
    );

    expect(partition.unexpected).toEqual(["tests/unit/a.spec.ts"]);
  });

  test("an empty report is nothing to check, not a pass", () => {
    const partition = gate.partition({ testResults: [] }, []);

    expect(partition.files).toBe(0);
    expect(partition.assertions).toBe(0);
    expect(partition.failed).toEqual([]);
    expect(partition.unexpected).toEqual([]);
  });

  test("the counts describe every spec file the report carried", () => {
    const partition = gate.partition(
      reportOf([
        ["tests/unit/a.spec.ts", "passed", ["passed", "passed"]],
        ["tests/unit/b.spec.ts", "failed", ["failed"]],
      ]),
      [],
    );

    expect(partition.files).toBe(2);
    expect(partition.assertions).toBe(3);
  });
});

describe("a failure that only happened once", () => {
  /*
   * The retry, which is the difference between a gate and a nuisance.
   *
   * Measured, not guessed at: `process.spec.ts`'s two listener-binding tests
   * failed on a machine whose load average was in the hundreds and passed on
   * the same machine minutes later, asserting nothing about the platform either
   * time. A gate that reported that as a platform dependence would be turned
   * off inside a week, so the second run is what decides — and what it clears
   * is printed rather than dropped.
   */

  test("a file that fails both times is the finding", () => {
    const { stillFailing, cleared } = gate.survivors(
      ["tests/unit/a.spec.ts"],
      ["tests/unit/a.spec.ts"],
    );

    expect(stillFailing).toEqual(["tests/unit/a.spec.ts"]);
    expect(cleared).toEqual([]);
  });

  test("a file that clears on the second run is a flake, and is named", () => {
    const { stillFailing, cleared } = gate.survivors(
      ["tests/unit/a.spec.ts"],
      [],
    );

    expect(stillFailing).toEqual([]);
    expect(cleared).toEqual(["tests/unit/a.spec.ts"]);
  });

  test("the two are told apart within one run, not one or the other", () => {
    const { stillFailing, cleared } = gate.survivors(
      ["tests/unit/a.spec.ts", "tests/unit/b.spec.ts"],
      ["tests/unit/b.spec.ts"],
    );

    expect(stillFailing).toEqual(["tests/unit/b.spec.ts"]);
    expect(cleared).toEqual(["tests/unit/a.spec.ts"]);
  });

  test("nothing failing needs no retry and clears nothing", () => {
    expect(gate.survivors([], [])).toEqual({ stillFailing: [], cleared: [] });
  });

  test("a file failing on the retry that had not failed before is not the finding", () => {
    // The retry is given the files that already failed, so this is a guard on
    // the seam rather than a case that should arise: only files this run
    // reported may be reported back, or a flake arriving during the retry would
    // become a verdict about a spec nobody asked about.
    const { stillFailing, cleared } = gate.survivors(
      ["tests/unit/a.spec.ts"],
      ["tests/unit/a.spec.ts", "tests/unit/b.spec.ts"],
    );

    expect(stillFailing).toEqual(["tests/unit/a.spec.ts"]);
    expect(cleared).toEqual([]);
  });
});

describe("the exemptions themselves", () => {
  test("every exemption names a spec file that is in the tree", () => {
    // An exemption for a path that does not exist suppresses nothing, and would
    // read as coverage while covering a file nobody has.
    for (const exemption of gate.SPECS_THAT_NEED_THE_HOST) {
      expect(
        fs.existsSync(path.join(ROOT, exemption.file)),
        `${exemption.file} does not exist`,
      ).toBe(true);
    }
  });

  test("every exemption is a unit spec, so it is a file this suite runs", () => {
    for (const exemption of gate.SPECS_THAT_NEED_THE_HOST) {
      expect(exemption.file.startsWith("tests/unit/")).toBe(true);
      expect(exemption.file.endsWith(".spec.ts")).toBe(true);
    }
  });

  test("every exemption carries the reason a reader has to have", () => {
    for (const exemption of gate.SPECS_THAT_NEED_THE_HOST) {
      expect(exemption.why.length).toBeGreaterThan(40);
    }
  });
});

describe("the wiring that makes this a gate rather than a file", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };

  test("a package script runs the gate", () => {
    expect(manifest.scripts["unit-platform:check"]).toBe(
      "node scripts/check-unit-platform.mjs",
    );
  });

  test("the script it names is the one this spec drives", () => {
    const hook = manifest.scripts["unit-platform:check"];
    const named = hook.slice(hook.indexOf("scripts/"));

    expect(fs.existsSync(path.join(ROOT, named))).toBe(true);
    expect(fs.realpathSync(path.join(ROOT, named))).toBe(fs.realpathSync(SCRIPT));
  });

  test("CI runs it, which is the only thing that makes it a gate", () => {
    const workflow = fs.readFileSync(WORKFLOW, "utf8");

    expect(workflow).toContain("pnpm unit-platform:check");
  });

  test("the config it runs exists and differs from the ordinary one", () => {
    // One setup file and nothing else: a faked run that quietly grew its own
    // include list would stop being the suite that gates a push.
    expect(fs.existsSync(CONFIG)).toBe(true);
    const config = fs.readFileSync(CONFIG, "utf8");

    // Segments rather than a joined path: the config is TypeScript and joins
    // them with `path.resolve`, so the assertion is that it names the setup
    // file, not that it names it the way this test would have.
    expect(config).toContain("\"tests\"");
    expect(config).toContain("\"setup\"");
    expect(config).toContain("\"other-platform.ts\"");
    expect(config).toContain("mergeConfig");
  });
});
