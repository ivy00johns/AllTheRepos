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
 * So: the ignores, the script, and the step in CI that runs it. The rules
 * themselves are exercised by the run itself.
 */

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
    // `**/dist/**` rather than `dist/**`, because `mcp/` has its own bundle.
    expect(fs.existsSync(path.join(ROOT, "mcp", "dist"))).toBe(true);
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

    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("pnpm lint");
    // On the fast job, which is where typecheck already is: no build, no network,
    // no native rebuild.
    expect(ci.indexOf("pnpm lint")).toBeGreaterThan(ci.indexOf("pnpm typecheck"));
  });

  test("the rules are TypeScript-aware, which is why no eslint:recommended", () => {
    // `eslint:recommended`'s `no-undef` on a codebase whose globals come from
    // three tsconfigs and two Electron processes reports noise, not findings. The
    // config says so itself; this is the assertion that it still does.
    expect(read("eslint.config.mjs")).toContain("typescript-eslint");
    expect(read("package.json")).toContain('"typescript-eslint"');
  });
});
