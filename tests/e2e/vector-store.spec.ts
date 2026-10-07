/**
 * The vector store: that the one this app ships actually works on the machine
 * running it, and that a search which cannot use it says so.
 *
 * This file used to be about an architecture. `@lancedb/lancedb` shipped
 * prebuilt napi bindings per platform with no `darwin-x64` among them past
 * 0.22.3, so the spec asserted that the binding loaded on arm64 and *did not*
 * load on x86_64 — pinning the premise the Intel leg rested on, and pinning the
 * softening in `lance.ts` that kept the app working anyway. That premise is gone:
 * the store is now `services/vector-store.ts`, a `vec0` table inside the app's
 * own SQLite file through the `sqlite-vec` extension, which publishes a binary
 * for every platform this app could ever ship. Both legs of the CI job now run
 * the same expectations because the answer is the same on both.
 *
 * What still needs a gate, and why these two steps are the gate:
 *
 *   1. **The extension loads here.** `getLoadablePath()` resolving is not the
 *      same claim as `dlopen` succeeding, and both are weaker than the SQL
 *      working — so the probe does all three: resolve the path, load it through
 *      the same `better-sqlite3` the app uses, and run a real KNN query in a
 *      throwaway database. A machine where that fails is a machine where
 *      semantic search is off, and this step is what says so out loud instead of
 *      leaving it to a search that quietly returns fewer kinds of match.
 *
 *   2. **With no provider, search answers with keywords and reports why.** A
 *      runner has no Ollama and no `OPENAI_API_KEY`, so this is the state CI is
 *      always in, and the interesting assertion is no longer just "it still
 *      answers" — it is that the response says `semantic: { state: "off",
 *      reason: "no-embedding-provider" }`, which is the field the catalog
 *      renders as a notice. The control that runs first points the app at a
 *      port with nothing on it and requires the app to *say* the provider was
 *      unreachable, in the log channel the later assertion reads: a channel
 *      that had gone quiet would otherwise make "no error was logged" mean "no
 *      error was looked for".
 *
 * `OPENAI_API_KEY` is taken away from the app this spec launches, because
 * `embed()` falls through to OpenAI when Ollama fails and a developer with the
 * key exported would watch the control step succeed at the thing it is supposed
 * to see fail. The provider is restored afterwards.
 *
 * `no-vector-store` — the other `off` reason — cannot be arranged from here
 * without breaking the machine this spec is meant to be testing. It is covered
 * where it can be: `tests/unit/main/services/vector-store-unavailable.spec.ts`.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type ElectronApplication } from "@playwright/test";

import {
  collectMainLogs,
  EMBEDDING_UNAVAILABLE,
  NO_PROVIDER_URL,
  pointAtProvider,
  searchCatalog,
  startMockEmbeddings,
  VECTOR_PATH_ERROR,
} from "./_vector-path";
import { launchApp } from "./_launch-app";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

/** What `_global-setup.ts` seeds, which is the whole catalog every launch sees. */
const SEEDED_REPO_NAMES = ["Demo CLI", "Demo Library", "Demo Web"];

interface StoreProbe {
  arch: string;
  path: string;
  /** Which step failed, and its message. `failure: null` when nothing did. */
  phase: "resolve" | "load" | "query" | null;
  failure: string | null;
  version: string | null;
  /** Distance of the nearest neighbour to its own vector — `0` when the store works. */
  selfDistance: number | null;
}

/**
 * Load the shipped extension the way the app loads it, and query it.
 *
 * `require` and `import()` are both out of reach inside a function Playwright
 * evaluates in the main process — measured: "require is not defined", and "A
 * dynamic import callback was not specified" — so the module system is reached
 * through `process.getBuiltinModule`, which is a property of `process` and
 * therefore in scope. `createRequire` is based at the app's own working
 * directory, so the resolution performed here is the app's own.
 *
 * The probe builds its **own** tiny table rather than the app's: a four-float
 * `vec0` table is enough to prove the extension is functional, and duplicating
 * the real DDL here would be a copy that can drift out of step with
 * `vector-store.ts`. The app's own table is exercised by
 * `semantic-search.spec.ts`, through the app's own scan and search.
 */
async function probeVectorStore(app: ElectronApplication): Promise<StoreProbe> {
  return app.evaluate(() => {
    const { createRequire } = process.getBuiltinModule("node:module");
    const load = createRequire(`${process.cwd()}/e2e-vector-store-probe.cjs`);
    const result = {
      arch: process.arch,
      path: "",
      phase: null as "resolve" | "load" | "query" | null,
      failure: null as string | null,
      version: null as string | null,
      selfDistance: null as number | null,
    };

    /**
     * Run one step, and stop at the first failure with its phase recorded.
     *
     * The phase matters for reading a failure: a bug in this probe and a
     * machine that cannot load the extension produce the same thrown string
     * otherwise, and only one of them is the app's problem. (That is not
     * hypothetical: the first version of this probe inserted with `.all()`
     * instead of `.run()`, and the assertion below reported it as the extension
     * failing to load.)
     */
    const step = <T>(phase: "resolve" | "load" | "query", fn: () => T): T | null => {
      try {
        return fn();
      } catch (error) {
        result.phase = phase;
        result.failure = error instanceof Error ? error.message : String(error);
        return null;
      }
    };

    const sqliteVec = step("resolve", () =>
      load("sqlite-vec") as { getLoadablePath(): string },
    );
    if (!sqliteVec) return result;
    const resolved = step("resolve", () => sqliteVec.getLoadablePath());
    if (resolved === null) return result;
    result.path = resolved;

    const Database = load("better-sqlite3") as new (filename: string) => {
      loadExtension(path: string): void;
      exec(sql: string): void;
      prepare(sql: string): {
        get(): unknown;
        run(...params: unknown[]): unknown;
        all(...params: unknown[]): unknown[];
      };
      close(): void;
    };
    const db = step("load", () => {
      const opened = new Database(":memory:");
      opened.loadExtension(result.path);
      return opened;
    });
    if (!db) return result;

    const version = step("load", () =>
      (db.prepare("SELECT vec_version() AS v").get() as { v: string }).v,
    );
    if (version === null) return result;
    result.version = version;

    const selfDistance = step("query", () => {
      db.exec(
        "CREATE VIRTUAL TABLE probe USING vec0(id INTEGER PRIMARY KEY, v float[4])",
      );
      const at = Buffer.from(new Float32Array([1, 0, 0, 0]).buffer);
      const away = Buffer.from(new Float32Array([0, 1, 0, 0]).buffer);
      const insert = db.prepare("INSERT INTO probe(id, v) VALUES (?, ?)");
      // `run()`, not `all()` — an INSERT returns no rows, and better-sqlite3
      // says so by throwing "This statement does not return data".
      insert.run(BigInt(1), at);
      insert.run(BigInt(2), away);
      const nearest = db
        .prepare("SELECT distance FROM probe WHERE v MATCH ? AND k = ?")
        .all(at, 1) as Array<{ distance: number }>;
      return nearest[0]?.distance ?? null;
    });
    result.selfDistance = selfDistance;
    db.close();
    return result;
  });
}

test.describe("the vector store the app ships", () => {
  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test("loads, on whichever Mac this is, and answers a nearest-neighbour query", async () => {
    const { app, close } = await launchApp();

    try {
      const probe = await probeVectorStore(app);

      expect(
        probe.failure,
        `the vector store probe failed at the "${probe.phase}" step on ` +
          `${probe.arch}: ${probe.failure}. If it read or loaded the shipped ` +
          `sqlite-vec extension, that is the whole of semantic search on this ` +
          `machine — search will still answer, with keywords, and say so.`,
      ).toBeNull();

      expect(
        probe.path,
        "the extension resolved to a path outside the app's own node_modules, " +
          "so this probe is not looking at what the app would load.",
      ).toContain("sqlite-vec");

      expect(
        probe.version,
        "the extension loaded but would not report a version, which means the " +
          "entry point in that file is not vec0.",
      ).toMatch(/^v\d+\.\d+\.\d+/);

      // Distance 0: the stored vector is its own nearest neighbour. Anything
      // else means the extension answered, but not with the vector that was
      // stored beside it.
      expect(
        probe.selfDistance,
        "a stored vector was not its own nearest neighbour, so the extension " +
          "is not really indexing what was written to it.",
      ).toBe(0);
    } finally {
      await close();
    }
  });

  test("with no embedding provider, search answers with keywords and says why", async () => {
    const embeddings = await startMockEmbeddings();
    // `launchApp()` spreads this process's environment into the app, and the
    // control below is only a control where nothing else can answer.
    const openaiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const { app, close } = await launchApp();
    const mainLogs = collectMainLogs(app);

    /** Warnings so far — compared before and after a search, never absolute. */
    const unavailable = () =>
      mainLogs.filter((line) => line.includes(EMBEDDING_UNAVAILABLE)).length;

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });

      // ----- The control: a machine with no provider at all ----------------
      const dead = await pointAtProvider(win, NO_PROVIDER_URL);
      expect(
        dead.after,
        `pointing the provider at ${NO_PROVIDER_URL} left the setting at ` +
          `${dead.after} (was ${dead.before}) — this spec cannot arrange the ` +
          `state it is about.`,
      ).toBe(NO_PROVIDER_URL);

      const warningsBefore = unavailable();
      const deadHits = await searchCatalog(win, "demo");

      expect(
        deadHits.hits.map((hit) => hit.repo.name).sort(),
        `search answered with ${JSON.stringify(deadHits.hits)} while the ` +
          `provider was unreachable — the catalog is ` +
          `${SEEDED_REPO_NAMES.join(", ")}.`,
      ).toEqual(SEEDED_REPO_NAMES);
      expect(
        deadHits.hits.every((hit) => hit.matchKind === "fts"),
        `nothing can have come from the vector store here, but the search ` +
          `returned ${JSON.stringify(deadHits.hits)}.`,
      ).toBe(true);

      // The part that used to be missing: the response says the results are
      // keywords only, and which provider it looked for.
      expect(
        deadHits.semantic.state,
        `the search degraded to keywords without saying so: ` +
          `${JSON.stringify(deadHits.semantic)}.`,
      ).toBe("off");
      expect(
        deadHits.semantic,
        `the search degraded for the wrong reason: ` +
          `${JSON.stringify(deadHits.semantic)}.`,
      ).toMatchObject({ reason: "no-embedding-provider" });
      expect(
        deadHits.semantic.state === "off" ? deadHits.semantic.detail : null,
        "the status carries no provider message, so a user cannot tell a " +
          "misconfigured Ollama URL from a machine that is simply offline.",
      ).toMatch(/\S/);

      expect(
        unavailable(),
        `the app never reported ${EMBEDDING_UNAVAILABLE} against a provider ` +
          `that is not there, so nothing here can tell a quiet vector path ` +
          `from an unwatched one.`,
      ).toBeGreaterThan(warningsBefore);

      // ----- The same fact, through the interface a person uses ------------
      // The IPC assertions above are about the data; this is the delivered
      // behaviour — the search box is driven for real, and the catalog has to
      // tell the user these results are keywords only. In the search box rather
      // than through the hook, because "the response carried the right field"
      // and "a user can see why the results are what they are" are different
      // claims, and only the second one is the feature.
      const box = win.getByRole("searchbox", { name: /search repos/i });
      await box.fill("demo");
      await expect(
        win.getByText(/Keyword matches only/i),
        "the catalog ran a keyword-only search and said nothing about it, " +
          "which is exactly the silent degradation this is meant to end.",
      ).toBeVisible({ timeout: 15_000 });

      // ----- And now a provider that answers, so the vector path runs -------
      const live = await pointAtProvider(win, embeddings.url);
      expect(live.after).toBe(embeddings.url);

      const warningsBeforeLive = unavailable();
      const answered = await searchCatalog(win, "demo");

      expect(
        answered.hits.map((hit) => hit.repo.name).sort(),
        `search answered with ${JSON.stringify(answered.hits)} against a ` +
          `provider at ${embeddings.url}.`,
      ).toEqual(SEEDED_REPO_NAMES);

      // And the notice goes away, without a reload: a different query is a
      // different cache key, so this is a fresh search against the provider
      // that now answers. A notice that only ever appeared — or never went away
      // — would be worse than none.
      await box.fill("demo web");
      await expect(
        win.getByText(/Keyword matches only/i),
        "the catalog still claims semantic search is off while a provider is " +
          "answering it.",
      ).toHaveCount(0);

      // `"vectors"`: the query was embedded and the store was queried. It does
      // not mean a vector *matched* — nothing has been embedded yet in this
      // profile, which is `semantic-search.spec.ts`'s half of the story — only
      // that the half of the pipeline which was off above is now on. That
      // distinction is the one a UI needs, and the reason this field is a state
      // and not a boolean.
      expect(
        answered.semantic,
        `the vector store was reachable and a provider answered, and the ` +
          `search still reported ${JSON.stringify(answered.semantic)}. ` +
          `Requests the mock saw: ${embeddings.requests()}.`,
      ).toEqual({ state: "vectors" });
      expect(embeddings.requests()).toBeGreaterThan(0);
      expect(
        unavailable(),
        `embed() did not reach the provider at ${embeddings.url}, so the ` +
          `vector path was never entered.`,
      ).toBe(warningsBeforeLive);

      // Whatever happened above, the app never had to fall through to its
      // outer catches: the vector path reports, it does not throw.
      expect(
        mainLogs.filter((line) => line.includes(VECTOR_PATH_ERROR)),
        "the vector path threw instead of degrading, so the app survived by " +
          "its outer catches rather than by the guards that are supposed to hold.",
      ).toEqual([]);
    } finally {
      await close();
      await embeddings.stop();
      if (openaiKey !== undefined) process.env.OPENAI_API_KEY = openaiKey;
    }
  });
});
