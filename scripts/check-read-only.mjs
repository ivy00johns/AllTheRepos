#!/usr/bin/env node
/**
 * This app reads your repositories. It does not rearrange them.
 *
 * That promise has been broken once, by accident: a folder-management feature
 * landed that could rename a directory on disk, preflighted and journaled and
 * good-intentioned, and every one of those safeguards was still a write nobody
 * asked for. The lesson is not "be careful". It is that a guarantee about what
 * a program cannot do has to be enforced by something that runs on every change,
 * because the person who adds the next `fs.rm` will be doing something that
 * looked reasonable at the time.
 *
 * So this reads the main and preload halves of the app and fails on:
 *
 *   - a destructive call, anywhere, with no exemptions at all — `rm`, `rmdir`,
 *     `unlink`, `truncate`, `trashItem`, or the same verbs handed to a shell
 *     through `execFile`/`spawn` (`rm`, `mv`, `cp`, `rsync`, `shred`, …);
 *   - a write — `writeFile`, `mkdir`, `rename`, `copyFile`, `cp`, `chmod`,
 *     `symlink`, `createWriteStream` — outside a short list of files, each
 *     named below with the reason it is allowed. A new file that writes anything
 *     fails until somebody adds it here deliberately, which is the point: the
 *     permission is the diff, not the memory of the person reviewing it.
 *
 * Copy is on the write list rather than the destructive one, because copying is
 * how a file is quietly replaced. The one place it is allowed is the migration
 * that carries the app's own data out of `~/.alltherepos/`, and it may never be
 * paired with a delete — deletes are refused outright, so a copy-then-delete is
 * unrepresentable rather than merely discouraged.
 *
 * What is deliberately not read: comments (the reasoning above belongs in the
 * source), and anything outside the process that runs without a sandbox. The
 * renderer cannot touch a disk in a packaged build and does not import `node:fs`
 * at all; the tests write temp files on purpose and are not shipped.
 *
 * Usage:
 *   node scripts/check-read-only.mjs
 *
 * Exit codes: 0 — nothing in the main or preload process deletes, moves, renames
 * or copies anything outside the app's own data directory · 1 — something does,
 * and each call is named with its file, line and the rule it broke · 2 — there
 * was nothing to check (no `src/main`), which is reported rather than passed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The halves that run with a real filesystem and no sandbox. */
export const READ_ONLY_DIRS = [path.join("src", "main"), path.join("src", "preload")];

const SKIPPED_DIRS = new Set(["node_modules", "dist", "out"]);

/**
 * Calls that can destroy data. Nothing may use one, in any file, ever.
 *
 * `rename` is not here and is not harmless — it is on the write list, because
 * the only renames this app makes are of its own files inside its own data
 * directory (an atomic settings write), and a rename of somebody's repository
 * arrives through the same call.
 */
export const DESTRUCTIVE_CALLS = new Set([
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "unlink",
  "unlinkSync",
  "truncate",
  "truncateSync",
  "trashItem",
]);

/** Calls that change something on disk. Only the waivers below may use them. */
export const WRITE_CALLS = new Set([
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "mkdir",
  "mkdirSync",
  "mkdtemp",
  "mkdtempSync",
  "rename",
  "renameSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "chmod",
  "chmodSync",
  "utimes",
  "utimesSync",
  "symlink",
  "symlinkSync",
  "link",
  "linkSync",
  "createWriteStream",
]);

/** Programs that destroy or relocate data, when handed to a shell. */
export const SHELL_WRITERS = new Set([
  "rm",
  "rmdir",
  "mv",
  "cp",
  "rsync",
  "trash",
  "rimraf",
  "shred",
  "srm",
]);

/** The calls that take a command to run. */
const SHELL_CALLS = new Set([
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "spawn",
  "spawnSync",
]);

/**
 * The only files allowed to write, and exactly what each one may call.
 *
 * Every entry is inside the app's own data directory
 * (`~/Library/Application Support/alltherepos`). None of them can name a path
 * outside it: the paths come from `app.getPath("userData")` and from the
 * migration's fixed legacy location, not from a repository.
 */
export const WRITE_WAIVERS = {
  [path.join("src", "main", "db", "client.ts")]: {
    calls: ["mkdirSync"],
    why: "creates the app's own data directory before SQLite opens a file inside it",
  },
  [path.join("src", "main", "db", "migration.ts")]: {
    calls: ["mkdirSync", "copyFileSync", "cpSync", "writeFileSync"],
    why: "one-time copy of the app's own data out of the legacy ~/.alltherepos directory",
  },
  [path.join("src", "main", "services", "settings.ts")]: {
    calls: ["mkdirSync", "writeFileSync", "renameSync"],
    why: "settings.json, written atomically inside the app's data directory",
  },
  [path.join("src", "main", "services", "notes.ts")]: {
    calls: ["mkdirSync", "writeFileSync", "renameSync"],
    why: "a repository's note, written atomically inside the app's own data directory — never inside a repository",
  },
  [path.join("src", "main", "window", "window-memory.ts")]: {
    calls: ["mkdirSync", "writeFileSync", "renameSync"],
    why: "window placement, written atomically inside the app's data directory",
  },
};

/** The file name a call site is judged by, relative to the repository root. */
export function relativeFile(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

/**
 * The filesystem names one file has in scope, and the shell names it has.
 *
 * Judging a call by its verb alone is not enough, and this repository proves it:
 * `services/embedding.ts` calls a local `truncate(text)` that clips a string for
 * the embeddings API. A gate that reads that as `fs.truncate` fails on correct
 * code, and a gate that fails on correct code gets switched off — which is the
 * one outcome worse than no gate. So a call is only judged when its receiver is
 * a name bound to `node:fs` (or `node:fs/promises`), or when a bare name is one
 * of those module's own exports.
 */
function bindings(sourceFile) {
  const fsRefs = new Set();
  const shellRefs = new Set();

  const FS_MODULES = new Set(["node:fs", "node:fs/promises", "fs", "fs/promises"]);
  const SHELL_MODULES = new Set(["node:child_process", "child_process"]);

  const addClause = (clause, spec, into) => {
    if (!clause) return;
    if (clause.name) into.add(clause.name.text);
    const named = clause.namedBindings;
    if (!named) return;
    if (ts.isNamespaceImport(named)) {
      into.add(named.name.text);
      return;
    }
    for (const element of named.elements) {
      into.add((element.propertyName ?? element.name).text);
    }
    void spec;
  };

  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const spec = node.moduleSpecifier.text;
      if (FS_MODULES.has(spec)) addClause(node.importClause, spec, fsRefs);
      if (SHELL_MODULES.has(spec)) addClause(node.importClause, spec, shellRefs);
    }

    // `const execFileP = promisify(execFile)` — how this codebase runs a command
    // without `exec`'s string interpolation. The alias is a shell call site.
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(sourceFile) === "promisify"
    ) {
      const target = node.initializer.arguments[0]?.getText(sourceFile) ?? "";
      if (SHELL_CALLS.has(target) && ts.isIdentifier(node.name)) {
        shellRefs.add(node.name.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return { fsRefs, shellRefs };
}

/**
 * Every call in one file, with the line it sits on and what it was reached
 * through, so the judge below can tell `db.truncate()` from `fs.truncate()`.
 */
export function callsIn(text, fileName = "file.ts") {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const { fsRefs, shellRefs } = bindings(sourceFile);
  const found = [];

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      let receiver = null;
      let verb = null;

      if (ts.isIdentifier(expression)) {
        verb = expression.text;
      } else if (ts.isPropertyAccessExpression(expression)) {
        receiver = expression.expression.getText(sourceFile);
        verb = expression.name.text;
      } else if (
        ts.isElementAccessExpression(expression) &&
        expression.argumentExpression &&
        ts.isStringLiteral(expression.argumentExpression)
      ) {
        receiver = expression.expression.getText(sourceFile);
        verb = expression.argumentExpression.text;
      }

      if (verb) {
        // `fs.promises.rm` and `fsp.rm` are both the filesystem: the head of a
        // dotted receiver is the binding, the tail is just how it was reached.
        const head = receiver ? receiver.split(".")[0] : null;
        const onFs =
          verb === "trashItem" ||
          (receiver ? fsRefs.has(head) : fsRefs.has(verb));
        const onShell = receiver ? shellRefs.has(head) : shellRefs.has(verb);

        found.push({
          verb,
          receiver,
          onFs,
          onShell,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1,
          text: node.getText(sourceFile),
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return found;
}

/** Judge one file's calls. Returns the findings, each with its rule. */
export function judgeFile(file, text, waivers = WRITE_WAIVERS) {
  const findings = [];
  const waiver = waivers[file];

  for (const call of callsIn(text, file)) {
    if (call.onFs && DESTRUCTIVE_CALLS.has(call.verb)) {
      findings.push({
        file,
        line: call.line,
        call: call.receiver ? `${call.receiver}.${call.verb}` : call.verb,
        rule: "destructive",
        why: "this app has no delete. Nothing it does to your code is irreversible, so nothing here may be.",
      });
      continue;
    }

    if (call.onShell) {
      for (const word of SHELL_WRITERS) {
        // A literal command word, not a substring of a path: `"rm"` in an argv
        // array, or `rm ` inside a shell string.
        const asArgv = new RegExp(`["'\`]${word}["'\`]`);
        const asScript = new RegExp(`(^|[\\s;&|])${word}(\\s|$)`);
        if (asArgv.test(call.text) || asScript.test(call.text)) {
          findings.push({
            file,
            line: call.line,
            call: `${call.verb}(…${word}…)`,
            rule: "shell",
            why: `shelling out to \`${word}\` is the same delete with a longer path to it.`,
          });
          break;
        }
      }
      continue;
    }

    if (!call.onFs || !WRITE_CALLS.has(call.verb)) continue;

    if (waiver && waiver.calls.includes(call.verb)) continue;

    findings.push({
      file,
      line: call.line,
      call: call.receiver ? `${call.receiver}.${call.verb}` : call.verb,
      rule: waiver ? "unwaived" : "write",
      why: waiver
        ? `${file} is allowed to write, but not with \`${call.verb}\` — its waiver covers ${waiver.calls.join(", ")}.`
        : `${file} has no write waiver. The app reads your repositories; a new writer needs to be named in WRITE_WAIVERS with a reason.`,
    });
  }

  return findings;
}

/** Every `.ts` file under a directory, excluding the ones that never ship. */
function sourceFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        out.push(full);
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

/**
 * Read every main-process file and report what it does to a disk.
 *
 * Returns what it walked as well as what it found, because a gate that passes
 * by reading nothing passes for the wrong reason.
 */
export function auditReadOnly(root = ROOT, dirs = READ_ONLY_DIRS, waivers = WRITE_WAIVERS) {
  const findings = [];
  let filesRead = 0;
  let callsSeen = 0;

  for (const dir of dirs) {
    for (const file of sourceFiles(path.join(root, dir))) {
      const relative = relativeFile(root, file);
      const text = fs.readFileSync(file, "utf8");
      filesRead += 1;
      callsSeen += callsIn(text, relative).length;
      findings.push(...judgeFile(relative, text, waivers));
    }
  }

  return { findings, filesRead, callsSeen };
}

/** The verdict for a run, so the CLI and the suite read the same shape. */
export function assess({ findings, filesRead, callsSeen }) {
  if (filesRead === 0) {
    return {
      ok: false,
      code: 2,
      lines: [
        "read-only check: nothing was read — `src/main` is missing or empty, so this gate proved nothing.",
      ],
    };
  }

  if (findings.length === 0) {
    return {
      ok: true,
      code: 0,
      lines: [
        `read-only check: ${filesRead} file${filesRead === 1 ? "" : "s"} in the main and preload process, ` +
          `${callsSeen} calls, no delete, no move, no copy outside the app's own data directory.`,
      ],
    };
  }

  const lines = [
    `read-only check: ${findings.length} call${findings.length === 1 ? "" : "s"} that can change your filesystem.`,
    "",
  ];
  for (const finding of findings) {
    lines.push(`  ${finding.file}:${finding.line}  ${finding.call}`);
    lines.push(`    ${finding.rule}: ${finding.why}`);
    lines.push("");
  }
  lines.push(
    "This app read-only by design: no moving, no copying, no deleting, no file",
  );
  lines.push(
    "management. Remove the call, or — if it truly belongs in the app's own data",
  );
  lines.push(
    "directory — add the file to WRITE_WAIVERS in scripts/check-read-only.mjs with",
  );
  lines.push("the reason it is allowed.");
  return { ok: false, code: 1, lines };
}

export function run({
  root = ROOT,
  dirs = READ_ONLY_DIRS,
  waivers = WRITE_WAIVERS,
  log = console.log,
} = {}) {
  const verdict = assess(auditReadOnly(root, dirs, waivers));
  for (const line of verdict.lines) log(line);
  return verdict.code;
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  process.exitCode = run();
}
