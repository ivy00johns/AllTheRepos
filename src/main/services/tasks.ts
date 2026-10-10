/**
 * Task discovery and execution.
 *
 * Every project answers "how do I run this?" differently, and the answer
 * is always sitting in a file you'd have to open. This service reads
 * those files so the catalog can show a project's runnable tasks the
 * moment you select it — the difference between "which of my 150 repos
 * was the one with the dev server" and just pressing the button.
 *
 * ## What it understands
 *
 * `package.json` scripts, `Makefile` targets, `justfile` recipes,
 * `Cargo.toml` binaries, Python (`pyproject.toml` / `manage.py`),
 * `docker-compose.yml`, `Procfile`, and Go. Detection is read-only and
 * cheap — a handful of small files, no subprocess.
 *
 * ## Running
 *
 * Tasks run via the user's shell so `nvm`, `direnv`, aliases and PATH
 * behave the way they do in a terminal. Output is streamed to the
 * renderer line by line rather than buffered, because the whole point of
 * `dev` is watching it come up.
 *
 * A process is bound to the repo that started it and tracked here until
 * it exits, so it can be stopped from the UI. Stopping escalates
 * SIGTERM → SIGKILL and kills the whole process group, since a dev
 * server that spawns children would otherwise survive its parent.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { RepoTask, TaskOutputEvent } from "@shared/types";

/** Scripts that are noise in a task list — lifecycle hooks, not commands. */
const NPM_LIFECYCLE = new Set([
  "preinstall",
  // pnpm's own pre-install hook, which this repository uses to put the machine's
  // SDK where a node-gyp build finds it (ATR-057). A hook, not a command.
  "pnpm:devPreinstall",
  "install",
  "postinstall",
  "prepublish",
  "prepare",
  "prepublishOnly",
  "prepack",
  "postpack",
]);

/**
 * Ordering hint: the tasks people actually reach for, first.
 * Anything unlisted keeps its file order after these.
 */
const PRIORITY = [
  "dev",
  "start",
  "serve",
  "build",
  "test",
  "lint",
  "typecheck",
];

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readText(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    // Guard against a pathological Makefile; we only need the targets.
    if (!stat.isFile() || stat.size > 512_000) return null;
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Which package manager a JS project wants, from its lockfile. */
function detectPackageManager(root: string): string {
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(root, "bun.lockb"))) return "bun";
  return "npm";
}

function detectNodeTasks(root: string): RepoTask[] {
  const pkg = readJson(path.join(root, "package.json"));
  const scripts = pkg?.scripts;
  if (!scripts || typeof scripts !== "object") return [];
  const manager = detectPackageManager(root);
  const runPrefix = manager === "npm" ? "npm run" : `${manager} run`;

  return Object.keys(scripts as Record<string, string>)
    .filter((name) => !NPM_LIFECYCLE.has(name))
    .map((name) => ({
      id: `npm:${name}`,
      name,
      source: "package.json" as const,
      command: `${runPrefix} ${name}`,
      detail: String((scripts as Record<string, string>)[name] ?? ""),
    }));
}

function detectMakeTasks(root: string): RepoTask[] {
  const text = readText(path.join(root, "Makefile"));
  if (!text) return [];
  const targets = new Set<string>();
  for (const line of text.split("\n")) {
    // `target:` at the start of a line, ignoring pattern rules and vars.
    const match = /^([a-zA-Z0-9][\w.-]*)\s*:(?!=)/.exec(line);
    if (match && match[1] !== ".PHONY") targets.add(match[1]);
  }
  return [...targets].map((name) => ({
    id: `make:${name}`,
    name,
    source: "Makefile" as const,
    command: `make ${name}`,
    detail: null,
  }));
}

function detectJustTasks(root: string): RepoTask[] {
  const text =
    readText(path.join(root, "justfile")) ??
    readText(path.join(root, "Justfile"));
  if (!text) return [];
  const recipes = new Set<string>();
  for (const line of text.split("\n")) {
    const match = /^([a-zA-Z0-9][\w-]*)(\s+[\w\s]*)?:(?!=)/.exec(line);
    if (match) recipes.add(match[1]);
  }
  return [...recipes].map((name) => ({
    id: `just:${name}`,
    name,
    source: "justfile" as const,
    command: `just ${name}`,
    detail: null,
  }));
}

function detectRustTasks(root: string): RepoTask[] {
  if (!fs.existsSync(path.join(root, "Cargo.toml"))) return [];
  return [
    { id: "cargo:run", name: "run", command: "cargo run" },
    { id: "cargo:build", name: "build", command: "cargo build" },
    { id: "cargo:test", name: "test", command: "cargo test" },
  ].map((t) => ({ ...t, source: "Cargo.toml" as const, detail: null }));
}

function detectGoTasks(root: string): RepoTask[] {
  if (!fs.existsSync(path.join(root, "go.mod"))) return [];
  return [
    { id: "go:run", name: "run", command: "go run ./..." },
    { id: "go:build", name: "build", command: "go build ./..." },
    { id: "go:test", name: "test", command: "go test ./..." },
  ].map((t) => ({ ...t, source: "go.mod" as const, detail: null }));
}

function detectPythonTasks(root: string): RepoTask[] {
  const tasks: RepoTask[] = [];
  if (fs.existsSync(path.join(root, "manage.py"))) {
    tasks.push({
      id: "py:runserver",
      name: "runserver",
      source: "manage.py",
      command: "python manage.py runserver",
      detail: null,
    });
  }
  const pyproject = readText(path.join(root, "pyproject.toml"));
  if (pyproject) {
    if (pyproject.includes("[tool.poetry")) {
      tasks.push({
        id: "py:poetry-install",
        name: "install",
        source: "pyproject.toml",
        command: "poetry install",
        detail: null,
      });
    }
    if (pyproject.includes("[tool.pytest") || pyproject.includes("pytest")) {
      tasks.push({
        id: "py:pytest",
        name: "test",
        source: "pyproject.toml",
        command: "pytest",
        detail: null,
      });
    }
  }
  if (
    tasks.length === 0 &&
    fs.existsSync(path.join(root, "requirements.txt"))
  ) {
    tasks.push({
      id: "py:pip-install",
      name: "install deps",
      source: "requirements.txt",
      command: "pip install -r requirements.txt",
      detail: null,
    });
  }
  return tasks;
}

function detectComposeTasks(root: string): RepoTask[] {
  const file = [
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
  ].find((name) => fs.existsSync(path.join(root, name)));
  if (!file) return [];
  return [
    {
      id: "compose:up",
      name: "compose up",
      source: "docker-compose" as const,
      command: "docker compose up",
      detail: file,
    },
    {
      id: "compose:down",
      name: "compose down",
      source: "docker-compose" as const,
      command: "docker compose down",
      detail: file,
    },
  ];
}

function detectProcfileTasks(root: string): RepoTask[] {
  const text = readText(path.join(root, "Procfile"));
  if (!text) return [];
  const tasks: RepoTask[] = [];
  for (const line of text.split("\n")) {
    const match = /^([a-zA-Z0-9_-]+):\s*(.+)$/.exec(line.trim());
    if (!match) continue;
    tasks.push({
      id: `procfile:${match[1]}`,
      name: match[1],
      source: "Procfile",
      command: match[2].trim(),
      detail: null,
    });
  }
  return tasks;
}

/**
 * Everything this project knows how to run.
 *
 * Pure read of a few small files — safe to call on selection without
 * debouncing.
 */
export function detectTasks(root: string): RepoTask[] {
  if (!fs.existsSync(root)) return [];
  const tasks = [
    ...detectNodeTasks(root),
    ...detectMakeTasks(root),
    ...detectJustTasks(root),
    ...detectRustTasks(root),
    ...detectGoTasks(root),
    ...detectPythonTasks(root),
    ...detectComposeTasks(root),
    ...detectProcfileTasks(root),
  ];

  return tasks.sort((a, b) => {
    const ai = PRIORITY.indexOf(a.name);
    const bi = PRIORITY.indexOf(b.name);
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export type TaskOutputListener = (event: TaskOutputEvent) => void;

interface RunningTask {
  runId: string;
  slug: string;
  taskId: string;
  command: string;
  child: ChildProcess;
  startedAt: string;
}

/** How long a stopped process gets to exit before it's killed outright. */
const KILL_GRACE_MS = 4000;

class TaskService {
  private running = new Map<string, RunningTask>();
  private listeners = new Set<TaskOutputListener>();

  onOutput(listener: TaskOutputListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: TaskOutputEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[tasks] listener threw", error);
      }
    }
  }

  list(root: string): RepoTask[] {
    return detectTasks(root);
  }

  /** Runs currently in flight, so the UI can restore state on mount. */
  active(): Array<{
    runId: string;
    slug: string;
    taskId: string;
    command: string;
    startedAt: string;
  }> {
    return [...this.running.values()].map(
      ({ runId, slug, taskId, command, startedAt }) => ({
        runId,
        slug,
        taskId,
        command,
        startedAt,
      }),
    );
  }

  /**
   * Start a task.
   *
   * The command runs through an interactive login shell so the
   * environment matches what the user gets in a terminal — without it,
   * anything installed by `nvm`, `pyenv`, `rbenv` or Homebrew's shell
   * init simply isn't on PATH and every task fails with "command not
   * found" for reasons that look like an app bug.
   */
  start(input: {
    runId: string;
    slug: string;
    taskId: string;
    command: string;
    cwd: string;
  }): { started: boolean; reason: string | null } {
    if (this.running.has(input.runId)) {
      return { started: false, reason: "That run is already going." };
    }
    if (!fs.existsSync(input.cwd)) {
      return { started: false, reason: "The project folder is gone." };
    }

    const shell = process.env.SHELL || "/bin/zsh";
    const child = spawn(shell, ["-l", "-i", "-c", input.command], {
      cwd: input.cwd,
      env: { ...process.env, FORCE_COLOR: "0", CI: "" },
      // Its own process group, so stopping kills the dev server AND
      // everything it spawned rather than orphaning children.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const entry: RunningTask = {
      runId: input.runId,
      slug: input.slug,
      taskId: input.taskId,
      command: input.command,
      child,
      startedAt: new Date().toISOString(),
    };
    this.running.set(input.runId, entry);

    this.emit({
      runId: input.runId,
      slug: input.slug,
      kind: "started",
      chunk: null,
      exitCode: null,
      at: entry.startedAt,
    });

    const pipe = (
      stream: NodeJS.ReadableStream | null,
      kind: "stdout" | "stderr",
    ) => {
      stream?.on("data", (buffer: Buffer) => {
        this.emit({
          runId: input.runId,
          slug: input.slug,
          kind,
          chunk: buffer.toString("utf8"),
          exitCode: null,
          at: new Date().toISOString(),
        });
      });
    };
    pipe(child.stdout, "stdout");
    pipe(child.stderr, "stderr");

    child.on("error", (error) => {
      this.emit({
        runId: input.runId,
        slug: input.slug,
        kind: "stderr",
        chunk: `${error.message}\n`,
        exitCode: null,
        at: new Date().toISOString(),
      });
    });

    child.on("close", (code) => {
      this.running.delete(input.runId);
      this.emit({
        runId: input.runId,
        slug: input.slug,
        kind: "exited",
        chunk: null,
        exitCode: code,
        at: new Date().toISOString(),
      });
    });

    return { started: true, reason: null };
  }

  /**
   * Stop a run: SIGTERM the whole process group, then SIGKILL anything
   * still alive after a grace period.
   */
  stop(runId: string): { stopped: boolean } {
    const entry = this.running.get(runId);
    if (!entry?.child.pid) return { stopped: false };

    const pid = entry.child.pid;
    const signal = (sig: NodeJS.Signals) => {
      try {
        // Negative pid targets the group created by `detached: true`.
        process.kill(-pid, sig);
      } catch {
        try {
          process.kill(pid, sig);
        } catch {
          /* already gone */
        }
      }
    };

    signal("SIGTERM");
    setTimeout(() => {
      if (this.running.has(runId)) signal("SIGKILL");
    }, KILL_GRACE_MS).unref?.();

    return { stopped: true };
  }

  /** Stop everything — called on app quit so nothing is orphaned. */
  stopAll(): void {
    for (const runId of [...this.running.keys()]) this.stop(runId);
  }
}

export const taskService = new TaskService();

/** Exported for the settings surface / diagnostics. */
export function defaultShell(): string {
  return (
    process.env.SHELL || (os.platform() === "win32" ? "cmd.exe" : "/bin/sh")
  );
}
