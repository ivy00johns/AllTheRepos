/**
 * Curated links E2E — assert a relationship, read it back, remove it.
 *
 * The repo detail panel is the app's own writer of `repo_links`; the other
 * writer is the alltherepos MCP. Unit tests cover the handlers, the schema
 * and the query layer (`tests/unit/main/ipc/graph.spec.ts`,
 * `tests/unit/main/db/links.spec.ts`), but nothing yet proved that a person
 * can reach that path from the catalog: pick a repo, name the other end,
 * state the kind, give a reason, watch the row appear, delete it again. That
 * is what this spec drives.
 *
 * It is also the first spec that does not depend on the developer's library:
 * the app is launched with `--user-data-dir` pointed at a fresh temp profile,
 * which is where it puts `alltherepos.db` (`db/client.ts`), and the two rows it
 * needs are seeded into that copy. A fresh profile is not quite empty — the app
 * migrates a legacy `~/.alltherepos/` catalog into it when one exists, so extra
 * repos can be present. Both ends of the flow are asserted by name, so that is
 * harmless: with neither a profile nor a legacy catalog (a CI runner), the two
 * seeded rows are the whole library, which is how this spec was verified.
 *
 * Two details worth knowing before editing:
 *   - Seeding happens in a child process under `ELECTRON_RUN_AS_NODE=1`
 *     (`_seed-catalog.mjs`), because the suite leaves better-sqlite3 built
 *     for Electron's ABI and the Playwright worker is host Node.
 *   - In-panel controls are clicked with `dispatchEvent`, not `click()`. The
 *     panel's sticky footer and tablist intercept hit-tested clicks (a known,
 *     unresolved defect), and a hit-tested click would land on whatever is
 *     stacked above the control.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");
const SEED_SCRIPT = resolve(__dirname, "_seed-catalog.mjs");

// The electron package's index.js exports the path to its binary — the same
// runtime the app itself boots, borrowed as plain Node for the seeder.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronBinary = require("electron") as string;

const ANCHOR = "E2E Anchor Repo";
const TARGET = "E2E Target Repo";
const WHY = "asserted by the electron e2e suite";

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

/** A real git repo, so the panel's branch and dirty reads have an answer. */
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
}

test.describe("curated links in the repo detail panel", () => {
  // Two app launches (one to migrate the profile, one to drive) plus the
  // per-test work — the suite default of 60s is not enough, and a timeout here
  // would look like a product defect. The launches themselves are quick now:
  // the window paints before the services boot (ATR-055).
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test("assert a link from the panel, then remove it", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "atr-curate-e2e-"));
    const profileDir = path.join(root, "profile");
    const anchorPath = path.join(root, "repos", "anchor");
    const targetPath = path.join(root, "repos", "target");
    const dbPath = path.join(profileDir, "alltherepos.db");

    mkdirSync(profileDir, { recursive: true });
    initRepo(anchorPath);
    initRepo(targetPath);

    // 1. Boot once so the app migrates an empty database into the profile —
    //    schema, FTS triggers and all. The seeder fills an existing DB, it
    //    does not create one, because the app owns that DDL.
    const bootstrap = await launch(profileDir);
    try {
      const win = await bootstrap.firstWindow();
      await win.waitForLoadState("domcontentloaded");
    } finally {
      await bootstrap.close();
    }

    // 2. Seed the two rows the flow needs.
    const seeded = spawnSync(
      electronBinary,
      [
        SEED_SCRIPT,
        dbPath,
        ANCHOR,
        anchorPath,
        TARGET,
        targetPath,
      ],
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

    // 3. Drive the flow.
    const app = await launch(profileDir);
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });

      // Select the anchor repo. Both the grid card and the table row carry
      // `data-repo-slug`, so the spec does not depend on which view a fresh
      // profile defaults to.
      const row = win
        .locator("article[data-repo-slug], tr[data-repo-slug]")
        .filter({ hasText: ANCHOR })
        .first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.click();

      const panel = win.getByRole("complementary", { name: /repo detail/i });
      await expect(panel).toBeVisible({ timeout: 10_000 });
      await expect(panel.getByText(/no curated links yet/i)).toBeVisible({
        timeout: 10_000,
      });

      // --- Assert ---
      const addButton = panel.getByRole("button", {
        name: new RegExp(`assert a relationship for ${ANCHOR}`, "i"),
      });
      await expect(addButton).toBeVisible();
      await addButton.dispatchEvent("click");

      const dialog = win.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await expect(
        dialog.getByRole("heading", {
          name: new RegExp(`relate ${ANCHOR} to another repo`, "i"),
        }),
      ).toBeVisible();

      await dialog.locator("#curate-link-search").fill(TARGET);
      const hit = dialog.locator("ul li button").filter({ hasText: TARGET });
      await expect(hit.first()).toBeVisible({ timeout: 10_000 });
      await hit.first().click();

      // The kind and the reason are both required by the contract — an
      // unexplained curated link outranks every derived signal on the map.
      await dialog.getByRole("button", { name: /^depends on$/ }).click();
      await dialog.locator("#curate-link-why").fill(WHY);
      await dialog.getByRole("button", { name: /assert link/i }).click();

      await expect(dialog).toBeHidden({ timeout: 10_000 });

      // Read back through the query layer: the mutation invalidates this
      // repo's relations, so a row on screen is a row in `repo_links`.
      const asserted = panel.getByRole("button", {
        name: new RegExp(
          `open ${TARGET} — ${ANCHOR} depends on ${TARGET}`,
          "i",
        ),
      });
      await expect(asserted).toBeVisible({ timeout: 10_000 });
      await expect(asserted).toHaveAttribute("title", new RegExp(WHY));

      // --- Remove ---
      const removeButton = panel.getByRole("button", {
        name: new RegExp(
          `^Remove link — ${ANCHOR} depends on ${TARGET}$`,
        ),
      });
      await expect(removeButton).toHaveCount(1);
      await removeButton.dispatchEvent("click");

      await expect(asserted).toHaveCount(0, { timeout: 10_000 });
      await expect(panel.getByText(/no curated links yet/i)).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
