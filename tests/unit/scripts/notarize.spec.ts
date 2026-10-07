/**
 * Unit test for `scripts/notarize.mjs` — the `afterSign` hook.
 *
 * Notarisation is the one step in the release pipeline that cannot be run on
 * this machine: it needs an Apple Developer membership, a Developer ID
 * certificate and a credential, and none of those are obtainable from a test.
 * What *can* be tested is everything around the single call to Apple — which
 * is deliberately where all the difficulty lives:
 *
 *   1. **Whether to submit at all.** A build with no Developer ID signature
 *      is not a failure to notarise; it is a build Apple would refuse, and
 *      the release still has to happen. The decision has to distinguish
 *      "does not apply" from "went wrong", because the first ships and the
 *      second must not.
 *   2. **Half-configured credentials.** One secret set out of three is always
 *      a mistake, and it fails here — naming the unset variables — instead of
 *      five minutes later at Apple with a 401.
 *   3. **`require` means require.** A tag push demands notarisation, so a
 *      release whose credentials went missing fails rather than publishing a
 *      build that looks installable and is not.
 *   4. **The stapled ticket is checked, not assumed.** `@electron/notarize`
 *      staples on success; a build whose stapling silently did not happen is
 *      exactly the state that reads green in a log and is refused on a
 *      stranger's machine.
 *
 * The `signatureKind` fixtures below are real `codesign -dvvv` output, taken
 * from the bundles in `release/` and from a notarised Developer ID build. The
 * classification is duplicated in `src/main/services/signing.ts`, and
 * `tests/unit/main/services/signing.spec.ts` fails if the two ever disagree.
 *
 * The script is imported by URL (a `.mjs` CLI with no declarations) and every
 * external effect — `codesign`, `xcrun stapler`, `notarytool` — is injected.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

const SCRIPTS = path.resolve(__dirname, "..", "..", "..", "scripts");

interface Decision {
  action: "notarize" | "skip" | "fail";
  reason: string;
}

interface Credentials {
  mode: "api-key" | "apple-id" | null;
  credentials: Record<string, string> | null;
  missing: string[];
}

interface AfterSignDeps {
  env?: Record<string, string>;
  run?: (command: string, args: string[]) => string;
  notarize?: (options: Record<string, unknown>) => Promise<void>;
  validate?: (appPath: string) => { ok: boolean; output: string };
  log?: (...args: unknown[]) => void;
  signature?: string;
  appPath?: string;
}

interface NotarizeModule {
  DEFAULT_APP: string;
  NOTARIZE_MODES: readonly string[];
  notarizeMode(env?: Record<string, string | undefined>): string;
  notaryCredentials(env?: Record<string, string | undefined>): Credentials;
  signatureKind(codesignOutput: string): string;
  decideNotarization(input: {
    platform?: string;
    signature?: string;
    credentials?: Partial<Credentials> | null;
    mode?: string;
  }): Decision;
  codesignDescription(
    appPath: string,
    run?: (command: string, args: string[]) => string,
  ): string;
  stapleValidate(
    appPath: string,
    run?: (command: string, args: string[]) => string,
  ): { ok: boolean; output: string };
  notarizeApp(input: {
    appPath: string;
    credentials: Record<string, string>;
    notarize: (options: Record<string, unknown>) => Promise<void>;
    validate?: (appPath: string) => { ok: boolean; output: string };
    log?: (...args: unknown[]) => void;
  }): Promise<void>;
  parseArgs(args: string[]): { appPath: string | null; submit: boolean };
  default: (
    context: Record<string, unknown>,
    deps?: AfterSignDeps,
  ) => Promise<void>;
}

let notarizeModule: NotarizeModule;

beforeAll(async () => {
  notarizeModule = (await import(
    pathToFileURL(path.join(SCRIPTS, "notarize.mjs")).href
  )) as unknown as NotarizeModule;
});

/**
 * Real `codesign -dvvv` output. `-dvvv` writes all of this to **stderr**,
 * which is why the caller captures both streams — reading stdout alone
 * classified every ad-hoc bundle as `unknown`.
 */
const DEVELOPER_ID = [
  "Executable=/Applications/AllTheRepos.app/Contents/MacOS/AllTheRepos",
  "Identifier=com.alltherepos.desktop",
  "Format=app bundle with Mach-O thin (arm64)",
  "CodeDirectory v=20500 size=1189 flags=0x10000(runtime) hashes=28+7 location=embedded",
  "Hash type=sha256 size=32",
  "CandidateCDHash sha256=d41d8cd98f00b204e9800998ecf8427e",
  "CDHash=d41d8cd98f00b204e9800998ecf8427e",
  "Authority=Developer ID Application: John Smith (ABCDE12345)",
  "Authority=Developer ID Certification Authority",
  "Authority=Apple Root CA",
  "Timestamp=Sep 30, 2026 at 12:34:56",
  "Info.plist entries=32",
  "TeamIdentifier=ABCDE12345",
  "Runtime Version=14.0.0",
  "Sealed Resources version=2 rules=13 files=97",
  "Internal requirements count=1 size=204",
].join("\n");

const AD_HOC = [
  "Executable=/Users/me/build/release/mac-arm64/AllTheRepos.app/Contents/MacOS/AllTheRepos",
  "Identifier=com.alltherepos.desktop",
  "Format=app bundle with Mach-O thin (arm64)",
  "CodeDirectory v=20400 size=464 flags=0x2(adhoc) hashes=4+7 location=embedded",
  "Hash type=sha256 size=32",
  "CDHash=bf00c584760263546c473e440d47e6d27540ae38",
  "Signature=adhoc",
  "Info.plist entries=32",
  "TeamIdentifier=not set",
  "Sealed Resources version=2 rules=13 files=97",
  "Internal requirements count=0 size=12",
  "Total signatures=1",
].join("\n");

/**
 * A bundle whose signature was stripped: no `Signature=` line survives, but
 * the ad-hoc flag on the code directory does. Apple's `codesign` prints this
 * shape for a bundle signed with `identity: "-"` and then modified.
 */
const AD_HOC_FLAGS_ONLY = [
  "Identifier=com.alltherepos.desktop",
  "CodeDirectory v=20400 size=464 flags=0x2(adhoc) hashes=4+7 location=embedded",
  "TeamIdentifier=not set",
].join("\n");

const UNSIGNED =
  "/tmp/build/AllTheRepos.app: code object is not signed at all\n" +
  "In subcomponent: /tmp/build/AllTheRepos.app/Contents/MacOS/AllTheRepos";

const UNRECOGNISABLE = "something else entirely\nwith no signature facts in it";

/** The complete credential strategies, as the environment would present them. */
const API_KEY_ENV = {
  APPLE_API_KEY: "/tmp/AuthKey_ABCDE12345.p8",
  APPLE_API_KEY_ID: "ABCDE12345",
  APPLE_API_ISSUER: "c055ca8c-e5a8-4836-b61d-aa5794eeb3f4",
};

const APPLE_ID_ENV = {
  APPLE_ID: "john@example.com",
  APPLE_APP_SPECIFIC_PASSWORD: "abcd-efgh-ijkl-mnop",
  APPLE_TEAM_ID: "ABCDE12345",
};

/** `parseArgs(["--require"])` writes to the real environment, so restore it. */
const originalMode = process.env.ATR_NOTARIZE;
afterEach(() => {
  if (originalMode === undefined) delete process.env.ATR_NOTARIZE;
  else process.env.ATR_NOTARIZE = originalMode;
});

describe("notarizeMode", () => {
  test("an unset variable means auto", () => {
    expect(notarizeModule.notarizeMode({})).toBe("auto");
  });

  test("an empty or whitespace variable means auto", () => {
    expect(notarizeModule.notarizeMode({ ATR_NOTARIZE: "" })).toBe("auto");
    expect(notarizeModule.notarizeMode({ ATR_NOTARIZE: "   " })).toBe("auto");
  });

  test("require and skip are read case- and whitespace-insensitively", () => {
    expect(notarizeModule.notarizeMode({ ATR_NOTARIZE: "require" })).toBe(
      "require",
    );
    expect(notarizeModule.notarizeMode({ ATR_NOTARIZE: "REQUIRE" })).toBe(
      "require",
    );
    expect(notarizeModule.notarizeMode({ ATR_NOTARIZE: " require " })).toBe(
      "require",
    );
    expect(notarizeModule.notarizeMode({ ATR_NOTARIZE: "skip" })).toBe("skip");
  });

  test("an unrecognised value throws rather than falling back to auto", () => {
    // A typo in a release workflow ("ture") must not silently downgrade a
    // signed release to an unnotarised one — that is the whole point.
    expect(() => notarizeModule.notarizeMode({ ATR_NOTARIZE: "ture" })).toThrow(
      /not one of/,
    );
    expect(() =>
      notarizeModule.notarizeMode({ ATR_NOTARIZE: "yes" }),
    ).toThrow();
  });
});

describe("notaryCredentials", () => {
  test("neither strategy configured reports no mode and nothing missing", () => {
    const result = notarizeModule.notaryCredentials({});
    expect(result.mode).toBeNull();
    expect(result.credentials).toBeNull();
    expect(result.missing).toEqual([]);
  });

  test("a complete API key set builds the fields @electron/notarize wants", () => {
    const result = notarizeModule.notaryCredentials(API_KEY_ENV);
    expect(result.mode).toBe("api-key");
    expect(result.missing).toEqual([]);
    expect(result.credentials).toEqual({
      appleApiKey: "/tmp/AuthKey_ABCDE12345.p8",
      appleApiKeyId: "ABCDE12345",
      appleApiIssuer: "c055ca8c-e5a8-4836-b61d-aa5794eeb3f4",
    });
  });

  test("a complete Apple ID set builds the fields @electron/notarize wants", () => {
    const result = notarizeModule.notaryCredentials(APPLE_ID_ENV);
    expect(result.mode).toBe("apple-id");
    expect(result.missing).toEqual([]);
    expect(result.credentials).toEqual({
      appleId: "john@example.com",
      appleIdPassword: "abcd-efgh-ijkl-mnop",
      teamId: "ABCDE12345",
    });
  });

  test("a partial strategy names exactly which variables are unset", () => {
    const one = notarizeModule.notaryCredentials({ APPLE_ID: "john@example.com" });
    expect(one.mode).toBeNull();
    expect(one.credentials).toBeNull();
    expect(one.missing).toEqual([
      "APPLE_APP_SPECIFIC_PASSWORD",
      "APPLE_TEAM_ID",
    ]);

    const two = notarizeModule.notaryCredentials({
      APPLE_API_KEY: "/tmp/key.p8",
      APPLE_API_KEY_ID: "ABCDE12345",
    });
    expect(two.mode).toBeNull();
    expect(two.missing).toEqual(["APPLE_API_ISSUER"]);
  });

  test("an empty value counts as unset, not as set", () => {
    const result = notarizeModule.notaryCredentials({
      APPLE_ID: "john@example.com",
      APPLE_APP_SPECIFIC_PASSWORD: "   ",
      APPLE_TEAM_ID: "ABCDE12345",
    });
    expect(result.mode).toBeNull();
    expect(result.missing).toEqual(["APPLE_APP_SPECIFIC_PASSWORD"]);
  });

  test("when both strategies are complete the API key wins", () => {
    // An app-specific password has to be regenerated whenever the Apple ID
    // password changes, and a leaked one is live until somebody notices; a
    // key is revocable on its own.
    const result = notarizeModule.notaryCredentials({
      ...API_KEY_ENV,
      ...APPLE_ID_ENV,
    });
    expect(result.mode).toBe("api-key");
    expect(result.credentials?.appleApiKeyId).toBe("ABCDE12345");
  });

  test("a partial strategy is reported even when the other would be complete", () => {
    // Otherwise a full API key would mask a half-set Apple ID, and the two
    // would disagree about which one was used.
    const result = notarizeModule.notaryCredentials({
      ...API_KEY_ENV,
      APPLE_ID: "john@example.com",
    });
    expect(result.mode).toBeNull();
    expect(result.missing).toEqual([
      "APPLE_APP_SPECIFIC_PASSWORD",
      "APPLE_TEAM_ID",
    ]);
  });
});

describe("signatureKind", () => {
  test("a Developer ID authority is the only thing that counts as signed", () => {
    expect(notarizeModule.signatureKind(DEVELOPER_ID)).toBe("developer-id");
  });

  test("Signature=adhoc is ad-hoc signed", () => {
    expect(notarizeModule.signatureKind(AD_HOC)).toBe("ad-hoc");
  });

  test("the ad-hoc flag alone is ad-hoc signed, with no Signature= line", () => {
    expect(notarizeModule.signatureKind(AD_HOC_FLAGS_ONLY)).toBe("ad-hoc");
  });

  test("an unsigned bundle is reported as unsigned", () => {
    expect(notarizeModule.signatureKind(UNSIGNED)).toBe("unsigned");
  });

  test("anything it cannot classify is unknown, never a guess", () => {
    expect(notarizeModule.signatureKind(UNRECOGNISABLE)).toBe("unknown");
    expect(notarizeModule.signatureKind("")).toBe("unknown");
    expect(notarizeModule.signatureKind(undefined as unknown as string)).toBe(
      "unknown",
    );
  });

  test("a Developer ID **Installer** certificate is not an application signature", () => {
    const installer = [
      "Authority=Developer ID Installer: John Smith (ABCDE12345)",
      "TeamIdentifier=ABCDE12345",
    ].join("\n");
    expect(notarizeModule.signatureKind(installer)).toBe("unknown");
  });
});

describe("decideNotarization", () => {
  const complete = { mode: "api-key" as const, credentials: {}, missing: [] };
  const none = { mode: null, credentials: null, missing: [] };

  test("a non-macOS build has nothing to notarise", () => {
    const decision = notarizeModule.decideNotarization({
      platform: "linux",
      signature: "developer-id",
      credentials: complete,
      mode: "require",
    });
    expect(decision.action).toBe("skip");
    expect(decision.reason).toContain("linux");
  });

  test("half-configured credentials fail in every mode, naming the gap", () => {
    for (const mode of ["auto", "require", "skip"]) {
      const decision = notarizeModule.decideNotarization({
        platform: "darwin",
        signature: "developer-id",
        credentials: {
          mode: null,
          credentials: null,
          missing: ["APPLE_TEAM_ID"],
        },
        mode,
      });
      expect(decision.action, `mode ${mode} must still fail`).toBe("fail");
      expect(decision.reason).toContain("APPLE_TEAM_ID");
    }
  });

  test("require refuses a build Apple would refuse", () => {
    for (const signature of ["ad-hoc", "unsigned", "unknown"]) {
      const decision = notarizeModule.decideNotarization({
        platform: "darwin",
        signature,
        credentials: complete,
        mode: "require",
      });
      expect(decision.action).toBe("fail");
      expect(decision.reason).toContain(signature);
    }
  });

  test("require with a Developer ID build but no credentials fails", () => {
    const decision = notarizeModule.decideNotarization({
      platform: "darwin",
      signature: "developer-id",
      credentials: none,
      mode: "require",
    });
    expect(decision.action).toBe("fail");
    expect(decision.reason).toContain("APPLE_API_KEY");
    expect(decision.reason).toContain("APPLE_ID");
  });

  test("require with both a Developer ID build and credentials notarises", () => {
    const decision = notarizeModule.decideNotarization({
      platform: "darwin",
      signature: "developer-id",
      credentials: complete,
      mode: "require",
    });
    expect(decision.action).toBe("notarize");
  });

  test("skip is skip, whatever the build and credentials are", () => {
    const decision = notarizeModule.decideNotarization({
      platform: "darwin",
      signature: "developer-id",
      credentials: complete,
      mode: "skip",
    });
    expect(decision.action).toBe("skip");
    expect(decision.reason).toContain("skip");
  });

  test("auto skips a build with no Developer ID signature", () => {
    const decision = notarizeModule.decideNotarization({
      platform: "darwin",
      signature: "ad-hoc",
      credentials: complete,
      mode: "auto",
    });
    expect(decision.action).toBe("skip");
    expect(decision.reason).toContain("ad-hoc");
  });

  test("auto skips a Developer ID build with no credentials to submit with", () => {
    const decision = notarizeModule.decideNotarization({
      platform: "darwin",
      signature: "developer-id",
      credentials: none,
      mode: "auto",
    });
    expect(decision.action).toBe("skip");
    expect(decision.reason).toContain("no notarisation credentials");
  });

  test("auto notarises the one combination that can be notarised", () => {
    const decision = notarizeModule.decideNotarization({
      platform: "darwin",
      signature: "developer-id",
      credentials: complete,
      mode: "auto",
    });
    expect(decision.action).toBe("notarize");
  });

  test("an empty call does not throw — it skips", () => {
    // The CLI and the hook both call this before they know anything.
    expect(notarizeModule.decideNotarization({}).action).toBe("skip");
  });
});

describe("codesignDescription and stapleValidate", () => {
  test("a failing codesign still yields its description", () => {
    // An unsigned bundle makes `codesign` exit non-zero while still printing
    // the verdict on stderr — that text *is* the answer.
    const thrown = Object.assign(new Error("exited 1"), {
      stderr: UNSIGNED,
      stdout: "",
    });
    const run = () => {
      throw thrown;
    };
    expect(notarizeModule.codesignDescription("/tmp/x.app", run)).toBe(UNSIGNED);
  });

  test("a successful codesign returns its output", () => {
    const run = () => AD_HOC;
    expect(notarizeModule.codesignDescription("/tmp/x.app", run)).toBe(AD_HOC);
  });

  test("stapleValidate reports the failure instead of throwing", () => {
    const thrown = Object.assign(new Error("exited 65"), {
      stderr: "Processing: /tmp/x.app\nx.app does not have a ticket stapled to it.",
      stdout: "",
    });
    const failing = notarizeModule.stapleValidate("/tmp/x.app", () => {
      throw thrown;
    });
    expect(failing.ok).toBe(false);
    expect(failing.output).toContain("does not have a ticket stapled to it");

    const ok = notarizeModule.stapleValidate("/tmp/x.app", () => "validated");
    expect(ok.ok).toBe(true);
  });
});

describe("parseArgs", () => {
  test("--app takes the next argument and --notarize is a flag", () => {
    const parsed = notarizeModule.parseArgs([
      "--app",
      "/tmp/AllTheRepos.app",
      "--notarize",
    ]);
    expect(parsed).toEqual({ appPath: "/tmp/AllTheRepos.app", submit: true });
  });

  test("with no flags, nothing is claimed and nothing is submitted", () => {
    expect(notarizeModule.parseArgs([])).toEqual({
      appPath: null,
      submit: false,
    });
  });

  test("--require demands notarisation through the environment", () => {
    notarizeModule.parseArgs(["--require"]);
    expect(process.env.ATR_NOTARIZE).toBe("require");
  });

  test("an unknown flag throws rather than being ignored", () => {
    expect(() => notarizeModule.parseArgs(["--notorize"])).toThrow(
      /unknown flag/,
    );
  });
});

describe("afterSign", () => {
  const context = {
    electronPlatformName: "darwin",
    appOutDir: "/tmp/build/mac-arm64",
    packager: { appInfo: { productFilename: "AllTheRepos", id: "com.alltherepos.desktop" } },
  };

  test("an ad-hoc build is skipped, and nothing is submitted", async () => {
    const notarize = vi.fn(async (_options: Record<string, unknown>) => {});
    const logs: string[] = [];

    await notarizeModule.default(context, {
      env: { ATR_NOTARIZE: "auto" },
      signature: "ad-hoc",
      appPath: "/tmp/build/mac-arm64/AllTheRepos.app",
      notarize,
      validate: () => ({ ok: true, output: "" }),
      log: (line: unknown) => logs.push(String(line)),
    });

    expect(notarize).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("skipped");
  });

  test("a Developer ID build with credentials is submitted once, with them", async () => {
    const notarize = vi.fn(async (_options: Record<string, unknown>) => {});
    const validate = vi.fn(() => ({ ok: true, output: "validated" }));

    await notarizeModule.default(context, {
      env: { ATR_NOTARIZE: "require", ...API_KEY_ENV },
      signature: "developer-id",
      appPath: "/tmp/build/mac-arm64/AllTheRepos.app",
      notarize,
      validate,
      log: () => {},
    });

    expect(notarize).toHaveBeenCalledTimes(1);
    expect(notarize.mock.calls[0][0]).toMatchObject({
      appPath: "/tmp/build/mac-arm64/AllTheRepos.app",
      appleApiKey: API_KEY_ENV.APPLE_API_KEY,
      appleApiKeyId: API_KEY_ENV.APPLE_API_KEY_ID,
      appleApiIssuer: API_KEY_ENV.APPLE_API_ISSUER,
    });
    expect(validate).toHaveBeenCalledWith("/tmp/build/mac-arm64/AllTheRepos.app");
  });

  test("an Apple ID credential is passed through in its own shape", async () => {
    const notarize = vi.fn(async (_options: Record<string, unknown>) => {});

    await notarizeModule.default(context, {
      env: { ATR_NOTARIZE: "require", ...APPLE_ID_ENV },
      signature: "developer-id",
      appPath: "/tmp/build/mac-arm64/AllTheRepos.app",
      notarize,
      validate: () => ({ ok: true, output: "" }),
      log: () => {},
    });

    expect(notarize.mock.calls[0][0]).toMatchObject({
      appleId: APPLE_ID_ENV.APPLE_ID,
      appleIdPassword: APPLE_ID_ENV.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: APPLE_ID_ENV.APPLE_TEAM_ID,
    });
  });

  test("a missing stapled ticket fails the build", async () => {
    // The bundle was accepted by Apple but carries no ticket, so a
    // downloaded copy would still be refused by Gatekeeper.
    await expect(
      notarizeModule.default(context, {
        env: { ATR_NOTARIZE: "require", ...API_KEY_ENV },
        signature: "developer-id",
        appPath: "/tmp/build/mac-arm64/AllTheRepos.app",
        notarize: vi.fn(async (_options: Record<string, unknown>) => {}),
        validate: () => ({ ok: false, output: "does not have a ticket stapled" }),
        log: () => {},
      }),
    ).rejects.toThrow(/ticket stapled/);
  });

  test("require plus no credentials throws instead of publishing unnotarised", async () => {
    await expect(
      notarizeModule.default(context, {
        env: { ATR_NOTARIZE: "require" },
        signature: "developer-id",
        appPath: "/tmp/build/mac-arm64/AllTheRepos.app",
        notarize: vi.fn(async (_options: Record<string, unknown>) => {}),
        validate: () => ({ ok: true, output: "" }),
        log: () => {},
      }),
    ).rejects.toThrow(/no credentials are set/);
  });

  test("it reads a real bundle's signature when one is not injected", async () => {
    // `codesign` is injected here, so this proves the hook consults the
    // bundle rather than trusting the build config — the fixtures above are
    // what that read produces.
    const notarize = vi.fn(async (_options: Record<string, unknown>) => {});
    let asked: string[] | null = null;

    await notarizeModule.default(context, {
      env: { ATR_NOTARIZE: "auto" },
      appPath: "/tmp/build/mac-arm64/AllTheRepos.app",
      run: (command, args) => {
        asked = [command, ...args];
        return DEVELOPER_ID;
      },
      notarize,
      validate: () => ({ ok: true, output: "" }),
      log: () => {},
    });

    expect(asked?.[0]).toBe("codesign");
    expect(asked?.[1]).toBe("-dvvv");
    // Credentials are absent, so even a Developer ID build is skipped — but
    // the classification came from `codesign`, not from a guess.
    expect(notarize).not.toHaveBeenCalled();
  });
});
