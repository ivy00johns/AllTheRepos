#!/usr/bin/env node
/**
 * Every architecture we ship has to have a binary for every native module we
 * ship — and nothing was connecting the two.
 *
 * "macOS on Apple silicon" is a fact about `electron-builder.yml`, not about
 * this app's code. `src/main` is already portable: the dock badge and vibrancy
 * no-op off darwin, the tray picks a Windows position, `cmd.exe` is named for
 * win32, the launcher probes `/Applications` and `~/Applications`, and
 * `src/main/services/signing.ts` returns an explicit non-installable verdict off
 * darwin. So the question *"can we ship an Intel Mac, or Windows?"* is answered
 * almost entirely by whether the native modules have a binary for the target.
 *
 * That makes a native module's platform matrix a property of every release, and
 * a change in it a change in what the product does on a machine somebody owns —
 * which is why this check reads the matrix out of the installed packages rather
 * than trusting a note like this one. Three dependencies, three shapes:
 *
 *   - `better-sqlite3` and `find-git-repositories` ship C++ sources and a
 *     `binding.gyp`, and `npmRebuild` in `electron-builder.yml` compiles them for
 *     whatever architecture is being packaged. They cover anything the toolchain
 *     covers — including an Intel Mac, which matters because
 *     `find-git-repositories` publishes no darwin-x64 prebuild of its own.
 *   - `sqlite-vec` ships **prebuilt** binaries, one npm package per target —
 *     `sqlite-vec-darwin-arm64`, `-darwin-x64`, `-linux-x64`, `-linux-arm64`,
 *     `-windows-x64` — and the vector table it serves lives in the app's own
 *     SQLite file: one `vec0.dylib` beside a database, rather than a second
 *     engine beside it.
 *   - a package with no native code at all has nothing to check, and is
 *     classified as such rather than skipped by name.
 *
 * The failure a miss in that matrix produces is the quiet kind. Adding `x64` to
 * the `dmg` and `zip` targets is a two-line change, and the resulting Intel DMG
 * would **package fine**. It would also launch, because the vector store fails
 * soft on purpose — `vectorSearch()` returns `[]`,
 * `getEmbeddingContentHash()` returns `null`, `indexRepoEmbedding()` swallows an
 * upsert failure and the scan keeps its FTS index. So every gate would be green
 * and the only symptom would be a feature that stopped existing: semantic
 * search, silently, on one architecture. A green build cannot report that. This
 * can — and it did. Until 2026-10-07 the vector store was
 * `@lancedb/lancedb`, whose last Intel-Mac build was `0.22.3` against the `0.27.2`
 * this app ran; the finding below is what that looked like as a fact about the
 * product rather than a footnote on a registry page, and it is why the
 * dependency was replaced with one whose matrix covers every architecture the
 * toolchain can package.
 *
 * What it deliberately does not do is guess. It reads the installed tarball's own
 * metadata — `napi.targets` for napi-rs packages, the platform-named optional
 * dependencies, `prebuilds/`, `binding.gyp` — so a dependency whose shape it has
 * not seen before is still classified by what that dependency says about itself.
 * The limit of that is worth knowing: metadata describes what a release
 * *declares*, and a declaration is not a publication. Upstream,
 * `@lancedb/lancedb@0.23.0` declared a `darwin-x64` package that was never
 * published, which is why the honest floor for that dependency was `0.22.3` and
 * not `0.23.0` — and why a green run here is a tripwire worth having rather than
 * a substitute for looking at what a release actually ships.
 *
 * Usage:
 *   node scripts/check-platforms.mjs
 *
 * Exit codes: 0 — every declared target is covered · 1 — one is not, and each
 * blocker is named · 2 — there was nothing to check (no manifest, no builder
 * config, no `node_modules`, no `arch:` anywhere in it).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where the shipped dependencies are listed. */
export const MANIFEST = "package.json";

/** Where the architectures we actually build are declared. */
export const BUILDER_CONFIG = "electron-builder.yml";

/**
 * The electron-builder target blocks that name a platform, and the Node platform
 * id each one packages for. `dmg:` and `publish:` are configuration *about* mac,
 * not platform blocks, so they are not here — and because only these three names
 * open a section, nothing nested inside them can be mistaken for one.
 */
export const TARGET_BLOCKS = { mac: "darwin", win: "win32", linux: "linux" };

/**
 * Architectures the app does not build today, kept on the list so the answer to
 * *"will we be able to expand?"* is printed on every run instead of being
 * re-derived from the registry by hand.
 */
export const CANDIDATES = ["darwin-x64", "win32-x64", "linux-x64"];

/**
 * Targets where a missing binary has been *decided* to be acceptable, with what
 * the person downloading that build loses.
 *
 * Empty, and it should stay empty until somebody makes that call: an entry here
 * turns a failure into a line that is printed on every run. The shape is
 * `{ target: "<platform>-<arch>", cost: "<module> — <what a person on that
 * architecture loses>" }`, and it exists so that shipping a degraded
 * architecture is a sentence somebody wrote, not an omission nobody noticed.
 */
export const ACCEPTED_DEGRADATIONS = [];

/**
 * Rust target triples as `napi.targets` spells them, mapped to the platform id
 * this check reasons in. The `musl`/`gnu` split is a libc question, not an
 * architecture one, so both spellings land on the same Linux id.
 */
export const RUST_TRIPLES = {
  "aarch64-apple-darwin": "darwin-arm64",
  "x86_64-apple-darwin": "darwin-x64",
  "x86_64-pc-windows-msvc": "win32-x64",
  "i686-pc-windows-msvc": "win32-ia32",
  "aarch64-pc-windows-msvc": "win32-arm64",
  "x86_64-unknown-linux-gnu": "linux-x64",
  "aarch64-unknown-linux-gnu": "linux-arm64",
  "x86_64-unknown-linux-musl": "linux-x64",
  "aarch64-unknown-linux-musl": "linux-arm64",
};

/**
 * A dependency whose name *is* a platform: `sqlite-vec-darwin-arm64`,
 * `@esbuild/linux-x64`. Anchored at the end so `-helper` or `-cli` suffixes do
 * not sneak in, and applied to the last path segment so both the scoped and
 * unscoped spellings work.
 *
 * Deliberately narrower than "any hyphenated name": a package called
 * `left-pad-win32-x64` would be a false positive, and there is no such thing.
 * The narrower pattern is also what caught the finding this script was written
 * for — a vector store whose declared platform matrix had no `darwin-x64` in it,
 * where trusting `napi.targets` alone would have called that Intel Mac covered
 * on the strength of a target whose package was never published.
 */
const PLATFORM_PACKAGE = /(?:^|-)(darwin|win32|linux|windows)-(x64|arm64|ia32)(?:-(?:gnu|musl|msvc))?$/;

/**
 * Platform spellings that mean `win32`.
 *
 * `sqlite-vec` publishes its Windows binary as `sqlite-vec-windows-x64` —
 * "windows", not "win32", the spelling Node uses for the platform id. A reader
 * that only knew the Node spelling would classify that package as pure
 * JavaScript, and then report a Windows target as covered without having looked
 * at the one native module in the bundle. Normalising here rather than widening
 * `PLATFORM_PACKAGE` to "any word" keeps `left-pad-win32-x64` a false positive.
 */
const PLATFORM_ALIASES = { windows: "win32" };

/** `prebuilds/darwin-x64+arm64/` — prebuildify's directory-per-target layout. */
const PREBUILD_DIR = /^(darwin|win32|linux)-(.+)$/;

/** The architectures a directory name may name, one or more of them. */
const PREBUILD_ARCH = /^(x64|arm64|ia32)$/;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The architectures a `prebuilds/` directory ships, best-effort. */
function prebuildPlatforms(dir) {
  try {
    return fs
      .readdirSync(path.join(dir, "prebuilds"))
      .flatMap((entry) => {
        const match = PREBUILD_DIR.exec(entry);
        if (!match) return [];
        // `darwin-x64+arm64` is one directory holding a fat binary for both, so
        // the architectures are the `+`-separated tail, not just the first.
        return match[2]
          .split("+")
          .map((arch) => arch.trim())
          .filter((arch) => PREBUILD_ARCH.test(arch))
          .map((arch) => `${match[1]}-${arch}`);
      });
  } catch {
    return [];
  }
}

/**
 * What `package.json` (and the directory beside it) says about one dependency.
 *
 * Pure except for the optional directory read, so the three shapes that matter —
 * a napi-rs package with a platform matrix, a package that compiles from source,
 * and a package with no native code at all — are unit-tested against fixtures
 * rather than against whichever tarball happens to be installed.
 *
 * `platforms` is `null` when the answer is "every platform the toolchain can
 * target", which is what a `binding.gyp` means and what a pure-JS package means.
 *
 * @returns {{name: string, version: string, kind: "prebuilt"|"source"|"pure",
 *            platforms: Set<string>|null, declared: string[], evidence: string}}
 */
export function classify({ manifest = {}, dir = null } = {}) {
  const name = typeof manifest.name === "string" ? manifest.name : "(unnamed)";
  const version = typeof manifest.version === "string" ? manifest.version : "0.0.0";

  const declared = new Set();
  const evidence = [];

  const triples = Array.isArray(manifest.napi?.targets) ? manifest.napi.targets : [];
  const fromTriples = triples.map((triple) => RUST_TRIPLES[triple]).filter(Boolean);
  for (const platform of fromTriples) declared.add(platform);
  if (fromTriples.length > 0) {
    evidence.push(`napi.targets (${triples.length} triple(s))`);
  }

  const packageNames = Object.keys(manifest.optionalDependencies ?? {});
  const fromPackages = packageNames
    .map((dependency) => PLATFORM_PACKAGE.exec(dependency.split("/").at(-1)))
    .filter(Boolean)
    // Normalised through the capture groups rather than the whole match, so a
    // dependency published as both `…-linux-x64-gnu` and `…-linux-x64-musl` is
    // one architecture with two libc spellings rather than two architectures.
    .map(
      (match) => `${PLATFORM_ALIASES[match[1]] ?? match[1]}-${match[2]}`,
    );
  for (const platform of fromPackages) declared.add(platform);
  if (fromPackages.length > 0) {
    evidence.push(`${fromPackages.length} platform package(s)`);
  }

  if (dir) {
    const fromPrebuilds = prebuildPlatforms(dir);
    for (const platform of fromPrebuilds) declared.add(platform);
    if (fromPrebuilds.length > 0) evidence.push(`prebuilds/ (${fromPrebuilds.length})`);
  }

  // A `binding.gyp` outranks everything above: the package can be *compiled* for
  // whatever is being packaged, and `npmRebuild` does exactly that. Both
  // `better-sqlite3` and `find-git-repositories` are this shape, and reading only
  // their bundled prebuild — `find-git-repositories` publishes one, for
  // darwin-arm64 — would have wrongly reported the Intel Mac as blocked on them.
  const compilesFromSource =
    manifest.gypfile === true || (dir !== null && fs.existsSync(path.join(dir, "binding.gyp")));

  if (compilesFromSource) {
    return {
      name,
      version,
      kind: "source",
      platforms: null,
      declared: [...declared].sort(),
      evidence: "ships C++ sources and a binding.gyp, compiled by npmRebuild for the target being packaged",
    };
  }

  if (declared.size === 0) {
    return { name, version, kind: "pure", platforms: null, declared: [], evidence: "no native code" };
  }

  return {
    name,
    version,
    kind: "prebuilt",
    platforms: declared,
    declared: [...declared].sort(),
    evidence: evidence.join(", "),
  };
}

/**
 * The dependency tree's own `package.json` files, classified.
 *
 * Only the direct dependencies are walked. A native module pulled in
 * transitively would be missed — and there is none today (`chokidar` 5 is the
 * only watcher dependency and it is pure JS; the `fsevents` glob still sitting in
 * `asarUnpack` matches nothing on this tree).
 */
export function nativeModules({ root = ROOT, dependencies = null } = {}) {
  const manifest = readJson(path.join(root, MANIFEST));
  if (!manifest) return null;

  const names = dependencies ?? Object.keys(manifest.dependencies ?? {});
  const modules = [];

  for (const name of names) {
    const dir = path.join(root, "node_modules", name);
    const dependency = readJson(path.join(dir, MANIFEST));
    const classified = classify({ manifest: dependency ?? { name }, dir });
    if (classified.kind !== "pure") modules.push(classified);
  }

  return modules;
}

/**
 * The architectures `electron-builder.yml` actually builds.
 *
 * A purpose-built read rather than a YAML parse: the file is authored here, the
 * shape is fixed (a `mac:`/`win:`/`linux:` block containing `- target:` entries
 * with an `arch:` list), and the alternative is a dependency this project does
 * not have. It is unit-tested against the real file, so an edit that moves the
 * architectures somewhere this does not look fails rather than passes quietly —
 * the one thing a hand-rolled reader must never do.
 *
 * `missingArch` collects blocks that declare targets without naming an
 * architecture. electron-builder would build the *host* arch for those, which is
 * a property of the machine, not of the repository, and this check cannot tell
 * you whether it is covered — so it says so instead of assuming.
 *
 * @returns {{targets: string[], missingArch: string[]}}
 */
export function declaredTargets(yaml, { blocks = TARGET_BLOCKS } = {}) {
  const targets = [];
  const missingArch = [];

  let section = null;
  let sectionHasTarget = false;
  let sectionHasArch = false;
  // The indent of an `arch:` that opened a *block* list, so the `- x64` lines
  // under it are read as its values. YAML lets the same list be written two
  // ways, and a reader that only understood `arch: [arm64]` would report a
  // two-architecture config as undeclared — the one thing this must not do.
  let archBlockIndent = null;

  const close = () => {
    if (section !== null && sectionHasTarget && !sectionHasArch) missingArch.push(section);
  };

  const indentOf = (line) => line.length - line.trimStart().length;

  const addArch = (value) => {
    const arch = value.trim().replace(/^["']|["']$/g, "");
    if (arch) targets.push(`${blocks[section]}-${arch}`);
  };

  for (const raw of String(yaml).split("\n")) {
    const line = raw.replace(/#.*$/, "");
    if (line.trim() === "") continue;

    if (archBlockIndent !== null) {
      const item = /^\s*-\s*(.+)$/.exec(line);
      if (item && indentOf(line) > archBlockIndent) {
        addArch(item[1]);
        continue;
      }
      archBlockIndent = null;
    }

    // A top-level block (`mac:`) opens a section; any other top-level key closes
    // the one we were in.
    const block = /^([A-Za-z_-]+):\s*$/.exec(line);
    if (block) {
      close();
      section = blocks[block[1]] ? block[1] : null;
      sectionHasTarget = false;
      sectionHasArch = false;
      continue;
    }
    if (/^\S/.test(line)) {
      close();
      section = null;
      continue;
    }

    if (section === null) continue;

    if (/^\s*arch\s*:/.test(line)) {
      sectionHasArch = true;
      const list = /\[([^\]]*)\]/.exec(line);
      if (list) {
        for (const value of list[1].split(",")) addArch(value);
      } else if (line.slice(line.indexOf(":") + 1).trim() === "") {
        archBlockIndent = indentOf(line);
      } else {
        addArch(line.slice(line.indexOf(":") + 1));
      }
      continue;
    }

    if (/^\s*-\s*target\s*:/.test(line)) sectionHasTarget = true;
  }

  close();

  return { targets: [...new Set(targets)], missingArch: [...new Set(missingArch)] };
}

/** Why `module` cannot be shipped for `target`, or null when it can. */
function blockerFor(module, target) {
  if (module.platforms === null) return null;
  if (module.platforms.has(target)) return null;

  return `${module.name}@${module.version} ships no ${target} binary (it declares ${
    module.declared.length > 0 ? module.declared.join(", ") : "no per-platform packages"
  })`;
}

/**
 * The verdict, as data.
 *
 * Pure, so both halves of it are testable without installing anything: a target
 * we *do* build must be covered, and the candidates we do not build yet are
 * reported either way. That second half is the point — the answer to "can we
 * expand?" should not require somebody to go read the npm registry again.
 *
 * @returns {{failures: string[], notes: string[], expansion: string[]}}
 */
export function assess({
  targets = [],
  missingArch = [],
  modules = [],
  candidates = CANDIDATES,
  degradations = ACCEPTED_DEGRADATIONS,
} = {}) {
  const failures = [];
  const notes = [];
  const expansion = [];

  for (const section of missingArch) {
    failures.push(
      `electron-builder.yml declares ${section} target(s) with no \`arch\` — the architectures are then whatever machine runs the build, which is not a property of this repository and not something this check can cover. Name them: \`arch: [arm64]\`.`,
    );
  }

  for (const target of targets) {
    const blockers = modules.map((m) => blockerFor(m, target)).filter(Boolean);

    if (blockers.length === 0) {
      notes.push(`${target} — ${modules.length} native module(s), a binary for each`);
      continue;
    }

    const reason = blockers.join("; ");
    const accepted = degradations.find((entry) => entry.target === target);

    // A degradation somebody wrote down stays a release decision, so it is
    // printed loudly on every run rather than kept in a note nobody reads.
    if (accepted) {
      notes.push(`${target} — DEGRADED, accepted on purpose: ${reason}. Cost: ${accepted.cost}`);
      continue;
    }

    failures.push(
      `${target} is declared in electron-builder.yml, but ${reason} — a build for it would package and launch and then do less than the other architectures, silently. Ship an architecture only when every native module has a binary for it, or record what is lost in ACCEPTED_DEGRADATIONS in this file and say so in the release notes.`,
    );
  }

  for (const candidate of candidates) {
    if (targets.includes(candidate)) continue;
    const blockers = modules.map((m) => blockerFor(m, candidate)).filter(Boolean);

    expansion.push(
      blockers.length === 0
        ? `${candidate} would build today — every native module has a binary for it`
        : `${candidate} would NOT build today — ${blockers.join("; ")}`,
    );
  }

  return { failures, notes, expansion };
}

/**
 * Check the architectures, and say what a person shipping one is told.
 *
 * @returns {number} the exit code for this process.
 */
export function run({
  root = ROOT,
  candidates = CANDIDATES,
  degradations = ACCEPTED_DEGRADATIONS,
  log = console.log,
  error = console.error,
} = {}) {
  const configPath = path.join(root, BUILDER_CONFIG);
  const modules = nativeModules({ root });

  if (!fs.existsSync(path.join(root, MANIFEST)) || modules === null) {
    error(`[check-platforms] could not run — no readable ${MANIFEST} at ${root}`);
    return 2;
  }
  if (!fs.existsSync(configPath)) {
    error(`[check-platforms] could not run — no ${BUILDER_CONFIG} at ${root}, so nothing declares a target`);
    return 2;
  }

  const { targets, missingArch } = declaredTargets(fs.readFileSync(configPath, "utf8"));

  if (targets.length === 0 && missingArch.length === 0) {
    error(
      `[check-platforms] could not run — ${BUILDER_CONFIG} declares no \`arch\` under a ${Object.keys(TARGET_BLOCKS).join("/")} target, so this check examined nothing`,
    );
    return 2;
  }

  const { failures, notes, expansion } = assess({ targets, missingArch, modules, candidates, degradations });

  for (const note of notes) log(`  · ${note}`);
  for (const line of expansion) log(`  · ${line}`);

  if (failures.length > 0) {
    for (const failure of failures) error(`  ✗ ${failure}`);
    error(
      `[check-platforms] FAILED — ${failures.length} architecture(s) have no binary for something inside the bundle`,
    );
    return 1;
  }

  const reachable = expansion.filter((line) => line.includes("would build today")).length;
  log(
    `[check-platforms] OK — ${targets.length} declared architecture(s) covered by ${modules.length} native module(s); ${reachable} of ${expansion.length} candidate(s) would build as they are`,
  );
  return 0;
}

/**
 * True when this file is the program Node was asked to run.
 *
 * Compared through `fs.realpathSync`, not as strings: on macOS `os.tmpdir()`
 * hands back `/var/folders/...` while the loader resolves it to `/private/var/...`,
 * and a string compare then quietly does nothing at all.
 */
function isMainModule() {
  if (typeof process.argv[1] !== "string") return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    process.exit(run());
  } catch (thrown) {
    console.error(`[check-platforms] ${thrown?.message ?? thrown}`);
    process.exit(2);
  }
}
