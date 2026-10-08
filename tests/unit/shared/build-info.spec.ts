/**
 * Unit — the packaged flag main states and the preload reads.
 *
 * This module exists because three layers have to agree on one fact and only one
 * of them can know it: main asks `app.isPackaged` (or, for a test run, an
 * override), the preload reads it back off `process.argv` in a sandboxed context
 * with no `app` and no `ipcRenderer` call it can afford at first paint, and the
 * renderer branches on it to decide whether a dev-only action is offered at all.
 *
 * So the wire format is tested where it can be: the encoder is the only place the
 * argument is written, the parser is the only place it is read, and the round trip
 * between them is asserted. The parser returning `null` rather than `false` when
 * the flag is absent is deliberate and tested too — the layers above decide what
 * an unknown answer means, and a parser that quietly answered "not packaged" would
 * hide a wiring mistake behind the answer that looks safe.
 *
 * The end of that chain — main's window options, the preload's constant, the
 * registry's rule — is proved on the running app in
 * `tests/e2e/workstream-c.spec.ts`, which launches the built app twice: once as it
 * is (unpackaged) and once with `ATR_FORCE_PACKAGED=1`, and reads what the app
 * offers in each.
 */

import { describe, expect, test } from "vitest";

import {
  PACKAGED_ARGV_PREFIX,
  encodePackagedFlag,
  parsePackagedFlag,
} from "@shared/build-info";

describe("the packaged flag main states per window", () => {
  test("encodes both answers, and only through the one prefix", () => {
    expect(encodePackagedFlag(true)).toBe(`${PACKAGED_ARGV_PREFIX}1`);
    expect(encodePackagedFlag(false)).toBe(`${PACKAGED_ARGV_PREFIX}0`);
    expect(PACKAGED_ARGV_PREFIX.startsWith("--")).toBe(true);
  });

  test("round-trips both answers", () => {
    for (const packaged of [true, false]) {
      expect(parsePackagedFlag([encodePackagedFlag(packaged)])).toBe(packaged);
    }
  });

  test("finds the flag in a real window's argv", () => {
    // What a packaged launch actually looks like: Electron's own arguments, the
    // app entry, then ours. The parse must not depend on position.
    const argv = [
      "/Applications/AllTheRepos.app/Contents/MacOS/AllTheRepos",
      "--no-sandbox",
      "--user-data-dir=/tmp/atr-e2e-profile-x",
      encodePackagedFlag(true),
    ];
    expect(parsePackagedFlag(argv)).toBe(true);
  });

  test("answers null — not false — when no window stated it", () => {
    // A harness or a window nobody wired. The caller decides; the parser does not
    // invent the safe-looking answer.
    expect(parsePackagedFlag([])).toBeNull();
    expect(
      parsePackagedFlag([
        "/path/to/electron",
        "/repo/out/main/index.js",
        "--user-data-dir=/tmp/profile",
      ]),
    ).toBeNull();
  });

  test("answers null for an argument that only looks like the flag", () => {
    // `startsWith` is what keeps a *path* that contains the text from being read
    // as our flag, and an unreadable value from being read as an answer.
    expect(parsePackagedFlag(["--other=--atr-packaged=1"])).toBeNull();
    expect(parsePackagedFlag([PACKAGED_ARGV_PREFIX])).toBeNull();
    expect(parsePackagedFlag([`${PACKAGED_ARGV_PREFIX}yes`])).toBeNull();
    expect(parsePackagedFlag([`${PACKAGED_ARGV_PREFIX}2`])).toBeNull();
  });

  test("accepts the spelled-out forms, so a hand-written argument works", () => {
    expect(parsePackagedFlag([`${PACKAGED_ARGV_PREFIX}true`])).toBe(true);
    expect(parsePackagedFlag([`${PACKAGED_ARGV_PREFIX}false`])).toBe(false);
  });

  test("reads the first flag when one turns up twice", () => {
    // Not a case the app produces; pinned so a duplicate cannot silently win.
    expect(
      parsePackagedFlag([encodePackagedFlag(true), encodePackagedFlag(false)]),
    ).toBe(true);
  });
});
