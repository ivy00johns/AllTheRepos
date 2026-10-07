/**
 * Unit test for `scripts/signing-identity.mjs`.
 *
 * This script decides which certificate signs a release, and the two ways it
 * can be wrong are both silent:
 *
 *   1. **Picking the wrong certificate.** A keychain on a developer machine
 *      holds `Apple Development` certificates that Xcode makes on demand.
 *      They sign a build that launches locally and can never be notarised, so
 *      a release signed with one looks entirely successful and then refuses
 *      to install on anyone's machine. Only `Developer ID Application` may be
 *      chosen — and a `Developer ID **Installer**` certificate, which is
 *      issued alongside it and signs installers rather than applications, is
 *      not it either.
 *   2. **Inventing a certificate.** The ordinary state of a machine without a
 *      paid membership is `0 valid identities found`. That is not a parse
 *      failure and must not be reported as one: the caller needs a clean
 *      "there is nothing to sign with" so it can fall back to ad-hoc and warn.
 *
 * These tests drive the parser with real `security find-identity -v -p
 * codesigning` output and never run `security`, so they behave identically on
 * a machine with a certificate and on one without.
 *
 * The script is imported by URL (a `.mjs` CLI with no declarations).
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, test, vi } from "vitest";

const SCRIPTS = path.resolve(__dirname, "..", "..", "..", "scripts");

interface Identity {
  hash: string;
  name: string;
}

interface IdentityModule {
  DEVELOPER_ID_PREFIXES: readonly string[];
  AD_HOC: string;
  parseIdentities(text: string): Identity[];
  pickDeveloperId(identities: Identity[]): Identity | null;
  resolveIdentity(options?: {
    keychain?: string | null;
    run?: (() => string) | null;
  }): { identity: Identity | null; identities: Identity[]; output: string };
  parseArgs(args: string[]): { keychain: string | null; require: boolean };
}

let identityModule: IdentityModule;

beforeAll(async () => {
  identityModule = (await import(
    pathToFileURL(path.join(SCRIPTS, "signing-identity.mjs")).href
  )) as unknown as IdentityModule;
});

/** Real output from a keychain holding one Developer ID certificate. */
const ONE_DEVELOPER_ID = [
  '  1) 5A1B2C3D4E5F60718293A4B5C6D7E8F901234567 "Developer ID Application: John Smith (ABCDE12345)"',
  "     1 valid identities found",
].join("\n");

/**
 * A developer machine: an Xcode-made development certificate first, then the
 * Developer ID, then a legacy `Mac Developer`, then the Installer
 * certificate that is issued alongside the Developer ID.
 */
const MIXED = [
  '  1) AAAAAAAA11112222333344445555666677778888 "Apple Development: John Smith (XYZ1234567)"',
  '  2) 5A1B2C3D4E5F60718293A4B5C6D7E8F901234567 "Developer ID Application: John Smith (ABCDE12345)"',
  '  3) BBBBBBBB1111222233334444555566667777888F "Mac Developer: John Smith (OLD1234567)"',
  '  4) CCCCCCCC1111222233334444555566667777888F "Developer ID Installer: John Smith (ABCDE12345)"',
  "     4 valid identities found",
].join("\n");

/** No membership, no certificate — the ordinary case. */
const NONE = "     0 valid identities found";

describe("parseIdentities", () => {
  test("reads one identity and ignores the trailing count line", () => {
    const identities = identityModule.parseIdentities(ONE_DEVELOPER_ID);
    expect(identities).toEqual([
      {
        hash: "5A1B2C3D4E5F60718293A4B5C6D7E8F901234567",
        name: "Developer ID Application: John Smith (ABCDE12345)",
      },
    ]);
  });

  test("reads every identity on a machine that has several", () => {
    const identities = identityModule.parseIdentities(MIXED);
    expect(identities).toHaveLength(4);
    expect(identities.map((entry) => entry.name)).toEqual([
      "Apple Development: John Smith (XYZ1234567)",
      "Developer ID Application: John Smith (ABCDE12345)",
      "Mac Developer: John Smith (OLD1234567)",
      "Developer ID Installer: John Smith (ABCDE12345)",
    ]);
    expect(identities[1].hash).toBe(
      "5A1B2C3D4E5F60718293A4B5C6D7E8F901234567",
    );
  });

  test("a keychain with no identities parses to an empty list, not an error", () => {
    expect(identityModule.parseIdentities(NONE)).toEqual([]);
  });

  test("empty or absent output parses to an empty list", () => {
    expect(identityModule.parseIdentities("")).toEqual([]);
    expect(
      identityModule.parseIdentities(undefined as unknown as string),
    ).toEqual([]);
  });

  test("a malformed line is skipped rather than guessed at", () => {
    const junk = ["not an identity", "  1) missing-a-name", MIXED].join("\n");
    expect(identityModule.parseIdentities(junk)).toHaveLength(4);
  });
});

describe("pickDeveloperId", () => {
  test("chooses the Developer ID Application certificate from a mixed list", () => {
    const chosen = identityModule.pickDeveloperId(
      identityModule.parseIdentities(MIXED),
    );
    expect(chosen?.name).toBe(
      "Developer ID Application: John Smith (ABCDE12345)",
    );
  });

  test("never chooses a development certificate, even when it comes first", () => {
    // This is the failure that looks like success: Xcode makes these on
    // demand, they sign a build that runs locally, and Apple will not
    // notarise one.
    const developmentOnly = [
      '  1) AAAAAAAA11112222333344445555666677778888 "Apple Development: John Smith (XYZ1234567)"',
      '  2) BBBBBBBB1111222233334444555566667777888F "Mac Developer: John Smith (OLD1234567)"',
    ].join("\n");
    expect(
      identityModule.pickDeveloperId(
        identityModule.parseIdentities(developmentOnly),
      ),
    ).toBeNull();
  });

  test("never chooses a Developer ID Installer certificate", () => {
    const installerOnly = [
      '  1) CCCCCCCC1111222233334444555566667777888F "Developer ID Installer: John Smith (ABCDE12345)"',
    ].join("\n");
    expect(
      identityModule.pickDeveloperId(
        identityModule.parseIdentities(installerOnly),
      ),
    ).toBeNull();
  });

  test("returns null for an empty list", () => {
    expect(identityModule.pickDeveloperId([])).toBeNull();
  });

  test("the ad-hoc fallback is spelled the way electron-builder spells it", () => {
    expect(identityModule.AD_HOC).toBe("-");
  });
});

describe("resolveIdentity", () => {
  test("resolves through the injected runner and never runs security", () => {
    const run = vi.fn(() => ONE_DEVELOPER_ID);
    const resolved = identityModule.resolveIdentity({ run });

    expect(run).toHaveBeenCalledTimes(1);
    expect(resolved.identity?.name).toBe(
      "Developer ID Application: John Smith (ABCDE12345)",
    );
    expect(resolved.identities).toHaveLength(1);
    expect(resolved.output).toBe(ONE_DEVELOPER_ID);
  });

  test("reports no identity — rather than throwing — on a bare machine", () => {
    const resolved = identityModule.resolveIdentity({ run: () => NONE });
    expect(resolved.identity).toBeNull();
    expect(resolved.identities).toEqual([]);
  });

  test("passes the requested keychain through to the query", () => {
    // CI imports CSC_LINK into a temporary keychain and must be able to point
    // at it, or it would resolve against whatever the runner's default
    // keychain happens to hold.
    const run = vi.fn(() => ONE_DEVELOPER_ID);
    identityModule.resolveIdentity({ keychain: "/tmp/signing.keychain-db", run });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("parseArgs", () => {
  test("--keychain takes the next argument", () => {
    expect(identityModule.parseArgs(["--keychain", "/tmp/k.keychain-db"])).toEqual(
      { keychain: "/tmp/k.keychain-db", require: false },
    );
  });

  test("--require asks for a failure instead of a fallback", () => {
    expect(identityModule.parseArgs(["--require"])).toEqual({
      keychain: null,
      require: true,
    });
  });

  test("no flags means the default keychain and no demand", () => {
    expect(identityModule.parseArgs([])).toEqual({
      keychain: null,
      require: false,
    });
  });

  test("an unknown flag throws rather than being ignored", () => {
    expect(() => identityModule.parseArgs(["--keychan", "/tmp/k"])).toThrow(
      /unknown flag/,
    );
  });
});
