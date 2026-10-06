/**
 * Unit tests for task discovery, against real fixture directories.
 *
 * Detection is what makes the runner useful or useless: miss a project's
 * scripts and the panel is empty, over-detect and it's full of noise
 * nobody wants to click. Both failure modes are pinned here.
 *
 * Execution isn't covered — spawning real dev servers in a unit suite
 * would be slow and flaky. The command STRING each task produces is
 * asserted instead, which is the part that can silently be wrong.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { makeTmpDir, cleanupTmp } from "../../../helpers/tmp-dir.js";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp/atr-tasks-test" } }));

import { detectTasks } from "@main/services/tasks";

let root = "";

function write(relative: string, content: string): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const names = (root: string) => detectTasks(root).map((t) => t.name);
const byName = (name: string) => detectTasks(root).find((t) => t.name === name);

describe("detectTasks", () => {
  beforeEach(() => {
    root = makeTmpDir("atr-tasks");
  });
  afterEach(() => {
    cleanupTmp(root);
    root = "";
  });

  it("finds npm scripts and skips lifecycle hooks", () => {
    write(
      "package.json",
      JSON.stringify({
        scripts: {
          dev: "vite",
          build: "vite build",
          // Lifecycle hooks run themselves; listing them is noise.
          postinstall: "patch-package",
          prepare: "husky",
        },
      }),
    );
    expect(names(root).sort()).toEqual(["build", "dev"]);
  });

  it("uses the package manager the lockfile implies", () => {
    write("package.json", JSON.stringify({ scripts: { dev: "vite" } }));
    expect(byName("dev")?.command).toBe("npm run dev");

    write("pnpm-lock.yaml", "");
    expect(byName("dev")?.command).toBe("pnpm run dev");
  });

  it("carries the underlying script as the detail line", () => {
    write(
      "package.json",
      JSON.stringify({ scripts: { dev: "vite --port 3000" } }),
    );
    expect(byName("dev")?.detail).toBe("vite --port 3000");
  });

  it("finds Makefile targets and ignores variables and .PHONY", () => {
    write(
      "Makefile",
      [
        "CC := gcc",
        "FLAGS = -O2",
        ".PHONY: build test",
        "build:",
        "\tgo build",
        "test:",
        "\tgo test",
      ].join("\n"),
    );
    const found = names(root);
    expect(found).toContain("build");
    expect(found).toContain("test");
    expect(found).not.toContain("CC");
    expect(found).not.toContain("FLAGS");
    expect(found).not.toContain(".PHONY");
  });

  it("finds justfile recipes", () => {
    write(
      "justfile",
      ["serve:", "  python -m http.server", "", "fmt:", "  black ."].join("\n"),
    );
    expect(names(root)).toEqual(expect.arrayContaining(["serve", "fmt"]));
  });

  it("offers the standard commands for Rust and Go projects", () => {
    write("Cargo.toml", '[package]\nname = "x"\n');
    expect(byName("run")?.command).toBe("cargo run");

    cleanupTmp(root);
    root = makeTmpDir("atr-tasks");
    write("go.mod", "module x\n");
    expect(byName("test")?.command).toBe("go test ./...");
  });

  it("recognises Django and pytest projects", () => {
    write("manage.py", "# django");
    expect(byName("runserver")?.command).toBe("python manage.py runserver");

    write("pyproject.toml", "[tool.pytest.ini_options]\n");
    expect(byName("test")?.command).toBe("pytest");
  });

  it("falls back to requirements.txt only when nothing better exists", () => {
    write("requirements.txt", "flask\n");
    expect(names(root)).toEqual(["install deps"]);

    // With a real task available, the bare pip fallback is redundant.
    write("manage.py", "# django");
    expect(names(root)).not.toContain("install deps");
  });

  it("finds docker compose services", () => {
    write("docker-compose.yml", "services:\n  web:\n    image: nginx\n");
    expect(names(root)).toEqual(
      expect.arrayContaining(["compose up", "compose down"]),
    );
  });

  it("parses a Procfile into its named processes", () => {
    write("Procfile", "web: gunicorn app:app\nworker: celery -A app worker\n");
    expect(byName("web")?.command).toBe("gunicorn app:app");
    expect(byName("worker")?.command).toBe("celery -A app worker");
  });

  it("puts the commands people actually reach for first", () => {
    write(
      "package.json",
      JSON.stringify({
        scripts: { zzz: "x", build: "x", dev: "x", aaa: "x", test: "x" },
      }),
    );
    // `dev` before `build` before `test`, regardless of file order.
    const found = names(root);
    expect(found.slice(0, 3)).toEqual(["dev", "build", "test"]);
  });

  it("combines every source present in one project", () => {
    write("package.json", JSON.stringify({ scripts: { dev: "vite" } }));
    write("Makefile", "deploy:\n\t./deploy.sh\n");
    write("docker-compose.yml", "services: {}\n");
    const found = names(root);
    expect(found).toEqual(
      expect.arrayContaining(["dev", "deploy", "compose up"]),
    );
  });

  it("returns nothing for a project that declares no tasks, and for a missing path", () => {
    expect(detectTasks(root)).toEqual([]);
    expect(detectTasks(path.join(root, "nope"))).toEqual([]);
  });

  it("survives a malformed package.json instead of throwing", () => {
    write("package.json", "{ not json");
    expect(detectTasks(root)).toEqual([]);
  });

  it("gives every task a unique id", () => {
    write("package.json", JSON.stringify({ scripts: { build: "x" } }));
    write("Makefile", "build:\n\tmake it\n");
    const ids = detectTasks(root).map((t) => t.id);
    // Same NAME from two sources must not collide into one row.
    expect(new Set(ids).size).toBe(ids.length);
  });
});
