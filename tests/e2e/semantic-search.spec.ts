/**
 * Semantic search, end to end: a repo is scanned, an embedding is stored, and a
 * search comes back ranked with it.
 *
 * Two halves live in this app and no test had put them together. The write half
 * is `services/embedding.ts`, wired into the scan's `discovered` handler and into
 * `catalog:rescan`; the read half is `services/lance.ts` feeding the RRF merge in
 * `services/search.ts`. The unit specs around them either mock the vector store
 * or mock the write path (`scan-embedding-wiring.spec.ts` asserts the *call*, with
 * `indexRepoEmbedding` stubbed), so nothing had ever written a real vector and
 * read it back through a real search — which is exactly the seam where a
 * dimension mismatch, a slug that disagrees with SQLite, or a merge that drops
 * the vector side would hide, with every gate still green. The audit of
 * 2026-05-31 made the opposite claim ("EMBEDDINGS ARE NEVER WRITTEN"); that was
 * true of the commit it read and is not true of this one, and a claim of this
 * shape deserves a test rather than a grep.
 *
 * This walks the whole path through the app's own surfaces, in the order a person
 * would: run a scan with a provider answering, then search.
 *
 * What makes the result mean something is the profile. Every launch copies the
 * seeded template's SQLite file and settings — and *not* its LanceDB directory
 * (`_launch-app.ts`), which is written per launch and starts empty. So a vector
 * hit below cannot have been inherited, seeded, or left over from another spec:
 * it is a row this run's scan put there. There is no way to pass this file
 * without the app having stored an embedding.
 *
 * It also runs on the Intel leg of the CI job, where the answer is the opposite
 * one: no binding means the scan's write cannot land, so what is pinned there is
 * the *degradation* — the scan completes, the provider is asked, and the search
 * still answers with every hit FTS-only. The expectation is architecture-shaped
 * and both branches run, one per leg, because "this machine has no vector store so
 * we did not look" cannot be told apart from a guard that stopped guarding.
 *
 * What it does not claim: the provider is the mock in `_vector-path.ts`, so the
 * ranking is token overlap by construction. The assertion is about the seam —
 * the query's vector reaches the store, the stored vectors come back, the merge
 * joins them to the right repos — not about the quality of a real model.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  collectMainLogs,
  pointAtProvider,
  searchCatalog,
  startMockEmbeddings,
  VECTOR_PATH_ERROR,
  type SearchHit,
} from "./_vector-path";
import { launchApp, TEMPLATE_PROFILE_ENV } from "./_launch-app";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

/**
 * What `_global-setup.ts` seeds, by the directory each repo is created in.
 *
 * These are the names to assert on *after a scan*, not the display names the
 * seeder writes into the database. `readRepoMetadata` names a repo after the
 * directory it lives in, so a scan of these three replaces `Demo Web` with
 * `demo-web` — and that is the metadata path a real user's scan takes too, which
 * is why the seeded rows are only the starting point here.
 */
const SEEDED_REPO_DIRS = ["demo-cli", "demo-library", "demo-web"] as const;

/**
 * The parent of the seeded repos — a directory of three real git repos, which is
 * what a scan is pointed at. Scanning is the app's own first write path: the
 * worker discovers, `upsertRepo` indexes for FTS, and the embedding follows
 * fire-and-forget.
 */
function seededLibraryDir(): string {
  const template = process.env[TEMPLATE_PROFILE_ENV];
  if (!template) {
    throw new Error(
      `[semantic-search] ${TEMPLATE_PROFILE_ENV} is unset — run this spec through Playwright so _global-setup.ts can build the seeded profile.`,
    );
  }
  const dir = join(dirname(template), "repos");
  if (!existsSync(dir)) {
    throw new Error(`[semantic-search] no seeded repos under ${dir}`);
  }
  return dir;
}

interface ScanStatus {
  jobId: string;
  status: "running" | "done" | "error" | "cancelled" | "unknown";
  processed: number;
  total: number;
  errorMessage: string | null;
}

/** Drive a scan of `paths` to completion, through the IPC the UI uses. */
async function scanToCompletion(win: Page, paths: string[]): Promise<ScanStatus> {
  const started = await win.evaluate(
    async (targets) =>
      (
        window as unknown as {
          atr: {
            scan: {
              start(input: { paths: string[] }): Promise<{ jobId: string }>;
            };
          };
        }
      ).atr.scan.start({ paths: targets }),
    paths,
  );

  const readStatus = (): Promise<ScanStatus> =>
    win.evaluate(
      async (jobId) =>
        (
          window as unknown as {
            atr: {
              scan: { status(input: { jobId: string }): Promise<ScanStatus> };
            };
          }
        ).atr.scan.status({ jobId }),
      started.jobId,
    );

  await expect
    .poll(async () => (await readStatus()).status, {
      timeout: 45_000,
      message: "the scan never reached \"done\"",
    })
    .toBe("done");

  // Read once more rather than smuggling the value out of the poll: what this
  // returns is the finished state, and the caller asserts on it.
  return readStatus();
}

test.describe("semantic search, after a scan writes the vectors", () => {
  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test("a scan stores an embedding per repo, and a search comes back ranked with them", async () => {
    const embeddings = await startMockEmbeddings();
    // `launchApp()` spreads this process's environment into the app; a stray
    // key would let `embed()` reach a second provider and hide this one.
    const openaiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const { app, close } = await launchApp();
    const mainLogs = collectMainLogs(app);

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });

      const aimed = await pointAtProvider(win, embeddings.url);
      expect(
        aimed.after,
        `the provider setting is ${aimed.after} (was ${aimed.before}), so this ` +
          `test would be measuring the wrong thing.`,
      ).toBe(embeddings.url);

      // ----- The write half: a scan, with a provider answering -------------
      const status = await scanToCompletion(win, [seededLibraryDir()]);

      expect(
        status.errorMessage,
        `the scan finished with an error: ${status.errorMessage}`,
      ).toBeNull();
      expect(
        status.processed,
        `the scan found ${status.processed} of the seeded repos — the fixture ` +
          `is ${SEEDED_REPO_DIRS.join(", ")}.`,
      ).toBe(SEEDED_REPO_DIRS.length);
      // True on both architectures, and that is the point: the app asks for an
      // embedding before it tries to store one, so on x86_64 the request goes out
      // and the write is what fails.
      expect(
        embeddings.requests(),
        "the scan wrote nothing for the provider to embed",
      ).toBeGreaterThan(0);

      // ----- ... and the read half, which is architecture-shaped -------------
      // LanceDB publishes a binding for one of the two architectures a Mac comes
      // in (`tests/e2e/vector-store.spec.ts` asserts which, on both legs). On a
      // Mac that has one, the scan's embeddings land and the search ranks with
      // them. On x86_64 they cannot be stored at all — and what is pinned there is
      // the documented degradation instead: the scan completes, the provider is
      // asked, and a search still answers, FTS-only. Both branches run on every
      // run, one per leg; neither is a skip.
      const arch = await app.evaluate(() => process.arch);
      const storesVectors = arch === "arm64";

      let hits: SearchHit[] = [];
      if (storesVectors) {
        // Fire-and-forget means the writes may still be in flight when `done`
        // arrives, so this waits for the effect rather than assuming it.
        await expect
          .poll(
            async () => {
              hits = await searchCatalog(win, "demo");
              return hits.filter((hit) => hit.matchKind !== "fts").length;
            },
            {
              timeout: 30_000,
              message:
                "no search hit ever came from the vector store: the scan's " +
                "embeddings are not in the table, or the merge is not finding them",
            },
          )
          .toBe(SEEDED_REPO_DIRS.length);
      } else {
        hits = await searchCatalog(win, "demo");
      }

      // Every seeded repo is a hit, exactly once. `hybrid` and not `vector` on
      // purpose: all three repos match the FTS query too, so on a Mac with a
      // vector store a repo that came back `fts` is a repo whose vector was not
      // stored — or whose stored slug disagrees with SQLite's, which is the
      // failure a duplicate row here would reveal. On x86_64 the same query has
      // to come back `fts` for every one of them, because there is nothing that
      // could have put a vector beside it.
      const expectedKind = storesVectors ? "hybrid" : "fts";
      expect(
        hits
          .map((hit) => ({ name: hit.repo.name, kind: hit.matchKind }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        `search for "demo" returned ${JSON.stringify(hits)} on ${arch}`,
      ).toEqual(
        [...SEEDED_REPO_DIRS]
          .sort((a, b) => a.localeCompare(b))
          .map((name) => ({ name, kind: expectedKind })),
      );

      if (storesVectors) {
        // The ranking half, such as the mock can honestly support it: the mock's
        // vectors are token overlap, so a query naming one repo must put that repo
        // first rather than merely including it.
        const ranking = await searchCatalog(win, "demo web");
        expect(
          ranking[0]?.repo.name,
          `"demo web" ranked ${JSON.stringify(ranking.map((hit) => hit.repo.name))}`,
        ).toBe("demo-web");
      }

      // And the app never had to say the vector path went wrong: the failure
      // this whole feature is one `catch` away from.
      expect(
        mainLogs.filter((line) => line.includes(VECTOR_PATH_ERROR)),
        "the vector path threw somewhere during the scan or the search",
      ).toEqual([]);
    } finally {
      await close();
      await embeddings.stop();
      if (openaiKey !== undefined) process.env.OPENAI_API_KEY = openaiKey;
    }
  });
});
