/**
 * native-rebuild-doctor.mjs — why a native rebuild failed, said in words.
 *
 * `scripts/ensure-native-abi.mjs` rebuilds `better-sqlite3` and
 * `find-git-repositories` whenever this tree is set up for the other runtime,
 * and every command that runs the suite or launches the app starts there. When
 * the compile fails, what reaches the terminal is the last lines of a linker or
 * node-gyp tail — text that names its cause only to somebody who already knows
 * which of the several ways a C++ addon can fail this is. "`make` failed",
 * then a stack trace, then a person opening three browser tabs.
 *
 * This machine has one of those failures on record: the Command Line Tools
 * update of 2026-09-22 left `MacOSX.sdk` pointing at SDK 27.0, whose stubs name
 * architectures (`arm64e.x1-macos`) that the installed clang does not know, so
 * every `node-gyp` link dies with `tapi error: malformed file`. It is written
 * down in `docs/REMAINING-WORK.md` as ATR-057, and identifying it cost a
 * session's work. This module exists so the second time is free.
 *
 * It is a pure function over captured output. It reads nothing, prints
 * nothing, and answers `null` for output it does not recognise — which matters
 * as much as a match. A doctor with something to say about every failure would
 * be worth nothing on the failure it was written for.
 */

/**
 * What a linker says when the SDK's own stubs are a document it cannot read.
 */
const LINKER_COMPLAINTS = [
  "tapi error: malformed file",
  "ld: multiple errors",
  "linker command failed with exit code",
];

/**
 * What it says about the architecture it was handed, or the SDK it came from.
 * Never sufficient on its own: `unknown architecture` is also what a missing
 * prebuild says, and that failure has nothing to do with the toolchain.
 */
const SDK_COMPLAINTS = ["unknown architecture", ".tbd", "MacOSX"];

/**
 * A machine with no Xcode toolchain at all. `node-gyp` reports this as a
 * build failure rather than as a missing dependency, so it belongs here.
 */
const NO_COMPILER_COMPLAINTS = [
  "xcode-select: error",
  "xcrun: error: unable to find utility",
  "gyp: No Xcode or CLT version detected",
  "clang: command not found",
];

/** The first line of `output` mentioning any of `needles`, trimmed. */
function firstLineMentioning(output, needles) {
  for (const line of output.split(/\r?\n/)) {
    if (needles.some((needle) => line.includes(needle))) return line.trim();
  }
  return null;
}

/**
 * One diagnosis, or `null` when the output names nothing this knows.
 *
 * @param {string} output combined stdout and stderr of the failed rebuild
 * @returns {{ headline: string, detail: string, remedy: string } | null}
 */
export function diagnoseNativeBuild(output) {
  if (typeof output !== "string" || output.trim() === "") return null;

  // Checked first, and both halves of it are required: a compiler that is not
  // there cannot have produced a linker complaint, so anything carrying one is
  // further along than a missing toolchain.
  const linkerLine = firstLineMentioning(output, LINKER_COMPLAINTS);
  const sdkLine = firstLineMentioning(output, SDK_COMPLAINTS);
  if (linkerLine !== null && sdkLine !== null) {
    return {
      headline:
        "the compiler and the macOS SDK it links against are not the same vintage",
      detail: `The link failed on the SDK's own stub files — ${linkerLine}`,
      remedy:
        "Point this build at an SDK the compiler understands — `export SDKROOT=$(xcrun --sdk macosx --show-sdk-path)` before rebuilding, and if that path is the one being rejected, the Xcode one under /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs — or switch the developer directory for good with `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`. This is a local-machine blocker rather than a defect in the code: CI builds the same addons on a runner whose toolchain matches. One consequence to repair by hand afterwards, because the failed link deletes it first: `node_modules/find-git-repositories/build/Release/findGitRepos.node` is the copy the package's entry point loads, and the identical artifact sits beside it at `bin/darwin-<arch>-<abi>/find-git-repositories.node`, so `cp` it back before the app can scan.",
    };
  }

  const toolchainLine = firstLineMentioning(output, NO_COMPILER_COMPLAINTS);
  if (toolchainLine !== null) {
    return {
      headline: "there is no compiler for the rebuild to use",
      detail: `node-gyp could not find an Xcode toolchain — ${toolchainLine}`,
      remedy:
        "Install the Command Line Tools by running `xcode-select --install` by hand, then rebuild. If full Xcode is installed but not selected, `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` is the other half of the same fix.",
    };
  }

  return null;
}
