#!/usr/bin/env node
/**
 * signing-identity.mjs — which certificate should sign this build?
 *
 * Prints the name of the Developer ID Application identity to sign with on
 * stdout, or a bare `-` when there is none (meaning: ad-hoc, the fallback
 * in `electron-builder.yml`). Exit status is 0 in both cases unless
 * `--require` is passed, so a caller that must have a certificate can say so
 * and get a failure instead of a silent downgrade.
 *
 * ## Why this is a script and not two lines of `sed`
 *
 * The answer is needed twice — once on a laptop building a signed DMG, once
 * in CI after importing `CSC_LINK` into a temporary keychain — and a release
 * that signs with a *different* certificate than it thinks it did is a
 * problem nobody sees until an update refuses to install. So the keychain
 * query, the parsing and the choice between multiple identities live here,
 * where `tests/unit/scripts/signing-identity.spec.ts` can drive them.
 *
 * ## What it refuses to pick
 *
 * `security find-identity -v -p codesigning` lists every signing identity in
 * the keychain, and on a developer machine that includes "Apple Development"
 * certificates, which the Xcode toolchain makes on demand. Those sign a
 * build that runs locally and cannot be notarised. Only
 * `Developer ID Application` is accepted here — the type Apple issues for
 * distribution outside the App Store.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The certificate type that can be notarised and shipped.
 *
 * Both older spellings of the same thing are accepted because Apple renamed
 * it twice: `Developer ID Application` is current, and a keychain carried
 * across an OS upgrade can still present the 5.x name.
 */
export const DEVELOPER_ID_PREFIXES = Object.freeze([
  "Developer ID Application:",
  "Developer ID Application ",
]);

/** The ad-hoc fallback, as `mac.identity` spells it. */
export const AD_HOC = "-";

/**
 * Parse `security find-identity -v -p codesigning` output.
 *
 * Lines look like:
 *
 *     1) 5A1B… "Developer ID Application: John Smith (ABCDE12345)"
 *        1 valid identities found
 *
 * The trailing count line and `0 valid identities found` are both ignored —
 * a keychain with no identities is the ordinary state of a machine without
 * an Apple Developer membership, not a parse failure.
 */
export function parseIdentities(text) {
  const identities = [];
  for (const line of String(text ?? "").split("\n")) {
    const match = /^\s*\d+\)\s+([0-9A-Fa-f]+)\s+"(.+)"\s*$/.exec(line);
    if (!match) continue;
    identities.push({ hash: match[1], name: match[2] });
  }
  return identities;
}

/** The first Developer ID Application identity, or null. */
export function pickDeveloperId(identities) {
  for (const identity of identities) {
    if (
      DEVELOPER_ID_PREFIXES.some((prefix) => identity.name.startsWith(prefix))
    ) {
      return identity;
    }
  }
  return null;
}

/** `security find-identity -v -p codesigning [keychain]`, both streams. */
function defaultRun(keychain) {
  const args = ["find-identity", "-v", "-p", "codesigning"];
  if (keychain) args.push(keychain);
  const result = spawnSync("security", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

/**
 * Resolve the identity to sign with.
 *
 * `keychain` is passed through to `security` so CI can point at the temporary
 * keychain it imported `CSC_LINK` into; `security` reads the default search
 * list when it is absent, which is what a laptop wants.
 */
export function resolveIdentity({ keychain = null, run = null } = {}) {
  const output = (run ?? (() => defaultRun(keychain)))();
  const identities = parseIdentities(output);
  return {
    identity: pickDeveloperId(identities),
    identities,
    output,
  };
}

/** `--keychain <path>`, `--require`. */
export function parseArgs(args) {
  let keychain = null;
  let require = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--keychain") {
      keychain = args[index + 1] ?? null;
      index += 1;
    } else if (arg === "--require") {
      require = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag ${arg}`);
    }
  }
  return { keychain, require };
}

/** True when this file is the program Node was asked to run. */
function isMainModule() {
  if (typeof process.argv[1] !== "string") return false;
  try {
    return (
      fs.realpathSync(fileURLToPath(import.meta.url)) ===
      fs.realpathSync(process.argv[1])
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    const { keychain, require } = parseArgs(process.argv.slice(2));
    const { identity, identities } = resolveIdentity({ keychain });

    if (!identity) {
      // stderr, so `$(node scripts/signing-identity.mjs)` still collects a
      // clean `-` on stdout.
      console.error(
        `[signing-identity] no Developer ID Application certificate in the ` +
          `${keychain ? `${keychain} ` : ""}keychain ` +
          `(${identities.length} signing ${identities.length === 1 ? "identity" : "identities"} found). ` +
          `A membership is required to sign and notarise — see docs/RELEASING.md.`,
      );
      if (require) process.exit(1);
      console.log(AD_HOC);
      process.exit(0);
    }

    console.log(identity.name);
    process.exit(0);
  } catch (thrown) {
    console.error(`[signing-identity] ${thrown?.message ?? thrown}`);
    process.exit(3);
  }
}
