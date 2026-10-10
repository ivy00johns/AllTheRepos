/**
 * The repo detail panel's own two surfaces — the README and the folder rail.
 *
 * Three things the 2026-10-08 review found, asserted where a person meets
 * them rather than read off the source:
 *
 *   1. A README renders as markdown, with the app's styling. The tree had
 *      carried `prose prose-invert prose-sm` and the `prose-*:` modifiers with
 *      no typography plugin behind them, so those classes compiled to nothing
 *      and preflight left a README as one undifferentiated block of text. The
 *      assertions below read the *computed* style of the rendered elements, so
 *      they fail if the styling goes missing again — not merely if the class
 *      names change.
 *   2. The Tasks section does not open itself. Expanded by default, a project's
 *      script list pushed the README below the fold on every repo.
 *   3. The rail's "directly in this folder" row is a control, not a caption. It
 *      used to be a plain `<div>` naming a count with no way to open it; it now
 *      scopes the catalog to that folder's own repos.
 *
 * The profile is built here, the way `curate-link-flow.spec.ts` builds its own:
 * a README is content the shared seeded template does not carry, and writing it
 * into the developer's real catalog is not an option. The `MIGRATED` sentinel
 * and `__legacyPromoted` cut the profile off from `~/.alltherepos`, so the one
 * seeded repo is the whole library here as it is on a runner.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");
const SEED_SCRIPT = resolve(__dirname, "_seed-catalog.mjs");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronBinary = require("electron") as string;

const REPO_NAME = "E2E Readme Repo";

/** The markdown whose rendering the style assertions read back. */
const README = [
  "# Demo Readme",
  "",
  "A paragraph with a [link](https://example.com) and `inline code`.",
  "",
  "- first item",
  "- second item",
  "",
].join("\n");

/** The accent the theme promises, as `getComputedStyle` reports it. */
const ACCENT = "rgb(34, 197, 94)";

function launch(profileDir: string) {
  return electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profileDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
  });
}

function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync(
    "git",
    [
      "-c",
      "user.email=e2e@example.com",
      "-c",
      "user.name=E2E",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "seed",
    ],
    { cwd: dir },
  );
  // A declared script, so the detail panel renders its Tasks section and the
  // spec can assert the state it opens in.
  writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name: "e2e-readme-repo", scripts: { dev: "echo hi" } }, null, 2)}\n`,
  );
}

test.describe("repo detail panel — README and folder rail", () => {
  // Two launches (one to migrate the profile, one to drive) plus the seeding.
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test("README renders as styled markdown, tasks stay shut, the rail row opens the folder", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "atr-readme-e2e-"));
    const profileDir = path.join(root, "profile");
    const repoPath = path.join(root, "repos", "readme-repo");
    const dbPath = path.join(profileDir, "alltherepos.db");

    mkdirSync(profileDir, { recursive: true });
    initRepo(repoPath);

    // Keep this profile from inheriting the developer's legacy catalog, so
    // "the seeded repo is the whole library" holds on any machine.
    writeFileSync(path.join(profileDir, "MIGRATED"), new Date().toISOString());
    writeFileSync(
      path.join(profileDir, "settings.json"),
      `${JSON.stringify({ scanPaths: [], __legacyPromoted: true }, null, 2)}\n`,
    );

    // 1. Boot once so the app migrates an empty database into the profile; the
    //    seeder fills an existing DB rather than creating one.
    const bootstrap = await launch(profileDir);
    try {
      const win = await bootstrap.firstWindow();
      await win.waitForLoadState("domcontentloaded");
    } finally {
      await bootstrap.close();
    }

    // 2. Seed the row, then give it README content (the shared seeder writes a
    //    description but no readme). Both steps run under the app's own runtime
    //    because better-sqlite3 is built for Electron's ABI here.
    const seeded = spawnSync(
      electronBinary,
      [SEED_SCRIPT, dbPath, REPO_NAME, repoPath],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        encoding: "utf8",
      },
    );
    expect(
      seeded.status,
      `seed script exited ${seeded.status}\n${seeded.stdout ?? ""}\n${seeded.stderr ?? ""}`,
    ).toBe(0);

    const readmeWrite = spawnSync(
      electronBinary,
      [
        "-e",
        `const Database=require("better-sqlite3");const db=new Database(${JSON.stringify(
          dbPath,
        )});db.prepare("UPDATE repos SET readme_content = ? WHERE name = ?").run(${JSON.stringify(
          README,
        )},${JSON.stringify(REPO_NAME)});db.close();`,
      ],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        encoding: "utf8",
      },
    );
    expect(
      readmeWrite.status,
      `readme write exited ${readmeWrite.status}\n${readmeWrite.stdout ?? ""}\n${readmeWrite.stderr ?? ""}`,
    ).toBe(0);

    // 3. Drive it.
    const app = await launch(profileDir);
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });

      // --- (3) the rail row is a control that scopes the catalog ---
      const directRow = win.getByRole("button", {
        name: /directly in this folder/i,
      });
      await expect(directRow).toBeVisible({ timeout: 15_000 });
      await expect(directRow).toHaveAttribute("data-selected", "false");
      await directRow.click();
      await expect(directRow).toHaveAttribute("data-selected", "true");
      // The toolbar names the active scope, which is the visible half of "the
      // catalog is now these repos".
      await expect(
        win.getByRole("button", { name: /clear scope .*top level/i }),
      ).toBeVisible({ timeout: 10_000 });

      // --- open the repo's detail panel ---
      const row = win
        .locator("article[data-repo-slug], tr[data-repo-slug]")
        .filter({ hasText: REPO_NAME })
        .first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.click();

      const panel = win.getByRole("complementary", { name: /repo detail/i });
      await expect(panel).toBeVisible({ timeout: 10_000 });

      // --- (2) Tasks is present and shut on open ---
      const tasksHeader = panel.getByRole("button", { name: /^tasks\b/i });
      await expect(tasksHeader).toBeVisible({ timeout: 10_000 });
      await expect(tasksHeader).toHaveAttribute("aria-expanded", "false");

      // --- (1) the README renders as styled markdown ---
      // Waiting for the heading also proves the lazily-imported renderer chunk
      // resolved, which is what keeps react-markdown off the first paint.
      const heading = panel.locator(".atr-prose h1");
      await expect(heading).toBeVisible({ timeout: 10_000 });
      await expect(heading).toHaveText(/Demo Readme/i);

      const styles = await panel.evaluate((el) => {
        const prose = el.querySelector(".atr-prose");
        const cs = (node: Element | null) =>
          node ? getComputedStyle(node) : null;
        return {
          headingFont: cs(prose?.querySelector("h1") ?? null)?.fontFamily ?? "",
          linkColor: cs(prose?.querySelector("a") ?? null)?.color ?? "",
          listStyle:
            cs(prose?.querySelector("ul") ?? null)?.listStyleType ?? "",
          codeColor: cs(prose?.querySelector("code") ?? null)?.color ?? "",
        };
      });

      // Markdown, not a wall of text: the heading takes the mono face and the
      // links, list markers and inline code take the app's own styling.
      expect(styles.headingFont).toContain("JetBrains Mono");
      expect(styles.linkColor).toBe(ACCENT);
      expect(styles.codeColor).toBe(ACCENT);
      expect(styles.listStyle).toBe("disc");
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
