#!/usr/bin/env node
/**
 * notarize.mjs — the `afterSign` hook: hand the signed .app to Apple's
 * notary service, and staple the ticket it returns to the bundle.
 *
 * ## Why this is not `mac.notarize: true`
 *
 * electron-builder can notarise a build itself. This hook exists instead
 * because the interesting part is not the call to `notarytool` — it is the
 * *decision* around it, and that decision has to be legible and testable:
 *
 *   - On a machine with no Apple Developer certificate, notarising is not a
 *     failure to be retried, it is a step that does not apply. The build is
 *     ad-hoc signed, Apple would refuse it, and the release still has to
 *     happen — that is the whole reason a certificate-less build is allowed
 *     to ship at all (with a warning, and without offering an install the
 *     app could never complete).
 *   - Half-configured credentials are never that. One secret set out of
 *     three is a mistake, and it fails here rather than at Apple.
 *   - A tag push is allowed to *demand* notarisation (`ATR_NOTARIZE=require`),
 *     so a release whose credentials have quietly gone missing cannot
 *     publish something that looks installable and is not.
 *
 * So the decision is a pure function (`decideNotarization`) over facts
 * (`signatureKind`, `notaryCredentials`, `notarizeMode`), and
 * `tests/unit/scripts/notarize.spec.ts` drives every branch of it without a
 * certificate, a network, or a build.
 *
 * ## The three credential strategies
 *
 * An App Store Connect API key is preferred over an Apple ID when both are
 * present: an app-specific password has to be regenerated whenever the
 * Apple ID's password changes, and a leaked one is a live credential until
 * somebody notices. A key is revocable on its own.
 *
 *   APPLE_API_KEY=/path/to/AuthKey_XXXXXXXXXX.p8
 *   APPLE_API_KEY_ID=XXXXXXXXXX
 *   APPLE_API_ISSUER=<uuid>          # Team keys only
 *
 *   APPLE_ID=you@example.com
 *   APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
 *   APPLE_TEAM_ID=XXXXXXXXXX
 *
 * ## Running it by hand
 *
 *   node scripts/notarize.mjs                       # decide, in dry run
 *   node scripts/notarize.mjs --app release/…/*.app # decide for one bundle
 *   node scripts/notarize.mjs --notarize            # actually submit it
 *
 * A dry run prints the decision and exits non-zero when the decision is to
 * fail, so the same script that guards a release can be asked "what would
 * you do?" before one.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where a `pnpm electron:dist` build puts the bundle this hook is handed. */
export const DEFAULT_APP = "release/mac-arm64/AllTheRepos.app";

/** `ATR_NOTARIZE` values. `auto` is what an unset variable means. */
export const NOTARIZE_MODES = Object.freeze(["auto", "require", "skip"]);

/** The App Store Connect API key, as `@electron/notarize` names these. */
export const API_KEY_VARS = Object.freeze([
  ["APPLE_API_KEY", "appleApiKey"],
  ["APPLE_API_KEY_ID", "appleApiKeyId"],
  ["APPLE_API_ISSUER", "appleApiIssuer"],
]);

/** An Apple ID plus an app-specific password. */
export const APPLE_ID_VARS = Object.freeze([
  ["APPLE_ID", "appleId"],
  ["APPLE_APP_SPECIFIC_PASSWORD", "appleIdPassword"],
  ["APPLE_TEAM_ID", "teamId"],
]);

/**
 * Read `ATR_NOTARIZE`.
 *
 * An unrecognised non-empty value throws rather than falling back to
 * `auto`: a typo in a release workflow (`ATR_NOTARIZE=ture`) would
 * otherwise silently downgrade a signed release to an unnotarised one,
 * which is precisely the failure this file exists to make impossible.
 */
export function notarizeMode(env = process.env) {
  const raw = (env.ATR_NOTARIZE ?? "").trim().toLowerCase();
  if (raw === "") return "auto";
  if (!NOTARIZE_MODES.includes(raw)) {
    throw new Error(
      `ATR_NOTARIZE=${raw} is not one of ${NOTARIZE_MODES.join(", ")}`,
    );
  }
  return raw;
}

/** Present, non-empty environment entries out of `[[VAR, field], …]`. */
function presentVars(env, vars) {
  return vars.filter(([name]) => (env[name] ?? "").trim() !== "");
}

/**
 * Work out which credential strategy the environment describes.
 *
 * Returns `{ mode, credentials, missing }`:
 *   - `mode` is `"api-key"`, `"apple-id"`, or `null` when neither strategy
 *     is configured at all.
 *   - `missing` names the variables of a *partly* configured strategy, so
 *     the caller can say which one is absent instead of "credentials are
 *     wrong". Empty means "either nothing is set, or a full set is".
 */
export function notaryCredentials(env = process.env) {
  const apiKey = presentVars(env, API_KEY_VARS);
  const appleId = presentVars(env, APPLE_ID_VARS);

  // A partial strategy is reported before a complete one is chosen: it is
  // always a misconfiguration, and it would otherwise be masked by the
  // other strategy happening to be complete.
  for (const [vars, present] of [
    [API_KEY_VARS, apiKey],
    [APPLE_ID_VARS, appleId],
  ]) {
    if (present.length > 0 && present.length < vars.length) {
      return {
        mode: null,
        credentials: null,
        missing: vars
          .filter(([name]) => (env[name] ?? "").trim() === "")
          .map(([name]) => name),
      };
    }
  }

  if (apiKey.length === API_KEY_VARS.length) {
    return {
      mode: "api-key",
      credentials: Object.fromEntries(
        API_KEY_VARS.map(([name, field]) => [field, env[name]]),
      ),
      missing: [],
    };
  }

  if (appleId.length === APPLE_ID_VARS.length) {
    return {
      mode: "apple-id",
      credentials: Object.fromEntries(
        APPLE_ID_VARS.map(([name, field]) => [field, env[name]]),
      ),
      missing: [],
    };
  }

  return { mode: null, credentials: null, missing: [] };
}

/**
 * Classify a bundle from `codesign -dvvv` output.
 *
 * `-dvvv` writes to stderr, which is why the caller captures both streams.
 * The three facts that matter are the signing authority, the ad-hoc flag,
 * and the absence of a signature entirely — a `--dir` build signed with
 * `identity: "-"` reports `Signature=adhoc`, an unsigned one says "code
 * object is not signed at all", and only a Developer ID build carries
 * `Authority=Developer ID Application: …`.
 */
export function signatureKind(codesignOutput) {
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
 * The whole decision, as a pure function of five facts.
 *
 * `action` is one of:
 *   - `"notarize"` — credentials are complete and the bundle is one Apple
 *     will accept.
 *   - `"skip"` — this step genuinely does not apply. Not an error.
 *   - `"fail"` — the build asked to be notarised and cannot be, or the
 *     credentials are half-set. Always an error.
 */
export function decideNotarization({
  platform,
  signature,
  credentials,
  mode,
} = {}) {
  if (platform !== "darwin") {
    return { action: "skip", reason: `${platform} is not a macOS build` };
  }

  const missing = credentials?.missing ?? [];
  if (missing.length > 0) {
    return {
      action: "fail",
      reason:
        `notarisation credentials are half-configured — ${missing.join(", ")} ` +
        `${missing.length === 1 ? "is" : "are"} unset while the rest of that ` +
        `strategy is set. Set all of them, or none.`,
    };
  }

  const signed = signature === "developer-id";
  const haveCredentials = Boolean(credentials?.mode);

  if (mode === "require") {
    if (!signed) {
      return {
        action: "fail",
        reason:
          `this build is ${signature}, not Developer-ID signed, so Apple would ` +
          `refuse to notarise it — and an unnotarised build is one macOS will ` +
          `not let update itself.`,
      };
    }
    if (!haveCredentials) {
      return {
        action: "fail",
        reason:
          "ATR_NOTARIZE=require but no credentials are set. Notarisation needs " +
          "either an App Store Connect API key (APPLE_API_KEY, " +
          "APPLE_API_KEY_ID[, APPLE_API_ISSUER]) or an Apple ID " +
          "(APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID) — see " +
          "docs/RELEASING.md.",
      };
    }
    return { action: "notarize", reason: `notarising with ${credentials.mode}` };
  }

  if (mode === "skip") {
    return { action: "skip", reason: "ATR_NOTARIZE=skip" };
  }

  // `auto` — the honest default for a laptop and for a rehearsal: notarise a
  // build that would pass and can be submitted, and say nothing is wrong
  // when there is nothing to do.
  if (!signed) {
    return {
      action: "skip",
      reason: `this build is ${signature}, not Developer-ID signed`,
    };
  }
  if (!haveCredentials) {
    return {
      action: "skip",
      reason: "Developer-ID signed, but no notarisation credentials are set",
    };
  }
  return { action: "notarize", reason: `notarising with ${credentials.mode}` };
}

/** `codesign -dvvv` output for a bundle. Both streams; `-dvvv` uses stderr. */
export function codesignDescription(appPath, run = defaultRun) {
  try {
    return run("codesign", ["-dvvv", appPath]);
  } catch (thrown) {
    // An unsigned bundle makes `codesign` exit non-zero and still describe
    // the bundle on stderr — that text *is* the answer, so keep it.
    return `${thrown?.stderr ?? ""}${thrown?.stdout ?? ""}`;
  }
}

/** `xcrun stapler validate <app>`. Exit 0 means a ticket is stapled. */
export function stapleValidate(appPath, run = defaultRun) {
  try {
    return { ok: true, output: run("xcrun", ["stapler", "validate", appPath]) };
  } catch (thrown) {
    return {
      ok: false,
      output: `${thrown?.stderr ?? ""}${thrown?.stdout ?? ""}`.trim(),
    };
  }
}

/**
 * Run a command, returning **stdout and stderr together**, and throwing with
 * both attached on a non-zero exit.
 *
 * `spawnSync` rather than `execFileSync` on purpose: `execFileSync` returns
 * stdout alone, and `codesign -dvvv` reports the signature — the whole
 * answer — on *stderr*. Reading only stdout classified every ad-hoc bundle
 * as `unknown`, which is a decision this file then acted on.
 */
function defaultRun(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    const thrown = new Error(
      `${command} ${args.join(" ")} exited ${result.status}`,
    );
    thrown.stdout = result.stdout ?? "";
    thrown.stderr = result.stderr ?? "";
    throw thrown;
  }
  return output;
}

/**
 * Notarise, then prove it happened.
 *
 * `@electron/notarize` staples on success, but its own word is not evidence
 * — a missing ticket is exactly the state that looks fine in a log and
 * fails on a stranger's machine. So the staple is validated independently,
 * and a bundle without one fails here.
 */
export async function notarizeApp({
  appPath,
  credentials,
  notarize,
  validate = stapleValidate,
  log = console.log,
}) {
  log(`[notarize] submitting ${path.basename(appPath)} to Apple (this takes minutes)`);
  await notarize({ appPath, ...credentials });
  log("[notarize] accepted — checking the stapled ticket");

  const stapled = validate(appPath);
  if (!stapled.ok) {
    throw new Error(
      `notarisation succeeded but no ticket is stapled to ${appPath}, so a ` +
        `downloaded copy would still be refused by Gatekeeper:\n${stapled.output}`,
    );
  }
  log("[notarize] ticket stapled and validated");
}

/**
 * electron-builder's `afterSign` hook.
 *
 * `deps` exists so the tests can drive this without a build, a certificate,
 * or a network — not as a general extension point.
 */
export default async function afterSign(context, deps = {}) {
  const {
    env = process.env,
    run = defaultRun,
    notarize = async (options) => {
      const { notarize: notarytool } = await import("@electron/notarize");
      return notarytool(options);
    },
    validate = stapleValidate,
    log = console.log,
  } = deps;

  const platform = context?.electronPlatformName ?? process.platform;
  const appBundleId = context?.packager?.appInfo?.id ?? "com.alltherepos.desktop";
  const appName = context?.packager?.appInfo?.productFilename ?? "AllTheRepos";
  const appPath =
    deps.appPath ??
    (context?.appOutDir
      ? path.join(context.appOutDir, `${appName}.app`)
      : path.join(ROOT, DEFAULT_APP));

  const decision = decideNotarization({
    platform,
    signature:
      deps.signature ?? signatureKind(codesignDescription(appPath, run)),
    credentials: notaryCredentials(env),
    mode: notarizeMode(env),
  });

  if (decision.action === "skip") {
    log(`[notarize] skipped — ${decision.reason}`);
    return;
  }
  if (decision.action === "fail") {
    // Thrown, not logged: this runs inside electron-builder, where a
    // thrown error is what fails the build.
    throw new Error(`[notarize] refusing to continue — ${decision.reason}`);
  }

  log(`[notarize] ${decision.reason}`);
  await notarizeApp({
    appPath,
    appBundleId,
    credentials: notaryCredentials(env).credentials,
    notarize,
    validate,
    log,
  });
}

/** `--app <path>`, `--notarize`, `--require`. */
export function parseArgs(args) {
  let appPath = null;
  let submit = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--app") {
      appPath = args[index + 1] ?? null;
      index += 1;
    } else if (arg === "--notarize") {
      submit = true;
    } else if (arg === "--require") {
      process.env.ATR_NOTARIZE = "require";
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag ${arg}`);
    }
  }
  return { appPath, submit };
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
  const { appPath, submit } = parseArgs(process.argv.slice(2));
  const target = appPath ?? path.join(ROOT, DEFAULT_APP);

  try {
    if (!fs.existsSync(target)) {
      console.error(`[notarize] no bundle at ${target}`);
      process.exit(3);
    }

    const mode = notarizeMode();
    const credentials = notaryCredentials();
    const signature = signatureKind(codesignDescription(target));
    const decision = decideNotarization({
      platform: process.platform,
      signature,
      credentials,
      mode,
    });

    const stapled = stapleValidate(target);
    // `stapler validate` opens with "Processing: <path>" whatever the
    // outcome, so the useful line is its last one — "… does not have a
    // ticket stapled to it" is the answer, not the preamble.
    const verdict =
      stapled.output.split("\n").map((line) => line.trim()).filter(Boolean).pop() ??
      "";
    console.log(`[notarize] bundle       ${target}`);
    console.log(`[notarize] signature    ${signature}`);
    console.log(`[notarize] credentials  ${credentials.mode ?? "none"}`);
    console.log(`[notarize] mode         ${mode}`);
    console.log(
      `[notarize] stapled      ${stapled.ok ? "yes" : `no — ${verdict}`}`,
    );
    console.log(`[notarize] decision     ${decision.action} — ${decision.reason}`);

    if (decision.action === "fail") process.exit(1);
    if (!submit) {
      if (decision.action === "notarize") {
        console.log("[notarize] dry run — pass --notarize to submit");
      }
      process.exit(0);
    }
    if (decision.action === "skip") process.exit(0);

    await notarizeApp({
      appPath: target,
      credentials: credentials.credentials,
      notarize: async (options) => {
        const { notarize } = await import("@electron/notarize");
        return notarize(options);
      },
      validate: stapleValidate,
    });
    process.exit(0);
  } catch (thrown) {
    console.error(`[notarize] ${thrown?.message ?? thrown}`);
    process.exit(1);
  }
}
