/**
 * Unit test for `scripts/electron-pack.mjs`.
 *
 * The script exists because `pnpm electron:pack` failed once on a runner, inside
 * electron-builder, renaming an `Electron` binary that its own unpack had not
 * produced — moments after the download feeding that unpack had retried a part.
 * The same commit passed when the command was run again, so what is worth
 * pinning here is the retry's behaviour rather than a packaging detail:
 *
 *   - a clean pass runs electron-builder once, with the arguments it was given
 *     and nothing added, and says nothing;
 *   - a failed pass is followed by exactly one more, which is given an empty
 *     Electron download cache — the difference between a re-run that can work
 *     and one that reuses the file the first attempt may have half-written;
 *   - two failures stop there and exit with the second status, so a real
 *     packaging break is still a break;
 *   - the arguments handed in are not mutated by the retry, because the same
 *     array is what a second attempt is built from.
 *
 * The script is imported by URL, as the other script specs here import theirs,
 * and driven through its exported entry points with the process launcher
 * injected — nothing is packaged and no Electron is downloaded.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "electron-pack.mjs");

type Run = (args: string[]) => number;

interface PackModule {
  ATTEMPTS: number;
  CACHE_OVERRIDE: string;
  withFreshCache: (args: string[], cacheDir: string) => string[];
  packWithRetry: (options: {
    args: string[];
    attempts?: number;
    run: Run;
    makeCacheDir: () => string;
    log?: (line: string) => void;
  }) => { status: number; attempt: number };
}

let pack: PackModule;

beforeAll(async () => {
  pack = (await import(pathToFileURL(SCRIPT).href)) as PackModule;
});

/** A launcher that records its arguments and answers with the given statuses. */
function launcher(statuses: number[]) {
  const calls: string[][] = [];
  const run: Run = (args) => {
    calls.push(args);
    return statuses[calls.length - 1] ?? 1;
  };
  return { calls, run };
}

describe("packaging, and the one retry it gets", () => {
  test("runs electron-builder once when it works, and adds nothing", () => {
    const { calls, run } = launcher([0]);
    const lines: string[] = [];

    const result = pack.packWithRetry({
      args: ["--mac", "--dir"],
      run,
      makeCacheDir: () => {
        throw new Error("a clean pass has no reason to make a cache directory");
      },
      log: (line) => lines.push(line),
    });

    expect(result).toEqual({ status: 0, attempt: 1 });
    expect(calls).toEqual([["--mac", "--dir"]]);
    // Silence is part of it: a pass that reports attempts would read as a
    // warning in a log nobody asked for one in.
    expect(lines).toEqual([]);
  });

  test("tries once more with an empty download cache after a failure", () => {
    const { calls, run } = launcher([1, 0]);
    const lines: string[] = [];

    const result = pack.packWithRetry({
      args: ["--mac", "--dir"],
      run,
      makeCacheDir: () => "/tmp/atr-electron-cache-1",
      log: (line) => lines.push(line),
    });

    expect(result).toEqual({ status: 0, attempt: 2 });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual([
      "--mac",
      "--dir",
      `${pack.CACHE_OVERRIDE}=/tmp/atr-electron-cache-1`,
    ]);
    expect(lines.join("\n")).toMatch(/attempt 2 of 2/);
    expect(lines.join("\n")).toMatch(/attempt 2 succeeded/);
  });

  test("stops after two attempts, and exits with the last failure", () => {
    const { calls, run } = launcher([1, 2]);
    const lines: string[] = [];

    const result = pack.packWithRetry({
      args: ["--mac", "--dir"],
      run,
      makeCacheDir: () => "/tmp/atr-electron-cache-1",
      log: (line) => lines.push(line),
    });

    expect(result).toEqual({ status: 2, attempt: 2 });
    expect(calls).toHaveLength(pack.ATTEMPTS);
    // The retry still got its own cache: a second attempt that reuses the first
    // attempt's download is the one that would repeat the failure.
    expect(calls[1]).toContain(
      `${pack.CACHE_OVERRIDE}=/tmp/atr-electron-cache-1`,
    );
    expect(lines.join("\n")).not.toMatch(/succeeded/);
  });

  test("builds each retry from the arguments it was given, without changing them", () => {
    const args = ["--mac", "--dir"];

    const first = pack.withFreshCache(args, "/tmp/atr-electron-cache-1");
    const second = pack.withFreshCache(args, "/tmp/atr-electron-cache-2");

    expect(args).toEqual(["--mac", "--dir"]);
    expect(first).not.toEqual(second);
    expect(first.slice(0, args.length)).toEqual(args);
    expect(first[first.length - 1]).toBe(
      `${pack.CACHE_OVERRIDE}=/tmp/atr-electron-cache-1`,
    );
  });
});

describe("the wiring the retry depends on", () => {
  test("both packaging scripts run through it", () => {
    // Without this, the retry is a script nobody calls: `electron:pack` and
    // `electron:pack-older` are what the refusal job and its drill build, and a
    // script edited back to calling electron-builder directly would lose the
    // retry silently — both would still work, right up until the next race.
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(pkg.scripts["electron:pack"]).toContain(
      "node scripts/electron-pack.mjs",
    );
    expect(pkg.scripts["electron:pack-older"]).toContain(
      "node scripts/electron-pack.mjs",
    );
  });

  test("forwards the arguments it is given to electron-builder", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    // The older bundle keeps its own output directory and version, and those
    // are the packaging command's business, not this wrapper's.
    expect(pkg.scripts["electron:pack"]).toMatch(
      /electron-pack\.mjs --mac --dir/,
    );
    expect(pkg.scripts["electron:pack-older"]).toMatch(
      /electron-pack\.mjs --mac --dir -c\.directories\.output=release\/older -c\.extraMetadata\.version=0\.0\.1/,
    );
  });
});
