/**
 * Unit test for `scripts/point-sdkroot.mjs`.
 *
 * The script exists because "export SDKROOT by hand" was the documented fix
 * (ATR-057) for a linker that cannot read the SDK this machine's own tools name,
 * and a documented export only helps the person who read the doc at the moment
 * they read it. The command that actually fails is a bare `pnpm rebuild
 * <native module>`, which runs the *dependency's* node-gyp hook — a child this
 * repository never starts, so nothing here can pass it an environment. The file
 * gyp forcibly includes is the one lever that reaches it, and this writes that
 * file at install time.
 *
 * What is asserted here is mostly the restraint, because the script writes into
 * a home directory on somebody's machine:
 *
 *   - it writes nothing on a platform whose linker has no such problem, and
 *     nothing when a build already links as things stand — the common case, and
 *     the one that would otherwise cost a compile on every single install;
 *   - a file it did not write is reported and left alone, and the person reading
 *     the line is told the one edit that would fix it;
 *   - it exits 0 whether or not it arranged anything, because an install that
 *     worked is not a failure because a convenience could not be arranged.
 *
 * The spec drives `run()` with the machine, the resolver and the writer all
 * injected, so it never reads or writes a real home directory.
 */

import fs from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, test, vi } from "vitest";

import { pathToFileURL } from "node:url";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "point-sdkroot.mjs");

type ProbeResult = { ok: boolean; detail: string };
type SdkVerdict = {
  ok: boolean;
  sdkPath: string | null;
  reason: string;
  env: Record<string, string>;
};
type PointVerdict = {
  wrote: boolean;
  foreign: boolean;
  path: string;
  reason: string;
};

interface Module {
  run(options?: {
    platform?: string;
    home?: string;
    dryRun?: boolean;
    probe?: (options?: { sdkPath?: string | null }) => ProbeResult;
    resolve?: (options?: Record<string, unknown>) => SdkVerdict;
    point?: (options?: {
      sdkPath?: string;
      home?: string;
    }) => PointVerdict;
    read?: (file: string) => string | null;
    log?: (message: string) => void;
  }): number;
}

let script: Module;

beforeAll(async () => {
  script = (await import(pathToFileURL(SCRIPT).href)) as unknown as Module;
});

const HOME = "/tmp/atr-point-sdkroot-home";
const INCLUDE = path.join(HOME, ".gyp", "include.gypi");
const MARKER = "# Written by AllTheRepos";
const SDK = "/SDKs/MacOSX26.5.sdk";

/** The include this repository writes, as the script would find it later. */
function ourInclude(sdkPath = SDK): string {
  return [
    "# -*- mode: python; coding: utf-8 -*-",
    `${MARKER} — written by scripts/point-sdkroot.mjs`,
    "{",
    "  'target_defaults': {",
    "    'xcode_settings': {",
    `      'SDKROOT': ${JSON.stringify(sdkPath)},`,
    "    },",
    "  },",
    "}",
    "",
  ].join("\n");
}

const links: ProbeResult = { ok: true, detail: "linked clean" };
const cannotLink: ProbeResult = { ok: false, detail: "tapi error: malformed file" };

/** A recorder of what the script asked of the machine. */
function harness({
  /*
   * The machine every case below describes is a macOS one, and it is injected
   * here for the same reason the home directory and the resolver are: `run()`
   * defaults `platform` to `process.platform`, so leaving it out made these
   * cases pass on the Mac they were written on and fail on a Linux CI runner,
   * where `run()` answered "nothing to point at on linux" and returned before
   * reaching any of the behaviour they assert (ATR-057).
   */
  platform = "darwin",
  existing = null as string | null,
  probe = (_options?: { sdkPath?: string | null }) => cannotLink,
  resolved = {
    ok: true,
    sdkPath: SDK,
    reason: "SDKROOT",
    env: { SDKROOT: SDK },
  } as SdkVerdict,
  verdict = {
    wrote: true,
    foreign: false,
    path: INCLUDE,
    reason: `wrote ${INCLUDE}, which points every node-gyp build on this machine at ${SDK}`,
  } as PointVerdict,
} = {}) {
  const lines: string[] = [];
  const asked: Array<string | null | undefined> = [];
  const point = vi.fn((_options?: { sdkPath?: string; home?: string }) => verdict);

  const code = script.run({
    platform,
    home: HOME,
    read: () => existing,
    probe: (options) => {
      asked.push(options?.sdkPath);
      return probe(options);
    },
    resolve: () => ({
      ok: resolved.ok,
      sdkPath: resolved.sdkPath,
      reason: resolved.reason,
      env: resolved.env,
    }),
    point,
    log: (message) => lines.push(message),
  });

  return { code, asked, point, output: lines.join("\n") };
}

describe("the hooks that run this on an install", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };

  test("pnpm's pre-install hook points here, so it beats the dependency build", () => {
    /*
     * The wiring is load-bearing and nothing in this file can observe it, so it
     * is asserted rather than assumed. `pnpm:devPreinstall` is run by pnpm at
     * the top of the install, before it builds anything; `preinstall` is not,
     * which is the difference between a machine that has never built these
     * natives installing cleanly and one that dies in a node-gyp link on an SDK
     * its own tools cannot read (ATR-057).
     */
    expect(manifest.scripts["pnpm:devPreinstall"]).toBe(
      "node scripts/point-sdkroot.mjs",
    );
    // Kept as well: it is the hook every other installer knows, it runs after
    // the dependencies, and covering both ends costs one link probe.
    expect(manifest.scripts.preinstall).toBe("node scripts/point-sdkroot.mjs");
  });

  test("the script it names is the one this spec drives", () => {
    // A hook pointing at a path that does not exist is an install that fails at
    // the first step on somebody else's machine.
    const hook = manifest.scripts["pnpm:devPreinstall"];
    const named = hook.slice(hook.indexOf("scripts/")).trim();
    expect(fs.existsSync(path.join(ROOT, named))).toBe(true);
    expect(fs.realpathSync(path.join(ROOT, named))).toBe(fs.realpathSync(SCRIPT));
  });
});

describe("pointing a plain native rebuild at an SDK that links", () => {
  test("it does nothing on a platform whose linker has no such problem", () => {
    const probe = vi.fn(() => links);
    const point = vi.fn();
    const resolve = vi.fn();
    const lines: string[] = [];

    // A linux toolchain links against its own headers; there is no SDKROOT to
    // arrange, and asking a compiler there would be answering a question
    // nobody asked.
    const code = script.run({
      platform: "linux",
      home: HOME,
      probe,
      resolve,
      point,
      read: () => null,
      log: (message) => lines.push(message),
    });

    expect(code).toBe(0);
    expect(probe).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(point).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("nothing to point at on linux");
  });

  test("a build that already links is left alone", () => {
    const { code, asked, point, output } = harness({ probe: () => links });

    expect(code).toBe(0);
    // Asked once, with the environment as it stands — and never again, and
    // never with a candidate path the resolver would have to look for.
    expect(asked).toEqual([undefined]);
    expect(point).not.toHaveBeenCalled();
    expect(output).toContain("links as this machine stands");
  });

  test("no SDK to point at is a line about ATR-057, not a failure", () => {
    const { code, point, output } = harness({
      resolved: { ok: false, sdkPath: null, reason: "nothing", env: {} },
    });

    expect(code).toBe(0);
    expect(point).not.toHaveBeenCalled();
    expect(output).toContain("tapi error: malformed file");
    expect(output).toContain("ATR-057");
  });

  test("a resolvable SDK is written where the dependency's hook will find it", () => {
    const { code, point, output } = harness();

    expect(code).toBe(0);
    expect(point).toHaveBeenCalledTimes(1);
    expect(point.mock.calls[0][0]).toMatchObject({ sdkPath: SDK, home: HOME });
    expect(output).toContain("wrote");
    // The sentence a person needs: the by-hand export is no longer part of it.
    expect(output).toContain("without `SDKROOT` exported by hand");
  });

  test("SDKROOT from the resolver wins over the path it was found by", () => {
    const symlinked = "/Applications/Xcode.app/Contents/Developer/.../MacOSX.sdk";
    const { point, asked } = harness({
      resolved: {
        ok: true,
        sdkPath: symlinked,
        reason: "xcode-select",
        env: { SDKROOT: SDK },
      },
    });

    expect(asked).toEqual([undefined]);
    expect(point.mock.calls[0][0]).toMatchObject({ sdkPath: SDK });
  });

  test("a dry run says what it would do and writes nothing", () => {
    const dry: string[] = [];
    const dryPoint = vi.fn();

    expect(
      script.run({
        platform: "darwin",
        home: HOME,
        dryRun: true,
        read: () => null,
        probe: () => cannotLink,
        resolve: () => ({ ok: true, sdkPath: SDK, reason: "SDKROOT", env: {} }),
        point: dryPoint,
        log: (message) => dry.push(message),
      }),
    ).toBe(0);

    expect(dryPoint).not.toHaveBeenCalled();
    expect(dry.join("\n")).toContain("would point");
    expect(dry.join("\n")).toContain(SDK);

    // And the same call without the flag is the one that writes, which is what
    // makes `--dry-run` worth having on a machine somebody is unsure about.
    const { code, point, output } = harness();
    expect(code).toBe(0);
    expect(point).toHaveBeenCalledTimes(1);
    expect(output).toContain("wrote");
  });

  test("our own file, still valid, is trusted instead of re-proving itself", () => {
    const { code, asked, point, output } = harness({
      existing: ourInclude(),
      probe: () => links,
    });

    expect(code).toBe(0);
    // One question: does the SDK already pinned in the file still link. No
    // resolver, and no compile to learn what the file already says.
    expect(asked).toEqual([SDK]);
    expect(point).not.toHaveBeenCalled();
    expect(output).toContain(`still points a node-gyp build at ${SDK}`);
  });

  test("our own file whose SDK went away is rebuilt from the environment", () => {
    const { code, asked, point, output } = harness({
      existing: ourInclude("/SDKs/gone.sdk"),
    });

    expect(code).toBe(0);
    // The pinned path is asked about first, then the environment, and only
    // then is an SDK looked for.
    expect(asked).toEqual(["/SDKs/gone.sdk", undefined]);
    expect(point).toHaveBeenCalledTimes(1);
    expect(output).toContain("wrote");
  });

  test("that stale file is replaced even when the machine's own tools work", () => {
    const { code, asked, point, output } = harness({
      existing: ourInclude("/SDKs/gone.sdk"),
      probe: (options) =>
        options?.sdkPath === "/SDKs/gone.sdk"
          ? { ok: false, detail: "no such file or directory: /SDKs/gone.sdk" }
          : links,
    });

    expect(code).toBe(0);
    expect(asked).toEqual(["/SDKs/gone.sdk", undefined]);
    // Left alone, that line would be applied by gyp to a build the machine can
    // link perfectly well, and fail it over a directory that is not there.
    expect(point).toHaveBeenCalledTimes(1);
    expect(point.mock.calls[0][0]).toMatchObject({ sdkPath: SDK });
    expect(output).not.toContain("links as this machine stands");
    expect(output).toContain("wrote");
  });

  test("with nothing to replace it with, it names the file to delete", () => {
    const { code, asked, point, output } = harness({
      existing: ourInclude("/SDKs/gone.sdk"),
      probe: (options) =>
        options?.sdkPath === "/SDKs/gone.sdk"
          ? { ok: false, detail: "no such file or directory: /SDKs/gone.sdk" }
          : links,
      resolved: { ok: false, sdkPath: null, reason: "nothing", env: {} } as SdkVerdict,
    });

    expect(code).toBe(0);
    expect(asked).toEqual(["/SDKs/gone.sdk", undefined]);
    expect(point).not.toHaveBeenCalled();
    // Saying nothing, or saying the machine is fine, would both be wrong: the
    // file is what is in the way, and it is ours to remove.
    expect(output).toContain("no longer links");
    expect(output).toContain("delete that file");
    expect(output).toContain("ATR-057");
  });

  test("somebody else's file is reported, with the edit that would fix it", () => {
    const { code, point, output } = harness({
      existing: "{ 'target_defaults': { 'xcode_settings': { 'SDKROOT': '/X.sdk' } } }\n",
      verdict: {
        wrote: false,
        foreign: true,
        path: INCLUDE,
        reason: `${INCLUDE} exists and was not written by this repository, so it was left alone`,
      },
    });

    expect(code).toBe(0);
    expect(point).toHaveBeenCalledTimes(1);
    expect(output).toContain("left alone");
    // The half that makes the report actionable rather than merely honest.
    expect(output).toContain(`'SDKROOT': '${SDK}'`);
  });

  test("a file written by this repository is recognised by its marker line", () => {
    const { asked } = harness({ existing: ourInclude(), probe: () => links });

    // Not a guess about the shape of the file: the marker is the difference
    // between ours and theirs, so a marker-less file must take the foreign
    // path even when it happens to mention SDKROOT.
    const stranger = harness({
      existing: `# a comment\n{ 'SDKROOT': '${SDK}' }\n`,
      probe: () => links,
    });
    expect(stranger.asked).toEqual([undefined]);
    expect(asked).toEqual([SDK]);
  });
});
