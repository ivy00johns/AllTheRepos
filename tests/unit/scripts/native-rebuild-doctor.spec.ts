/**
 * Unit test for `scripts/native-rebuild-doctor.mjs`.
 *
 * The doctor exists because a failed native rebuild prints a linker tail that
 * names its cause only to somebody who already knows which of the ways a C++
 * addon can fail this is. `docs/REMAINING-WORK.md` records the one that cost
 * this project a session (ATR-057): the Command Line Tools update of
 * 2026-09-22 left `MacOSX.sdk` pointing at SDK 27.0, whose stubs name
 * architectures clang does not know, so every `node-gyp` link dies with
 * `tapi error: malformed file`.
 *
 * The failure block below is that machine's real output, not a paraphrase.
 * Keeping the genuine text is the only honest way to test a classifier whose
 * whole job is reading compiler output — and it is worth keeping because the
 * signature it carries is about a toolchain, not about that afternoon.
 *
 * What these tests are protecting:
 *
 *   - the mismatch is named, with the remedy that fixed it on the machine it
 *     was found on (`SDKROOT`, or selecting full Xcode);
 *   - a machine with no toolchain at all gets the other remedy, because
 *     "install the Command Line Tools" is not advice that helps a linker that
 *     disagrees with an SDK it already has;
 *   - unrecognised output gets **no** verdict. A doctor that always has
 *     something to say is worth nothing on the failure it was written for, so
 *     silence is asserted rather than merely allowed;
 *   - `unknown architecture` on its own is not a toolchain mismatch. A missing
 *     prebuild says the same words about a failure that has nothing to do with
 *     the compiler, and the doctor demands the linker complaint as well.
 *
 * The script is imported by URL (a `.mjs` with no declarations) and driven as
 * a module, which is how the other script specs here run theirs — no child
 * process, and the sentences a person would read come back as values.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "native-rebuild-doctor.mjs");

interface Diagnosis {
  headline: string;
  detail: string;
  remedy: string;
}

interface DoctorModule {
  diagnoseNativeBuild(output: string): Diagnosis | null;
}

let doctor: DoctorModule;

beforeAll(async () => {
  doctor = (await import(pathToFileURL(SCRIPT).href)) as unknown as DoctorModule;
});

/**
 * This machine's real failed rebuild, from the CommandLineTools SDK 27.0 /
 * clang 21 mismatch. The two lines that matter are the linker's complaint about
 * the SDK's stubs and the SDK's own architecture list.
 */
const TOOLCHAIN_MISMATCH = [
  "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/ld: multiple errors: tapi error: malformed file",
  "/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk/usr/lib/libSystem.B.tbd:4:20: error: unknown architecture",
  "                   arm64e.x1-macos, arm64e.x1-maccatalyst ]",
  "clang++: error: linker command failed with exit code 1 (use -v to see invocation)",
  "make: *** [Release/findGitRepos.node] Error 1",
  "Error: `make` failed with exit code: 2",
  "node-gyp failed to rebuild '/tmp/x/node_modules/find-git-repositories'",
  "",
].join("\n");

describe("a rebuild that failed because the toolchain disagrees with the SDK", () => {
  test("is named as a toolchain mismatch, in the words the remedy needs", () => {
    const diagnosis = doctor.diagnoseNativeBuild(TOOLCHAIN_MISMATCH);

    expect(diagnosis).not.toBeNull();
    // Compiler and SDK, both — the failure is the disagreement, and naming one
    // of them would send a person to look at the wrong half.
    expect(diagnosis?.headline).toContain("compiler");
    expect(diagnosis?.headline).toContain("macOS SDK");
  });

  test("quotes the line that identified it, so the verdict can be checked", () => {
    const diagnosis = doctor.diagnoseNativeBuild(TOOLCHAIN_MISMATCH);

    // The verdict is only trustworthy if the evidence for it is on screen
    // beside it; the reader should be able to disagree with the reading.
    expect(diagnosis?.detail).toContain("tapi error: malformed file");
  });

  test("and the remedy is the one this project recorded, plus the repair", () => {
    const diagnosis = doctor.diagnoseNativeBuild(TOOLCHAIN_MISMATCH);

    // Three things, all of them from ATR-057 rather than invented here: the
    // per-build `SDKROOT` export that is written down as the workaround, the
    // durable switch of developer directory for anybody who would rather stop
    // thinking about it, and the entry point a failed link deletes on its way
    // out — which is what leaves the app unable to scan even after the ABI has
    // been flipped back.
    expect(diagnosis?.remedy).toContain("SDKROOT");
    expect(diagnosis?.remedy).toContain("xcode-select");
    expect(diagnosis?.remedy).toContain("findGitRepos.node");
    // And it says what it is not, because a red CI-shaped failure reads like a
    // broken repository rather than a broken laptop.
    expect(diagnosis?.remedy).toContain("local-machine blocker");
  });
});

describe("a machine that has no toolchain at all", () => {
  test("is told to install one, not to go looking for an SDK mismatch", () => {
    const output = [
      "gyp: No Xcode or CLT version detected!",
      "gyp ERR! configure error",
      "Error: `make` failed with exit code: 2",
      "",
    ].join("\n");

    const diagnosis = doctor.diagnoseNativeBuild(output);

    expect(diagnosis?.headline).toContain("no compiler");
    expect(diagnosis?.remedy).toContain("xcode-select --install");
  });
});

describe("output it cannot read", () => {
  test("gets no verdict, rather than a confident guess", () => {
    // A TypeScript error is a failure of a different kind entirely, and the
    // tempting shape of a doctor is one that reads "Error:" and starts talking.
    const output = [
      "src/renderer/routes/graph.tsx(509,7): error TS2322: Type 'number' is not assignable to type 'string'.",
      " ELIFECYCLE  Command failed with exit code 2.",
      "",
    ].join("\n");

    expect(doctor.diagnoseNativeBuild(output)).toBeNull();
  });

  test("and nothing at all gets no verdict either", () => {
    expect(doctor.diagnoseNativeBuild("")).toBeNull();
  });

  test("including a bare make failure with no linker complaint in it", () => {
    // An interrupted or out-of-memory compile looks like this, and it is not a
    // toolchain problem — the remedy above would waste the reader's time.
    const output = ["make: *** [Release/findGitRepos.node] Error 1", ""].join(
      "\n",
    );

    expect(doctor.diagnoseNativeBuild(output)).toBeNull();
  });

  test("and an architecture complaint from somewhere other than the linker", () => {
    // `unknown architecture` is also what a package with no prebuild for this
    // machine says. It is the neighbouring mistake, not this one, so the linker
    // complaint is required rather than the architecture word alone.
    const output = [
      "Cannot find a prebuilt binary for architecture arm64.",
      "make: *** [Release/findGitRepos.node] Error 1",
      "",
    ].join("\n");

    expect(doctor.diagnoseNativeBuild(output)).toBeNull();
  });
});
