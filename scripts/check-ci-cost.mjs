#!/usr/bin/env node
/**
 * Every job that needs a Mac is a spending decision, and nothing was keeping
 * count of them.
 *
 * GitHub bills macOS runner minutes at **ten times** the Linux rate on a private
 * repository, so where a job runs is not a style question: the same suite costs
 * ten times as much on `macos-14` as on `ubuntu-latest`, and a second leg costs
 * that ten times again. The bill is a property of `.github/workflows/`, and until
 * this file existed nothing in the repository connected "what we agreed to spend"
 * to "what the workflows ask for" — which is how a two-leg Electron matrix came to
 * run on every push for a build nobody can download.
 *
 * So the macOS jobs are **declared** here, each with its runner, how often it
 * starts, and why it has to be a Mac at all. This check reads the workflows and
 * fails when the two disagree in either direction:
 *
 *   - a job that runs on a Mac and is not in the budget (a new one, added by
 *     somebody who never saw this file);
 *   - a budgeted job that has grown a second runner — a matrix entry, another
 *     leg — or that now starts on every push where it used to be asked for;
 *   - a runner label this repository does not allow, with the retired ones named
 *     so the reason is in the failure rather than in a commit message;
 *   - a budget entry whose job no longer exists, because an allowlist nobody
 *     prunes is an allowlist the next reader learns to skip.
 *
 * What it deliberately does not do is measure. It reads triggers and runners, so
 * it knows the *shape* of the spend and not its size: a job that gets slower, or
 * a step that adds ten minutes of work to a Linux job, is invisible to it. Those
 * are real costs and this is not a substitute for reading a run. It also does not
 * know GitHub's rates — the ten-times multiplier is GitHub's, not this file's —
 * and it cannot see the jobs inside a reusable workflow that lives outside this
 * repository. Every job in every workflow in this checkout is covered.
 *
 * Usage:
 *   node scripts/check-ci-cost.mjs
 *
 * Exit codes: 0 — every macOS job is one this repository declared · 1 — one is
 * not, or a declared one widened, and each is named · 2 — there was nothing to
 * check (no workflow directory, or no job this checker could read), which is
 * reported rather than passed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where the spend is actually declared. */
export const WORKFLOW_DIR = path.join(".github", "workflows");

/**
 * Every job this repository lets run on a Mac, and why.
 *
 * `when` is the cheapest honest description of how often it starts: `push` means
 * an ordinary push or pull request, `tag` means a `v*` tag (or the weekly
 * rehearsal that exercises the same path), and `dispatch` means somebody asked
 * for it. `legs` is how many macOS runners one run can start; it is 1 everywhere
 * today, and a second leg is a doubling of that job's bill, so it has to be
 * written down rather than added.
 */
export const MACOS_BUDGET = [
  {
    workflow: "ci.yml",
    job: "e2e",
    runner: "macos-14",
    when: "push",
    legs: 1,
    why: "The Electron suite launches the packaged app and drives a real window. The bundle is arm64 and nothing else is released, so a Linux runner would test a product nobody ships.",
  },
  {
    workflow: "ci.yml",
    job: "refusal",
    runner: "macos-14",
    when: "push",
    legs: 1,
    why: "The packaged update check launches two real bundles against a mock that refuses every GitHub read. Skipping the bundles is not an option — the job fails unless the tests stopped for that reason — so it packages the app, which is a macOS build.",
  },
  {
    workflow: "ci.yml",
    job: "drill",
    runner: "macos-14",
    when: "dispatch",
    legs: 1,
    why: "Proves the refusal check can still fail, by running it against a mock that refuses nothing. `gh workflow run ci.yml` starts it, so it costs nothing repeated.",
  },
  {
    workflow: "release.yml",
    job: "release",
    runner: "macos-14",
    when: "tag",
    legs: 1,
    why: "Cutting the DMG and ZIP is a macOS build. Started by a `v*` tag, the weekly rehearsal on `main`, or a dispatch — never by an ordinary push.",
  },
  {
    workflow: "release.yml",
    job: "drill",
    runner: "macos-14",
    when: "dispatch",
    legs: 1,
    why: "Proves the draft cleanup against a real draft in the releases repo. On demand, and every scratch release it makes is deleted in an `always()` step.",
  },
];

/**
 * How many macOS jobs may start on an ordinary push or pull request.
 *
 * The number the whole file exists to keep: it is the one that arrives on its
 * own, many times a day, and the one that spent this account's Actions
 * allowance. Adding a job to the list above does not raise this — raising it is
 * the decision, and it should be a sentence somebody wrote deliberately.
 */
export const PER_PUSH_LIMIT = 2;

/**
 * The macOS runner labels this repository allows.
 *
 * A label is not just a machine: it is a rate, and for the Intel images a rate
 * paid for a build that is never published. So a new one is a decision, and this
 * is the list a decision gets written into.
 */
export const ALLOWED_RUNNERS = ["macos-14"];

/**
 * Labels this repository has used and given up, with the reason. Naming them is
 * the difference between "unknown runner label" and a failure somebody can act
 * on without reading the git history.
 */
export const RETIRED_RUNNERS = {
  "macos-13":
    "GitHub retired the macOS 13 images on 2025-12-04, so a job asking for one waits for a machine that never arrives",
  "macos-15-intel":
    "the Intel leg was retired on 2026-10-08: a second macOS runner on every push, for an x86_64 build that is never released, at ten times the Linux rate. See docs/FUTURE.md for the decision and docs/REMAINING-WORK.md for the measurement it was based on",
};

/** A column-0 `key:` line, which is where one top-level section ends. */
function isTopLevel(line) {
  return line.trim().length > 0 && !line.startsWith("#") && /^\S/.test(line);
}

/**
 * One top-level section of a workflow, `key:` through the next column-0 key.
 *
 * Text rather than a YAML parse on purpose, the same way the workflow specs read
 * these files: this repository has no YAML dependency, and the keys this check
 * reasons about — `jobs`, `on`, `runs-on`, `if` — are one per line in every way
 * anyone writes them.
 *
 * @param {string} text the workflow.
 * @param {string} name the top-level key.
 * @returns {string|null} the section, or null when the key is absent.
 */
export function topSection(text, name) {
  const lines = text.split("\n");
  const start = lines.findIndex(
    (line) => line === `${name}:` || line.startsWith(`${name}: `),
  );
  if (start === -1) return null;

  const section = [lines[start]];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (isTopLevel(lines[i])) break;
    section.push(lines[i]);
  }
  return section.join("\n");
}

/**
 * A nested block: the lines under `  key:` inside a section, more indented than
 * the key itself. Used to ask whether a `push:` trigger is limited to tags.
 */
function nestedSection(section, key, indent = 2) {
  const lines = section.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^ {${indent}}${key}:\\s*$`, "m").test(line),
  );
  if (start === -1) return null;

  const block = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().length === 0) {
      block.push(line);
      continue;
    }
    if (new RegExp(`^ {0,${indent}}\\S`).test(line)) break;
    block.push(line);
  }
  return block.join("\n");
}

/**
 * The jobs of a workflow, each with the text of its own block.
 *
 * A job is a key indented exactly two spaces inside `jobs:`; its block runs to
 * the next such key. Comments and blank lines belong to the job they sit in,
 * which is what lets the runner and the trigger be read out of it.
 *
 * @returns {Array<{job: string, block: string}>}
 */
export function workflowJobs(text) {
  const section = topSection(text, "jobs");
  if (section === null) return [];

  const lines = section.split("\n");
  const jobs = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
    if (!match) continue;

    const block = [lines[i]];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim().length === 0) {
        block.push(line);
        continue;
      }
      if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(line)) break;
      if (/^\S/.test(line)) break;
      block.push(line);
    }
    jobs.push({ job: match[1], block: block.join("\n") });
  }
  return jobs;
}

/**
 * Whether a workflow can be started by an ordinary push or a pull request.
 *
 * A `push:` limited to `tags:` is not one: a tag is pushed once per release, by
 * hand. Everything else about `on:` is read so the answer can be printed, not
 * because it changes the verdict.
 */
export function workflowTriggers(text) {
  const on = topSection(text, "on");
  if (on === null) return { everyPush: false, kinds: [] };

  // Every `^` below is anchored to a line, so the `m` flag is load-bearing: a
  // section is a string with newlines in it, and without it `^` matches only the
  // first line — which is the section's own key, `on:`. That mistake reads every
  // workflow as having no triggers at all, so the per-push jobs look conditional
  // and the check passes while the thing it guards is unguarded.
  const hasPush = /^ {2}push:/m.test(on);
  const pushBlock = nestedSection(on, "push");
  const pushTagsOnly =
    pushBlock !== null && /^\s+tags:/m.test(pushBlock) && !/^\s+branches:/m.test(pushBlock);
  const hasPullRequest = /^ {2}pull_request:/m.test(on);
  const schedule = /^ {2}schedule:/m.test(on);
  const dispatch = /^ {2}workflow_dispatch:/m.test(on);

  const kinds = [];
  if (hasPush) kinds.push(pushTagsOnly ? "tag push" : "push");
  if (hasPullRequest) kinds.push("pull request");
  if (schedule) kinds.push("schedule");
  if (dispatch) kinds.push("dispatch");

  return { everyPush: (hasPush && !pushTagsOnly) || hasPullRequest, kinds };
}

/**
 * What one job costs: which macOS runners it can start, and when.
 *
 * `runners` is every distinct macOS label the job names, which is what makes a
 * matrix leg visible: one literal runner is one machine, and a matrix naming
 * `macos-14` and `macos-15-intel` is two, on every run.
 */
export function jobFacts(block) {
  const runners = [...new Set(block.match(/\bmacos-[0-9a-z.-]+\b/g) ?? [])];
  const condition = /^ {4}if:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? null;
  return {
    runners,
    conditional: condition !== null,
    matrix: /^ {4}strategy:\s*$/m.test(block),
  };
}

/**
 * Every job in every workflow in this checkout, with what it costs.
 *
 * @param {string} [root] repository root, for tests.
 * @returns {Array<{workflow: string, job: string, runners: string[], matrix: boolean, conditional: boolean, everyPush: boolean}>|null}
 *   null when there is no workflow directory at all, which is a fault in the
 *   repository rather than an empty pass.
 */
export function auditWorkflows(root = ROOT) {
  const dir = path.join(root, WORKFLOW_DIR);
  if (!fs.existsSync(dir)) return null;

  const observed = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;

    const text = fs.readFileSync(path.join(dir, entry), "utf8");
    const triggers = workflowTriggers(text);

    for (const { job, block } of workflowJobs(text)) {
      const facts = jobFacts(block);
      observed.push({
        workflow: entry,
        job,
        runners: facts.runners,
        matrix: facts.matrix,
        conditional: facts.conditional,
        // A job with a condition of its own is not started by a push, whatever
        // the workflow's triggers are — that is how `drill` stays on demand.
        everyPush: triggers.everyPush && !facts.conditional,
      });
    }
  }
  return observed;
}

/** `ci.yml/e2e`, the name a failure is reported under. */
function label(job) {
  return `${job.workflow}/${job.job}`;
}

/**
 * The verdict, as data.
 *
 * Pure, so every way the budget and the workflows can disagree is testable
 * without a repository to break: what is new, what widened, what was left
 * behind, and what is merely cheaper than it used to be.
 *
 * @returns {{failures: string[], notes: string[]}}
 */
export function assess(
  observed,
  {
    budget = MACOS_BUDGET,
    limit = PER_PUSH_LIMIT,
    allowed = ALLOWED_RUNNERS,
    retired = RETIRED_RUNNERS,
  } = {},
) {
  const failures = [];
  const notes = [];
  const macos = observed.filter((job) => job.runners.length > 0);
  const declared = new Map(budget.map((entry) => [`${entry.workflow}/${entry.job}`, entry]));

  for (const job of macos) {
    if (declared.has(label(job))) continue;
    // A retired label gets its reason here too, not only on the path for a
    // declared job: somebody adding a Mac usually starts from a label they have
    // seen somewhere in this repository, and the retired ones are the ones that
    // still look available.
    const gone = job.runners
      .filter((runner) => retired[runner])
      .map((runner) => `\`${runner}\` — ${retired[runner]}`);
    failures.push(
      `${label(job)} runs on ${job.runners.join(", ")} and is not in MACOS_BUDGET. A macOS job bills at ten times the Linux rate on a private repository, so it is a spending decision: move it to \`ubuntu-latest\`, or add it to the budget in scripts/check-ci-cost.mjs with its runner and the reason it has to be a Mac.${gone.length > 0 ? ` Note: ${gone.join("; ")}.` : ""}`,
    );
  }

  for (const entry of budget) {
    const name = `${entry.workflow}/${entry.job}`;
    const job = macos.find((candidate) => label(candidate) === name);

    if (job === undefined) {
      failures.push(
        `MACOS_BUDGET declares ${name} on ${entry.runner}, and no job of that name runs on a Mac any more — a budget entry that outlives its job teaches the next reader to skip this file. Remove it, or fix the name.`,
      );
      continue;
    }

    const legs = entry.legs ?? 1;
    if (job.runners.length > legs) {
      failures.push(
        `${name} now names ${job.runners.length} macOS runners (${job.runners.join(", ")}) where the budget declares ${legs} — a second leg is that job's bill again on every run. Add it to the entry if it is wanted, at ${job.runners.length}.`,
      );
    }

    for (const runner of job.runners) {
      if (allowed.includes(runner)) continue;
      failures.push(
        `${name} asks for \`${runner}\`, which this repository does not allow${retired[runner] ? ` — ${retired[runner]}` : ""}. A runner label is a rate: if this one is wanted, add it to ALLOWED_RUNNERS in scripts/check-ci-cost.mjs and say why.`,
      );
    }

    if (entry.when !== "push" && job.everyPush) {
      const asked = entry.when === "dispatch" ? "started by hand" : "started by a tag";
      failures.push(
        `${name} was declared as ${asked} and now has no condition of its own in a workflow that runs on pushes — so it starts on every push, which is the spend this check exists to keep off. Give it back its \`if:\`, or move it to \`ubuntu-latest\`.`,
      );
    }

    if (entry.when === "push" && !job.everyPush) {
      notes.push(
        `${name} no longer starts on every push — cheaper than the budget says. Worth updating the entry when you are next in that file.`,
      );
    }
  }

  const perPush = macos.filter((job) => job.everyPush);
  if (perPush.length > limit) {
    failures.push(
      `${perPush.length} macOS job(s) start on every push (${perPush.map(label).join(", ")}), and this repository allows ${limit}. The limit is the decision; change it in scripts/check-ci-cost.mjs if a third one is really wanted, and say what it buys.`,
    );
  }

  notes.push(
    `${perPush.length} of ${limit} allowed macOS job(s) on every push: ${perPush.map((job) => `${label(job)} on ${job.runners.join("+")}`).join(", ") || "none"}`,
  );
  const onDemand = macos.filter((job) => !job.everyPush);
  notes.push(
    `${onDemand.length} macOS job(s) somebody has to ask for: ${onDemand.map(label).join(", ") || "none"}`,
  );
  const linux = observed.filter((job) => job.runners.length === 0);
  notes.push(
    `${linux.length} job(s) on ubuntu-latest: ${linux.map(label).join(", ") || "none"}`,
  );

  return { failures, notes };
}

/**
 * Check the spend, and say what a person changing a runner is told.
 *
 * @returns {number} the exit code for this process.
 */
export function run({ root = ROOT, log = console.log, error = console.error, ...options } = {}) {
  const observed = auditWorkflows(root);

  if (observed === null) {
    error(
      `[check-ci-cost] could not run — no ${WORKFLOW_DIR} at ${root}, so nothing declares a runner and a pass here would mean nothing`,
    );
    return 2;
  }
  if (observed.length === 0) {
    error(
      `[check-ci-cost] could not run — ${WORKFLOW_DIR} holds no job this checker could read`,
    );
    return 2;
  }

  const { failures, notes } = assess(observed, options);

  for (const note of notes) log(`  · ${note}`);

  if (failures.length > 0) {
    for (const failure of failures) error(`  ✗ ${failure}`);
    error(
      `[check-ci-cost] FAILED — ${failures.length} macOS job(s) or budget entry(s) the budget does not account for`,
    );
    return 1;
  }

  const macos = observed.filter((job) => job.runners.length > 0);
  const perPush = macos.filter((job) => job.everyPush);
  log(
    `[check-ci-cost] OK — ${macos.length} macOS job(s) declared, ${perPush.length} of them on every push; every job that needs a Mac is one this repository decided to pay for`,
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
    console.error(`[check-ci-cost] ${thrown?.message ?? thrown}`);
    process.exit(2);
  }
}
