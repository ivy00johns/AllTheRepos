/**
 * The vector path, from the specs' side: the provider that makes it reachable,
 * the settings call that aims the app at it, the search call that reads the
 * result, and the log channel the app reports on itself through.
 *
 * `services/embedding.ts` embeds by POSTing `{model, prompt}` to
 * `${settings.ollamaBaseUrl}/api/embeddings` and reading `{embedding: number[]}`.
 * A CI runner has no Ollama and no `OPENAI_API_KEY`, so `embed()` throws before
 * `vectorSearch()` is ever called — which means a spec that wants to exercise
 * the vector *store* has to arrange a provider first, or it exercises the FTS
 * half twice and calls it coverage.
 *
 * The vectors the mock returns are deliberately crude: each token of the prompt
 * bumps one bucket, and the result is normalised, so similarity is token
 * overlap. That is enough to prove plumbing — the query's vector reaches the
 * store, the stored vectors come back, the merge joins and ranks them — and it
 * is *not* a claim about `nomic-embed-text`, which is the model's business.
 * Ranking assertions built on it are statements about the seam, not about search
 * relevance; a spec that wants the latter needs a real model, not this file.
 */

import { createServer } from "node:http";

import type { ConsoleMessage, ElectronApplication, Page } from "@playwright/test";

/**
 * `services/lance.ts` seeds its table with a 768-float row so Arrow has a sample
 * to infer the schema from, and any other length is a dimension error.
 */
export const EMBEDDING_DIM = 768;

/** The warning `hybridSearch` logs when `embed()` fails: the vector path was not reached. */
export const EMBEDDING_UNAVAILABLE = "embedding unavailable; FTS-only";

/** The error `hybridSearch` logs when `vectorSearch()` itself rejects. */
export const VECTOR_PATH_ERROR = "[backend] vector path error";

/** A hit as `catalog:search` returns it. */
export interface SearchHit {
  repo: { name: string; slug: string };
  matchKind: "fts" | "vector" | "hybrid";
  score: number;
  snippet: string | null;
}

/** Search the catalog over the real IPC, the way the renderer does. */
export async function searchCatalog(win: Page, q: string): Promise<SearchHit[]> {
  return win.evaluate(async (query) => {
    const atr = (
      window as unknown as {
        atr: {
          catalog: {
            search(input: { q: string }): Promise<
              Array<{
                repo: { name: string; slug: string };
                matchKind: "fts" | "vector" | "hybrid";
                score: number;
                snippet: string | null;
              }>
            >;
          };
        };
      }
    ).atr;
    return atr.catalog.search({ q: query });
  }, q);
}

/**
 * Nothing listens on port 1 — a privileged port with no service behind it — so
 * this is what "the machine has no Ollama" looks like from `ollamaEmbed`.
 */
export const NO_PROVIDER_URL = "http://127.0.0.1:1";

/**
 * A mock provider: `POST /api/embeddings` → `{ embedding: number[] }`.
 *
 * `requests()` is part of the contract rather than a convenience. A spec that
 * asserts the *absence* of a failure has to show the app got far enough to have
 * one, and the request count is how it says so.
 */
export async function startMockEmbeddings(): Promise<{
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
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    // Read the body before answering: the app writes `{model, prompt}`, and a
    // socket closed under it would surface as a provider failure instead.
    req.on("end", () => {
      let prompt = "";
      try {
        prompt = (JSON.parse(body) as { prompt?: string }).prompt ?? "";
      } catch {
        /* an unreadable body is an empty prompt, which is still an answer */
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ embedding: vectorFor(prompt) }));
    });
  });

  await new Promise<void>((listening) =>
    server.listen(0, "127.0.0.1", () => listening()),
  );
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("[embeddings] the mock embedding server has no port");
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

/** Token overlap, normalised: a crude embedding, and enough for the seam. */
export function vectorFor(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIM).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (const token of tokens) {
    vector[bucket(token)] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
  return vector.map((x) => x / norm);
}

/** FNV-1a, folded into the vector's width. */
function bucket(token: string): number {
  let hash = 2166136261;
  for (const char of token) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % EMBEDDING_DIM;
}

/**
 * Point the app's embedding provider at `url`, the way a person would. Returns
 * what the setting said before and after, so a caller can tell a write from a
 * no-op rather than assuming the app took it.
 */
export async function pointAtProvider(
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

/** Main-process console output, collected for the length of one launch. */
export function collectMainLogs(app: ElectronApplication): string[] {
  const lines: string[] = [];
  app.on("console", (message: ConsoleMessage) => lines.push(message.text()));
  return lines;
}
