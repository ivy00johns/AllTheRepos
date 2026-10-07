/**
 * Unit test — `@main/services/signing`.
 *
 * This module answers the one question that decides whether the update UI
 * offers an install or a download: is the running bundle Developer-ID signed
 * *and* accepted by Gatekeeper? Getting it wrong is not a cosmetic failure —
 * a wrong `true` downloads a hundred megabytes before failing at the last
 * step, and a wrong `false` makes every signed install behave like an ad-hoc
 * one forever.
 *
 * Three things are pinned here:
 *
 *   1. **The classification.** `parseSignature` reads real `codesign -dvvv`
 *      output, including the shape a bundle presents with its signature
 *      stripped — the ad-hoc flag with no `Signature=` line.
 *   2. **A drift guard.** The same classification exists in
 *      `scripts/notarize.mjs`, where it decides whether to *submit* a build
 *      for notarisation, while this one decides whether to *offer an install*
 *      inside it. If they ever disagree, a release can be notarised as one
 *      thing and treated as another, so both are driven with identical
 *      fixtures and must give identical answers.
 *   3. **The decision, including the half-signed case.** A Developer-ID
 *      signed bundle with no notarisation ticket passes `codesign` and fails
 *      Gatekeeper; it must not install.
 *
 * `probeSigning` shells out to `codesign` and `spctl` against the running
 * bundle, which does not exist under vitest, so it is only tested for the
 * unpackaged path and for its refusal to install when the probes cannot
 * succeed. The packaged, properly signed path is proven on a real bundle by
 * the release workflow's own run of
 * `tests/e2e/packaged-update-check.spec.ts`.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import {
  assessSigning,
  parseSignature,
  probeSigning,
  resetSigningProbe,
} from "@main/services/signing";

/** Mutable so a test can pretend the app is packaged. */
const electronApp = vi.hoisted(() => ({
  isPackaged: false,
  getAppPath: () => "/tmp/definitely-not-a-bundle/AllTheRepos.app",
}));

vi.mock("electron", () => ({ app: electronApp }));

const SCRIPTS = path.resolve(__dirname, "..", "..", "..", "..", "scripts");

let signatureKind: (codesignOutput: string) => string;

beforeAll(async () => {
  const notarizeModule = (await import(
    pathToFileURL(path.join(SCRIPTS, "notarize.mjs")).href
  )) as unknown as { signatureKind: (text: string) => string };
  signatureKind = notarizeModule.signatureKind;
});

afterEach(() => {
  resetSigningProbe();
  electronApp.isPackaged = false;
});

const DEVELOPER_ID = [
  "Executable=/Applications/AllTheRepos.app/Contents/MacOS/AllTheRepos",
  "Identifier=com.alltherepos.desktop",
  "CodeDirectory v=20500 size=1189 flags=0x10000(runtime) hashes=28+7 location=embedded",
  "Authority=Developer ID Application: John Smith (ABCDE12345)",
  "Authority=Developer ID Certification Authority",
  "Authority=Apple Root CA",
  "TeamIdentifier=ABCDE12345",
  "Runtime Version=14.0.0",
].join("\n");

const AD_HOC = [
  "Identifier=com.alltherepos.desktop",
  "CodeDirectory v=20400 size=464 flags=0x2(adhoc) hashes=4+7 location=embedded",
  "Signature=adhoc",
  "TeamIdentifier=not set",
].join("\n");

const AD_HOC_FLAGS_ONLY = [
  "Identifier=com.alltherepos.desktop",
  "CodeDirectory v=20400 size=464 flags=0x2(adhoc) hashes=4+7 location=embedded",
  "TeamIdentifier=not set",
].join("\n");

const UNSIGNED =
  "/tmp/build/AllTheRepos.app: code object is not signed at all\n" +
  "In subcomponent: /tmp/build/AllTheRepos.app/Contents/MacOS/AllTheRepos";

const INSTALLER_CERT = [
  "Authority=Developer ID Installer: John Smith (ABCDE12345)",
  "TeamIdentifier=ABCDE12345",
].join("\n");

describe("parseSignature", () => {
  test("a Developer ID authority is the only thing that counts as signed", () => {
    expect(parseSignature(DEVELOPER_ID)).toBe("developer-id");
  });

  test("Signature=adhoc is ad-hoc signed", () => {
    expect(parseSignature(AD_HOC)).toBe("ad-hoc");
  });

  test("the ad-hoc flag alone is ad-hoc signed, with no Signature= line", () => {
    expect(parseSignature(AD_HOC_FLAGS_ONLY)).toBe("ad-hoc");
  });

  test("an unsigned bundle is reported as unsigned", () => {
    expect(parseSignature(UNSIGNED)).toBe("unsigned");
  });

  test("anything it cannot classify is unknown, never a guess", () => {
    expect(parseSignature("")).toBe("unknown");
    expect(parseSignature("no signature facts here")).toBe("unknown");
    expect(parseSignature(INSTALLER_CERT)).toBe("unknown");
  });
});

describe("drift guard — the two classifiers must agree", () => {
  /**
   * Both functions answer "is this bundle Developer-ID signed?" about the
   * same `codesign` output: the script decides whether to submit the build
   * to Apple, the service decides whether to offer an install inside it. A
   * disagreement would not fail anything visibly — it would just quietly
   * stop signing, or quietly ship an install that cannot complete.
   */
  test("every fixture classifies identically in both", () => {
    const fixtures: Record<string, string> = {
      developerId: DEVELOPER_ID,
      adHoc: AD_HOC,
      adHocFlagsOnly: AD_HOC_FLAGS_ONLY,
      unsigned: UNSIGNED,
      installerCert: INSTALLER_CERT,
      empty: "",
      junk: "something else entirely",
    };

    for (const [name, fixture] of Object.entries(fixtures)) {
      expect(
        parseSignature(fixture),
        `service and script disagree about "${name}"`,
      ).toBe(signatureKind(fixture));
    }
  });

  test("agreement includes the developer-id answer specifically", () => {
    // The weaker property — that they agree — is not enough on its own: two
    // functions that both said "unknown" would agree about everything.
    expect(parseSignature(DEVELOPER_ID)).toBe("developer-id");
    expect(signatureKind(DEVELOPER_ID)).toBe("developer-id");
    expect(parseSignature(AD_HOC)).not.toBe("developer-id");
    expect(signatureKind(AD_HOC)).not.toBe("developer-id");
  });
});

describe("assessSigning", () => {
  test("running from source cannot install, and says so", () => {
    const assessment = assessSigning({
      isPackaged: false,
      platform: "darwin",
      signature: "developer-id",
      notarized: true,
    });
    expect(assessment.canInstall).toBe(false);
    expect(assessment.reason).toMatch(/running from source/);
  });

  test("a non-macOS build cannot install", () => {
    const assessment = assessSigning({
      isPackaged: true,
      platform: "linux",
      signature: "developer-id",
      notarized: true,
    });
    expect(assessment.canInstall).toBe(false);
  });

  test("an ad-hoc signed build cannot install, and the reason says ad-hoc", () => {
    const assessment = assessSigning({
      isPackaged: true,
      platform: "darwin",
      signature: "ad-hoc",
      notarized: false,
    });
    expect(assessment.canInstall).toBe(false);
    expect(assessment.reason).toMatch(/ad-hoc/);
  });

  test("an unsigned build cannot install, and the reason says not signed", () => {
    const assessment = assessSigning({
      isPackaged: true,
      platform: "darwin",
      signature: "unsigned",
      notarized: false,
    });
    expect(assessment.canInstall).toBe(false);
    expect(assessment.reason).toMatch(/not code-signed/);
  });

  test("a Developer-ID signed but unnotarised build cannot install", () => {
    // This is the half-signed case: `codesign` passes, Gatekeeper does not.
    const assessment = assessSigning({
      isPackaged: true,
      platform: "darwin",
      signature: "developer-id",
      notarized: false,
    });
    expect(assessment.canInstall).toBe(false);
    expect(assessment.signature).toBe("developer-id");
    expect(assessment.reason).toMatch(/not notarised/);
  });

  test("only a signed, notarised, packaged macOS bundle can install", () => {
    const assessment = assessSigning({
      isPackaged: true,
      platform: "darwin",
      signature: "developer-id",
      notarized: true,
    });
    expect(assessment).toEqual({
      signature: "developer-id",
      notarized: true,
      canInstall: true,
      reason: expect.stringMatching(/can update itself/),
    });
  });

  test("a reason is always present, so the UI never has to invent one", () => {
    const combinations = [
      { isPackaged: true, platform: "darwin", signature: "developer-id", notarized: true },
      { isPackaged: true, platform: "darwin", signature: "unknown", notarized: false },
      { isPackaged: false, platform: "darwin", signature: "unknown", notarized: false },
      { isPackaged: true, platform: "win32", signature: "ad-hoc", notarized: false },
    ] as const;
    for (const input of combinations) {
      expect(assessSigning(input).reason.length).toBeGreaterThan(0);
    }
  });
});

describe("probeSigning", () => {
  test("an unpackaged probe reports that it cannot install", () => {
    electronApp.isPackaged = false;
    resetSigningProbe();
    const assessment = probeSigning();
    expect(assessment.canInstall).toBe(false);
    expect(assessment.signature).toBe("unknown");
  });

  test("the probe is cached for the process lifetime", () => {
    electronApp.isPackaged = false;
    resetSigningProbe();
    expect(probeSigning()).toBe(probeSigning());

    // …and the seam is what lets a later case see a different answer.
    resetSigningProbe();
    expect(probeSigning()).not.toBeUndefined();
  });

  test("a packaged probe against a path with no bundle still cannot install", () => {
    // `codesign`/`spctl` are real here, and there is nothing at this path, so
    // whatever they report must not be mistaken for a signed build. Only the
    // verdict is asserted — the reason depends on which binaries exist on the
    // machine running the suite.
    electronApp.isPackaged = true;
    resetSigningProbe();
    expect(probeSigning().canInstall).toBe(false);
  });
});
