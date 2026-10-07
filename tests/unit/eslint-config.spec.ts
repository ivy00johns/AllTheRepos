/**
 * The lint config, and the parts of it that are load-bearing.
 *
 * `eslint.config.mjs` is mostly a list of rules, and pinning rules in a test would
 * be pinning other people's opinions. What is worth pinning is the *scope* —
 * which files it declines to read — because getting that wrong is not a matter of
 * taste. This repository keeps two other checkouts of itself under
 * `.freebuff/worktrees/`, each with an `out/` of bundled, minified JavaScript;
 * `mcp/` has its own `dist/`. Linting them found **13,029** errors in trees nobody
 * is editing, which is exactly how a new gate gets ignored: the first run is
 * unusable, so somebody turns it off.
 *
 * So: the ignores, the script, the step in CI that runs it, and the one rule the
 * config adds to the linter's defaults. The rules themselves are exercised by
 * the run itself; the dead-suppression rule is exercised by linting a fixture
 * that carries one, because a config value nothing acts on is a comment with
 * better syntax.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const CONFIG = path.join(ROOT, "eslint.config.mjs");

const read = (relative: string) =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

interface Flat {
  ignores?: string[];
  linterOptions?: { reportUnusedDisableDirectives?: string };
}

/** The linter CI runs, by the path its own bin script lives at. */
const ESLINT = path.join(ROOT, "node_modules", "eslint", "bin", "eslint.js");

/**
 * Lint one path the way CI does — the repo's own config, found by lookup.
 *
 * No `--config`: the fixture lives inside the repository so ESLint walks up to
 * `eslint.config.mjs` the same way it would for any other file, which is the
 * arrangement under test rather than a second one set up for the test.
 */
function lint(target: string) {
  return spawnSync(process.execPath, [ESLINT, target], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

let config: Flat[];

beforeAll(async () => {
  // `.default` and not the namespace: an ESM config is imported as a module, so
  // the array the file exports is one property down. Reading the namespace
  // instead gives an object with no `ignores` — which would make every assertion
  // below pass on an empty list if they did not also assert a length.
  const module = (await import(pathToFileURL(CONFIG).href)) as { default?: Flat[] };
  config = module.default ?? [];
});

/** Everything the config tells ESLint not to read. */
function ignores(): string[] {
  return config.flatMap((entry) => entry.ignores ?? []);
}

describe("what the linter is told to ignore", () => {
  test("the other checkouts of this repository", () => {
    // Not a nicety. `.freebuff/worktrees/*` holds sibling worktrees — stale ones
    // included — and each carries a built `out/`. Reading them reported eleven
    // thousand `no-var` errors from minified bundles before this ignore existed.
    expect(ignores().length).toBeGreaterThan(0);
    expect(ignores()).toContain(".freebuff/**");
  });

  test("build output, wherever it is", () => {
    for (const pattern of ["out/**", "release/**", "**/dist/**"]) {
      expect(ignores(), pattern).toContain(pattern);
    }
    // `**/dist/**` rather than `dist/**`, because `mcp/` builds its own bundle
    // into a nested one. The premise is read from that package's committed
    // config, not from the directory itself: `mcp/dist` is build output, ignored
    // by `mcp/.gitignore`, so a clean checkout does not have it. Asking whether
    // it *existed* made this pass only where somebody had already run the build
    // — it read `true` here and `false` on a runner, where it failed the unit
    // suite that the release job guards the build with, and left v0.1.8 tagged
    // with nothing published.
    const mcp = JSON.parse(read("mcp/package.json")) as {
      bin: Record<string, string>;
      files: string[];
    };
    expect(Object.values(mcp.bin)).toContain("./dist/index.js");
    expect(mcp.files).toContain("dist");
  });

  test("the file that is generated rather than written", () => {
    // `src/shared/adhoc-notice.ts` is rendered from `scripts/first-launch.mjs` and
    // checked byte-for-byte by `pnpm first-launch:check`. Reformatting it to
    // satisfy a rule would fail that check, so the linter stays out of it.
    expect(ignores()).toContain("src/shared/adhoc-notice.ts");
  });
});

describe("how a developer and CI run it", () => {
  test("there is one command, and CI runs exactly it", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts.lint).toBe("eslint .");

    // And the dead-suppression rule rides in the config rather than on that
    // command, so there is no flag for an editor's ESLint integration — or a
    // person running `eslint .` by hand — to be missing.
    expect(
      config.flatMap(
        (entry) => entry.linterOptions?.reportUnusedDisableDirectives ?? [],
      ),
    ).toContain("error");

    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("pnpm lint");
    // On the fast job, which is where typecheck already is: no build, no network,
    // no native rebuild.
    expect(ci.indexOf("pnpm lint")).toBeGreaterThan(ci.indexOf("pnpm typecheck"));
  });

  test("a suppression that suppresses nothing fails the gate", () => {
    // The rule above is a config value until something acts on it. This runs the
    // linter on two fixtures that differ by exactly one line — the directive —
    // so a non-zero exit can only be about the suppression. The failure it
    // prevents is the one this repository already had: twenty-seven disable
    // comments naming rules that had left with the Next-era linter, invisible to
    // every run until somebody rebuilt the linter and read them by hand.
    const dir = fs.mkdtempSync(path.join(ROOT, "tests", "eslint-dead-directive-"));
    const fixture = (name: string, body: string) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, body, "utf8");
      return file;
    };

    const dead = fixture(
      "dead.mjs",
      "// eslint-disable-next-line no-console\nexport const answer = 42;\n",
    );
    const live = fixture("live.mjs", "export const answer = 42;\n");

    try {
      const bad = lint(dead);
      expect(
        bad.status,
        `a fixture carrying a dead suppression linted clean:\n${bad.stdout}${bad.stderr}`,
      ).not.toBe(0);
      expect(`${bad.stdout}${bad.stderr}`).toContain(
        "Unused eslint-disable directive",
      );

      // The control: the same file without the directive, so a red run above is
      // the suppression and not the fixture.
      const clean = lint(live);
      expect(
        clean.status,
        `the fixture without the suppression did not lint clean:\n${clean.stdout}${clean.stderr}`,
      ).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the rules are TypeScript-aware, which is why no eslint:recommended", () => {
    // `eslint:recommended`'s `no-undef` on a codebase whose globals come from
    // three tsconfigs and two Electron processes reports noise, not findings. The
    // config says so itself; this is the assertion that it still does.
    expect(read("eslint.config.mjs")).toContain("typescript-eslint");
    expect(read("package.json")).toContain('"typescript-eslint"');
  });
});
