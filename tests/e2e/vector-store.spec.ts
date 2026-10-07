/**
 * The vector store, on the architecture that has one and the one that does not.
 *
 * `@lancedb/lancedb` ships prebuilt napi bindings per platform and there is no
 * darwin-x64 among them — the fact `scripts/check-platforms.mjs` reports from
 * package metadata. Metadata is not the app, though. What an Intel Mac does
 * about the missing binding is `services/lance.ts`'s business, and it fails soft
 * on purpose: `vectorSearch` resolves to `[]` instead of rejecting, so the loss
 * is a quieter search rather than an error. Three nested catches stand between
 * that and a visible failure (`lance.ts`, `hybridSearch`, the IPC layer), which
 * is why nothing in this repository would go red if the innermost one were
 * deleted — the one that has to work on x86_64 and nowhere else.
 *
 * So this spec is the gate, and it runs on **both** legs of the CI job rather
 * than only the Intel one, so neither expectation can rot:
 *
 *   1. the app's own main process loads the binding exactly on the architecture
 *      LanceDB publishes one for. On x86_64 it does not — the premise the whole
 *      Intel leg rests on, asserted here instead of assumed;
 *   2. with an embedding provider answering, and the vector path therefore
 *      genuinely entered, search still returns the catalog and the app still
 *      degrades the way it was written to: FTS-only hits, and no error out of
 *      the vector path. That second half is `lance.ts`'s own `catch` doing its
 *      job. Remove it and the Intel leg goes red on `[backend] vector path
 *      error`, which is the only machine where that is observable — verified by
 *      removing it and watching this file fail while the app reported x86_64.
 *
 * The mock provider is not decoration, and neither is the control that runs
 * first. Without a provider `embed()` throws, `vectorSearch` is never reached,
 * and this spec would pass on Intel for a reason that has nothing to do with
 * Intel — so the control search points the app at a port with nothing on it and
 * requires the app to *say* so, in the same log channel the later assertion
 * reads. A quiet channel would otherwise make "no error was logged" mean "no
 * error was looked for"; `ci.yml`'s refusal job exists for the same reason.
 *
 * That control is only a control in an environment with no second provider, so
 * `OPENAI_API_KEY` is taken away from the app this spec launches: `embed()`
 * falls through to OpenAI when Ollama fails, and a developer who has the key
 * exported would otherwise watch the app succeed at the step that is supposed
 * to fail.
 *
 * Nor is there a skip on the arm64 leg. "This machine had no binary, so we
 * didn't look" cannot be told apart from a guard that stopped guarding: both
 * branches below run on every run, one per leg.
 */

import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  expect,
  test,
  type ConsoleMessage,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

import { launchApp } from "./_launch-app";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

/**
 * `services/lance.ts` seeds its table with a 768-float row to give Arrow a
 * sample, so a query vector of any other length is a dimension error — on the
 * arm64 leg, where the binding is real and the query is actually run.
 */
const EMBEDDING_DIM = 768;

/** What `_global-setup.ts` seeds, which is the whole catalog every launch sees. */
const SEEDED_REPO_NAMES = ["Demo CLI", "Demo Library", "Demo Web"];

/** The vector path's own failure log, and the warning that says it wasn't reached. */
const VECTOR_PATH_ERROR = "[backend] vector path error";
const EMBEDDING_UNAVAILABLE = "embedding unavailable; FTS-only";

/**
 * Nothing listens on port 1 — a privileged port with no service behind it — so
 * this is what "the machine has no Ollama" looks like from `ollamaEmbed`.
 */
const NO_PROVIDER_URL = "http://127.0.0.1:1";

/**
 * Whether the app's runtime can load the vector store, and on what architecture
 * it tried.
 *
 * `require` and `import()` are both out of reach inside a function Playwright
 * evaluates in the main process — measured: "require is not defined", and "A
 * dynamic import callback was not specified" — so the module system is reached
 * through `process.getBuiltinModule`, which is a property of `process` and
 * therefore in scope. What it then loads through is napi-rs's own loader,
 * untouched by this file: it picks a platform package from `process.arch` and
 * throws when there is no such package, which is what an Intel Mac gets.
 */
async function loadVectorStore(
  app: ElectronApplication,
): Promise<{ arch: string; binding: string }> {
  return app.evaluate(() => {
    const { createRequire } = process.getBuiltinModule("node:module");
    // Based at the app's own working directory: `createRequire` resolves from a
    // file, and the resolution that matters is the one the app performs.
    const load = createRequire(`${process.cwd()}/e2e-vector-store-probe.cjs`);
    try {
      load("@lancedb/lancedb");
      return { arch: process.arch, binding: "loaded" };
    } catch (error) {
      return {
        arch: process.arch,
        binding: `threw: ${(error as Error).message}`,
      };
    }
  });
}

/**
 * Main-process console output, collected for the length of one launch. The app's
 * own logging is the only place the vector path reports on itself, and both
 * lines this spec looks for are written there.
 */
function collectMainLogs(app: ElectronApplication): string[] {
  const lines: string[] = [];
  app.on("console", (message: ConsoleMessage) => lines.push(message.text()));
  return lines;
}

/**
 * Point the app's embedding provider at `url`, the way a person would. Returns
 * what the setting said before and after, so a caller can tell a write from a
 * no-op rather than assuming the app took it.
 */
async function pointAtProvider(
  win: Page,
  url: string,
): Promise<{ before: string; after: string }> {
  return win.evaluate(async (baseUrl) => {
    const atr = (
      window as unknown as {
        atr: {
          settings: {
            get(): Promise<{ ollamaBaseUrl: string }>;
            update(patch: {
              ollamaBaseUrl: string;
            }): Promise<{ ollamaBaseUrl: string }>;
          };
        };
      }
    ).atr;
    const before = await atr.settings.get();
    const updated = await atr.settings.update({ ollamaBaseUrl: baseUrl });
    return { before: before.ollamaBaseUrl, after: updated.ollamaBaseUrl };
  }, url);
}

/** Search the catalog over the real IPC, the way the renderer does. */
async function searchCatalog(
  win: Page,
  q: string,
): Promise<Array<{ repo: { name: string }; matchKind: string }>> {
  return win.evaluate(async (query) => {
    const atr = (
      window as unknown as {
        atr: {
          catalog: {
            search(input: { q: string }): Promise<
              Array<{ repo: { name: string }; matchKind: string }>
            >;
          };
        };
      }
    ).atr;
    return atr.catalog.search({ q: query });
  }, q);
}

/**
 * A stand-in for Ollama, answering the one request `ollamaEmbed` makes:
 * `POST /api/embeddings` → `{ embedding: number[] }`. It exists to make
 * `embed()` succeed so the vector path is entered — nothing is asserted about
 * the vector it returns, only that the app asked for one.
 */
async function startMockEmbeddings(): Promise<{
  url: string;
  requests: () => number;
  stop: () => Promise<void>;
}> {
  let requests = 0;
  const server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/api/embeddings")) {
      res.writeHead(404).end();
      return;
    }
    requests += 1;
    // Drain the body before answering: the app writes `{model, prompt}`, and a
    // socket closed under it would surface as a provider failure instead.
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ embedding: vector() }));
    });
  });

  await new Promise<void>((listening) =>
    server.listen(0, "127.0.0.1", () => listening()),
  );
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("[vector-store] the mock embedding server has no port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests: () => requests,
    stop: () =>
      new Promise<void>((closed) => {
        server.closeAllConnections();
        server.close(() => closed());
      }),
  };
}

/** A deterministic 768-float vector — the shape, not the meaning, is the point. */
function vector(): number[] {
  return Array.from({ length: EMBEDDING_DIM }, (_, i) => ((i % 13) - 6) / 6);
}

test.describe("the vector store, and what the app does without it", () => {
  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test("the LanceDB binding loads exactly where a binary for it is published", async () => {
    const { app, close } = await launchApp();

    try {
      const probe = await loadVectorStore(app);

      expect(
        ["arm64", "x64"],
        `the app's runtime reports ${probe.arch}, and this spec is about the two ` +
          `architectures macOS comes in — a third branch here would be a hole, ` +
          `not a pass.`,
      ).toContain(probe.arch);

      if (probe.arch === "arm64") {
        expect(
          probe.binding,
          "the binding did not load on arm64, where `@lancedb/lancedb` publishes " +
            "one — that is a broken install rather than a fact about the platform.",
        ).toBe("loaded");
      } else {
        expect(
          probe.binding,
          `This is an x86_64 Mac and the binding loaded anyway (${probe.binding}). ` +
            "The Intel leg assumes there is no vector store here: if LanceDB now " +
            "publishes a darwin-x64 binary, that is good news, and both the note " +
            "in `pnpm platforms:check` and the search assertion below need to " +
            "hear it — shipping for Intel just stopped costing semantic search.",
        ).not.toBe("loaded");
      }
    } finally {
      await close();
    }
  });

  test("with no vector store, search answers and the vector path's failure never escapes", async () => {
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

      const arch = await app.evaluate(() => process.arch);

      // ----- The control: a machine with no provider at all ----------------
      // This is the state a runner is in. It must produce the warning, because
      // that is what makes the assertion further down mean anything: a log
      // channel that quietly stopped carrying main-process output would make
      // "no error was logged" indistinguishable from "no error was looked for".
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
        deadHits.map((hit) => hit.repo.name).sort(),
        `search answered with ${JSON.stringify(deadHits)} while the provider was ` +
          `unreachable — the catalog is ${SEEDED_REPO_NAMES.join(", ")}.`,
      ).toEqual(SEEDED_REPO_NAMES);
      expect(
        unavailable(),
        `the app never reported ${EMBEDDING_UNAVAILABLE} against a provider that ` +
          `is not there, so nothing below can tell a quiet vector path from an ` +
          `unwatched one.`,
      ).toBeGreaterThan(warningsBefore);

      // ----- And now a provider that answers, so the vector path runs -------
      const live = await pointAtProvider(win, embeddings.url);
      expect(live.after).toBe(embeddings.url);

      const warningsBeforeLive = unavailable();
      const hits = await searchCatalog(win, "demo");

      expect(
        hits.map((hit) => hit.repo.name).sort(),
        `search answered with ${JSON.stringify(hits)} against a provider at ` +
          `${embeddings.url}.`,
      ).toEqual(SEEDED_REPO_NAMES);

      // No *new* warning: `embed()` reached the provider, which means the vector
      // path was entered rather than skipped. This is the difference between
      // exercising Intel's missing binding and exercising FTS twice.
      expect(
        unavailable(),
        `embed() did not reach the provider at ${embeddings.url}, so the vector ` +
          `path was never entered. Requests the mock saw: ${embeddings.requests()}.`,
      ).toBe(warningsBeforeLive);
      expect(embeddings.requests()).toBeGreaterThan(0);

      // ----- The assertion with teeth --------------------------------------
      // On an x86_64 Mac this is `lance.ts`'s own `catch` around a binding that
      // cannot load. Without it the rejection lands in `hybridSearch`'s catch,
      // one frame further out, and is logged exactly here.
      expect(
        mainLogs.filter((line) => line.includes(VECTOR_PATH_ERROR)),
        `The vector path threw instead of degrading, so the app survived by its ` +
          `outer catches rather than by the one Intel depends on.`,
      ).toEqual([]);

      if (arch === "x64") {
        // No binding means no vector hits, whatever the provider returns.
        expect(
          hits.filter((hit) => hit.matchKind !== "fts"),
          `Nothing can have come from a vector search on this machine: ` +
            `${JSON.stringify(hits)}`,
        ).toEqual([]);
      }
    } finally {
      await close();
      await embeddings.stop();
      if (openaiKey !== undefined) process.env.OPENAI_API_KEY = openaiKey;
    }
  });
});
