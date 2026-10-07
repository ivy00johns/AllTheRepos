/**
 * Signing — what this build is allowed to do about its own updates.
 *
 * ## The question this answers
 *
 * macOS applies an update through Squirrel.Mac, which refuses to install
 * anything that is not validly code-signed by a Developer ID certificate and
 * accepted by Gatekeeper. An ad-hoc signed build — every build this project
 * can make without a paid Apple Developer membership — therefore *cannot*
 * install an update. It can download one; it cannot apply it.
 *
 * That is not a reason to leave the code out. It is the reason the code has
 * to ask first. So this module answers one question about the running
 * bundle, and the updater offers the install affordance only when the answer
 * is yes:
 *
 *   is this bundle Developer-ID signed *and* accepted by Gatekeeper?
 *
 * ## Why the answer is read off the bundle, not the build config
 *
 * `electron-builder.yml` says what a build was *supposed* to be. The bundle
 * says what it *is*. Those differ exactly when it matters — a build that
 * silently fell back to ad-hoc because a certificate was missing, a copy
 * whose signature was broken in transit, a rehearsal that never had one —
 * and in every one of those cases a config-derived answer would turn on an
 * install path that fails after downloading a hundred megabytes. So the
 * probe runs `codesign` and `spctl` against the app on disk.
 *
 * ## Both checks, not just the signature
 *
 * `codesign` proves the bundle is signed by a Developer ID authority.
 * `spctl --assess` proves *this machine's* Gatekeeper would run it — which
 * additionally requires the notarisation ticket, either stapled to the
 * bundle or available from Apple. A Developer-ID signed bundle with no
 * ticket passes the first and fails the second, and it is the second that
 * decides whether an update can be applied.
 *
 * The classification of `codesign` output is duplicated in
 * `scripts/notarize.mjs`, which decides whether to *submit* a build for
 * notarisation, while this decides whether to *offer an install* in one.
 * The two must agree about what "Developer ID signed" means, so
 * `tests/unit/main/services/signing.spec.ts` drives both with the same
 * fixtures and fails if they ever disagree.
 */

import { spawnSync } from "node:child_process";

import { app } from "electron";

export type SignatureKind = "developer-id" | "ad-hoc" | "unsigned" | "unknown";

export interface SigningAssessment {
  /** How the bundle is signed, as `codesign` describes it. */
  signature: SignatureKind;
  /** Gatekeeper accepted the bundle — signature *and* notarisation. */
  notarized: boolean;
  /** The bundle may install its own updates. */
  canInstall: boolean;
  /** Why `canInstall` is what it is — shown to a person as-is. */
  reason: string;
}

/**
 * Classify `codesign -dvvv` output.
 *
 * `-dvvv` writes to stderr, and an unsigned bundle exits non-zero while
 * still describing itself there, so callers pass both streams and treat
 * non-zero as "read the text anyway".
 */
export function parseSignature(codesignOutput: string): SignatureKind {
  const text = String(codesignOutput ?? "");
  if (/^Authority=Developer ID Application:/m.test(text)) {
    return "developer-id";
  }
  if (/code object is not signed at all/.test(text)) return "unsigned";
  if (/^Signature=adhoc$/m.test(text) || /\(adhoc\)/.test(text)) {
    return "ad-hoc";
  }
  return "unknown";
}

/**
 * The whole decision, as a pure function.
 *
 * `isPackaged` is the first gate because the other probes are meaningless
 * without it: an unpackaged run is `out/` on a disk, not a bundle with a
 * signature, and its "update" is a `pnpm electron:dev` away.
 */
export function assessSigning({
  isPackaged,
  platform,
  signature,
  notarized,
}: {
  isPackaged: boolean;
  platform: string;
  signature: SignatureKind;
  notarized: boolean;
}): SigningAssessment {
  if (!isPackaged) {
    return {
      signature: "unknown",
      notarized: false,
      canInstall: false,
      reason:
        "Update checks only run in a packaged build — you're running from source.",
    };
  }

  if (platform !== "darwin") {
    return {
      signature,
      notarized,
      canInstall: false,
      reason: "Automatic updates are macOS-only for now.",
    };
  }

  if (signature !== "developer-id") {
    return {
      signature,
      notarized: false,
      canInstall: false,
      reason:
        signature === "unsigned"
          ? "This build is not code-signed, so macOS will not let it update itself. Download the DMG instead."
          : "This build is ad-hoc signed, so macOS will not let it update itself. Download the DMG instead.",
    };
  }

  if (!notarized) {
    return {
      signature,
      notarized: false,
      canInstall: false,
      reason:
        "This build is Developer-ID signed but not notarised, so Gatekeeper will not run it from a download. Download the DMG instead.",
    };
  }

  return {
    signature,
    notarized: true,
    canInstall: true,
    reason: "Signed with a Developer ID and notarised — this build can update itself.",
  };
}

/** Run a command and hand back both streams plus the exit status. */
function run(command: string, args: string[]): { output: string; ok: boolean } {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) throw result.error;
    return {
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      ok: result.status === 0,
    };
  } catch (error) {
    // A missing `codesign` (or a sandbox that forbids it) must not take the
    // app down; it lands as `unknown`, which cannot install.
    return { output: String((error as Error)?.message ?? error), ok: false };
  }
}

/**
 * Probe the *running* bundle. Cached for the process lifetime — signatures
 * do not change under a running app, and this shells out twice.
 */
let cached: SigningAssessment | null = null;

export function probeSigning(): SigningAssessment {
  if (cached) return cached;

  const isPackaged = app.isPackaged;
  if (!isPackaged) {
    cached = assessSigning({
      isPackaged,
      platform: process.platform,
      signature: "unknown",
      notarized: false,
    });
    return cached;
  }

  const appPath = app.getAppPath().replace(/\/Contents\/Resources\/app\.asar$/, "");
  const codesign = run("codesign", ["-dvvv", appPath]);
  const spctl = run("spctl", ["--assess", "--type", "execute", appPath]);

  cached = assessSigning({
    isPackaged,
    platform: process.platform,
    signature: parseSignature(codesign.output),
    notarized: spctl.ok,
  });
  return cached;
}

/** Test seam — a cached probe in a spec would leak between cases. */
export function resetSigningProbe(): void {
  cached = null;
}
