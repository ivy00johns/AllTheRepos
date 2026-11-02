/**
 * Finding a repo by the site it serves, through the running app: a real scan on
 * the worker thread reads `wrangler.jsonc`, and a URL typed into the catalog's
 * search box comes back with the repo serving it.
 *
 * The unit specs write `deploy_text` straight into the database. This is the path
 * they cannot see: worker to main over `postMessage`, then the upsert, then the
 * search box. The decoy is the point. It is named after the site and its README
 * says so, and it is the only repo a search could find before this existed.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { launchApp } from "./_launch-app";

const LIVE_URL = "https://e2e-live-site.some-account.workers.dev";

function makeRepo(
  root: string,
  name: string,
  files: Record<string, string>,
): void {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [file, text] of Object.entries(files)) {
    writeFileSync(join(dir, file), text);
  }
}

test("a live URL finds the repo that serves it, not the one named after it", async () => {
  const root = mkdtempSync(join(tmpdir(), "atr-deploy-search-"));
  makeRepo(root, "plain-named-server", {
    "wrangler.jsonc": `{\n  // the live site\n  "name": "e2e-live-site",\n}\n`,
  });
  makeRepo(root, "e2e-live-site-decoy", {
    "README.md": "# e2e-live-site\n\nThe old e2e-live-site landing page.\n",
  });

  const { app, close } = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await expect(win.getByRole("link", { name: /^AllTheRepos$/i })).toBeVisible(
      {
        timeout: 15_000,
      },
    );

    const finished = await win.evaluate(
      async (paths) => {
        const { scan } = (
          window as unknown as {
            atr: {
              scan: {
                start(input: { paths: string[] }): Promise<{ jobId: string }>;
                status(input: { jobId: string }): Promise<{ status: string }>;
              };
            };
          }
        ).atr;
        const { jobId } = await scan.start({ paths });
        for (let i = 0; i < 180; i++) {
          const { status } = await scan.status({ jobId });
          if (status !== "running") return status;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return "timed out";
      },
      [root],
    );
    expect(finished).toBe("done");

    const searchBox = win.getByRole("searchbox", { name: /search repos/i });
    const main = win.locator("main");

    await searchBox.fill(LIVE_URL);
    await expect(main.getByText("plain-named-server").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(main.getByText("e2e-live-site-decoy")).toHaveCount(0);

    // The bare word finds both, with the repo serving it first.
    await searchBox.fill("e2e-live-site");
    await expect(main.getByText("e2e-live-site-decoy").first()).toBeVisible({
      timeout: 10_000,
    });
    const hits = await win.evaluate(
      async (q) =>
        (
          window as unknown as {
            atr: {
              catalog: {
                search(input: {
                  q: string;
                }): Promise<{ hits: Array<{ repo: { name: string } }> }>;
              };
            };
          }
        ).atr.catalog.search({ q }),
      "e2e-live-site",
    );
    expect(hits.hits[0]?.repo.name).toBe("plain-named-server");
  } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
});
