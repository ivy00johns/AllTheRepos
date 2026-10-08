/**
 * Unit test for `scripts/ensure-native-abi.mjs`.
 *
 * The script decides which ABI a tree holds before a runtime consumes it, and
 * its only input used to be "does `better-sqlite3` load in this process?".
 * That question has two answers, so every failure that was not the host's own
 * ABI came back as "electron" — including a module built for a different
 * *Node* ABI. On 2026-10-08 that is exactly what happened: ABI 127 sat in the
 * tree while Electron wanted 135, the flip reported "already built for
 * electron — skipping", and the app died on launch with the NODE_MODULE_VERSION
 * error the flip had just approved.
 *
 * What is pinned here is the truth table, and above all the case that was
 * invisible before: nothing loads, and the verdict is `broken` rather than
 * `electron`.
 *
 * The second thing it pins is that a flip which cannot finish leaves the tree
 * where it found it. `node-gyp rebuild` deletes the addon before building a
 * replacement, so a link failure — every source build here, ATR-057 — leaves
 * none at all, which is how a run under a Node this project does not pin
 * destroyed a working host addon and left both suites unable to start. The
 * stash therefore lives outside the tree: the first version sat in
 * `build/Release` and was deleted by the same clean it was meant to survive.
 *
 * The script is imported by URL (a `.mjs` CLI with no declarations), the way
 * the other script specs here import theirs, and the attempts are injected so
 * nothing spawns a runtime.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "ensure-native-abi.mjs");

interface Attempt {
  loads: boolean;
  abiMismatch?: boolean;
  message?: string;
}

interface Module {
  decideAbi(input: { host: Attempt; electron: Attempt }): string;
  currentAbi(input?: { host?: Attempt; electron?: Attempt }): string;
  abiNumberFor(target: string): number | null;
  loadAttempt(options: { execPath: string; probe?: string }): Attempt;
  ADDON_PATH: string;
  stashAddon(options?: { root?: string }): string | null;
  restoreAddon(
    stash: string | null,
    options?: { root?: string; log?: (message: string) => void },
  ): boolean;
  pinnedRuntimeNote(input?: { nvmrc?: string | null; nodeVersion?: string }): string | null;
  pinnedNodeVersion(options?: { root?: string }): string | null;
}

let script: Module;

beforeAll(async () => {
  script = (await import(pathToFileURL(SCRIPT).href)) as unknown as Module;
});

/** A run that loaded the addon. */
const loads = (): Attempt => ({ loads: true });

/** A run that failed on a foreign NODE_MODULE_VERSION. */
const foreignAbi = (): Attempt => ({
  loads: false,
  abiMismatch: true,
  message: "was compiled against a different Node.js version using NODE_MODULE_VERSION",
});

describe("decideAbi", () => {
  test("a module that loads under host Node is the host's ABI", () => {
    expect(script.decideAbi({ host: loads(), electron: loads() })).toBe("host");
  });

  test("a module that only loads under Electron is Electron's ABI", () => {
    expect(script.decideAbi({ host: foreignAbi(), electron: loads() })).toBe(
      "electron",
    );
  });

  test("a module that loads under neither is broken, not Electron", () => {
    // The regression. One input could not tell these two apart, and reading a
    // third Node ABI as "electron" is what skipped the rebuild the tree needed.
    expect(script.decideAbi({ host: foreignAbi(), electron: foreignAbi() })).toBe(
      "broken",
    );
  });
});

describe("currentAbi", () => {
  test("a healthy host tree never pays for the Electron probe", () => {
    // Electron is given a failing attempt on purpose: if the host attempt is
    // consulted first, that answer is never reached, so a healthy tree costs
    // one spawn rather than two.
    expect(
      script.currentAbi({ host: loads(), electron: foreignAbi() }),
    ).toBe("host");
  });

  test("an Electron-only tree reads as Electron", () => {
    expect(
      script.currentAbi({ host: foreignAbi(), electron: loads() }),
    ).toBe("electron");
  });

  test("a tree that loads nowhere reads as broken", () => {
    expect(
      script.currentAbi({ host: foreignAbi(), electron: foreignAbi() }),
    ).toBe("broken");
  });
});

describe("abiNumberFor", () => {
  test("the host's ABI is this process's own NODE_MODULE_VERSION", () => {
    expect(script.abiNumberFor("host")).toBe(Number(process.versions.modules));
  });
});

describe("loadAttempt", () => {
  test("a runtime that cannot even be spawned is a failure, not a throw", () => {
    const attempt = script.loadAttempt({
      execPath: path.join(ROOT, "no-such-runtime"),
    });
    expect(attempt.loads).toBe(false);
    // A missing binary is not an ABI mismatch: the repair differs.
    expect(attempt.abiMismatch).toBe(false);
    expect(attempt.message).toBeTruthy();
  });
});

/** A tree with an addon in it, standing in for one a rebuild is about to clean. */
function treeWithAddon(contents = "the addon that was here first"): {
  root: string;
  addon: string;
} {
  const root = makeTmpDir("atr-native-abi");
  const addon = path.join(root, script.ADDON_PATH);
  fs.mkdirSync(path.dirname(addon), { recursive: true });
  fs.writeFileSync(addon, contents);
  return { root, addon };
}

describe("stashAddon / restoreAddon", () => {
  test("a rebuild that leaves no addon puts back the one it found", () => {
    const { root, addon } = treeWithAddon();
    try {
      const stash = script.stashAddon({ root });
      expect(stash).toBeTruthy();

      // What `node-gyp rebuild` does before it fails: the addon is gone.
      fs.rmSync(addon, { force: true });

      expect(script.restoreAddon(stash, { root, log: () => {} })).toBe(true);
      expect(fs.readFileSync(addon, "utf8")).toBe(
        "the addon that was here first",
      );
      // The stash is spent, not left beside the addon it restored.
      expect(fs.existsSync(stash as string)).toBe(false);
    } finally {
      cleanupTmp(root);
    }
  });

  test("nothing to keep, and nothing to restore, is not a crash", () => {
    const root = makeTmpDir("atr-native-abi-empty");
    try {
      expect(script.stashAddon({ root })).toBeNull();
      expect(script.restoreAddon(null, { root, log: () => {} })).toBe(false);
    } finally {
      cleanupTmp(root);
    }
  });
});

describe("pinnedRuntimeNote", () => {
  test("is silent when the running Node is the one the project pins", () => {
    expect(
      script.pinnedRuntimeNote({ nvmrc: "22", nodeVersion: "v22.22.3" }),
    ).toBeNull();
    expect(
      script.pinnedRuntimeNote({ nvmrc: "v22.22.3", nodeVersion: "v22.22.3" }),
    ).toBeNull();
  });

  test("names the runtime in use and the pin when they disagree", () => {
    const note = script.pinnedRuntimeNote({
      nvmrc: "22",
      nodeVersion: "v26.3.1",
    });
    expect(note).toContain("Node 26.3.1");
    expect(note).toContain("pins Node 22");
  });

  test("says nothing when there is no pin to compare against", () => {
    expect(script.pinnedRuntimeNote({ nvmrc: null })).toBeNull();
    expect(script.pinnedRuntimeNote({ nvmrc: "  " })).toBeNull();
  });
});

describe("pinnedNodeVersion", () => {
  test("reads the pin from .nvmrc", () => {
    const root = makeTmpDir("atr-nvmrc");
    try {
      fs.writeFileSync(path.join(root, ".nvmrc"), "22\n");
      expect(script.pinnedNodeVersion({ root })).toBe("22");
    } finally {
      cleanupTmp(root);
    }
  });

  test("a missing .nvmrc is null rather than a throw", () => {
    const root = makeTmpDir("atr-nvmrc-missing");
    try {
      expect(script.pinnedNodeVersion({ root })).toBeNull();
    } finally {
      cleanupTmp(root);
    }
  });
});
