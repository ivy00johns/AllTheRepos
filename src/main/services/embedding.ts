/**
 * Embedding service — provider-agnostic text → vector dispatch.
 *
 * Port of `lib/embed/client.ts` + `lib/embed/ollama.ts` + `lib/embed/openai.ts`,
 * collapsed into a single module. Provider choice lives in `settings.json`
 * (per `contracts/data-layer.v1.md`):
 *   1. Ollama (local)            — `ollamaBaseUrl` + `ollamaEmbedModel`
 *   2. OpenAI (cloud fallback)    — requires `OPENAI_API_KEY` env var
 *
 * Callers SHOULD catch {@link EmbedUnavailableError} and degrade gracefully.
 * `SearchService.hybridSearch` does this — when embeddings are unreachable
 * the result set still comes back from FTS5.
 */

import crypto from "node:crypto";

import { getSettings } from "./settings";
import { getEmbeddingContentHash, upsertEmbedding } from "./vector-store";

const MAX_INPUT_CHARS = 2000;

function truncate(s: string): string {
  if (!s) return "";
  return s.length <= MAX_INPUT_CHARS ? s : s.slice(0, MAX_INPUT_CHARS);
}

export class EmbedUnavailableError extends Error {
  constructor(message = "Embedding provider unavailable") {
    super(message);
    this.name = "EmbedUnavailableError";
  }
}

export interface OllamaEmbedOptions {
  baseUrl: string;
  model: string;
  input: string;
}

/**
 * POST to {baseUrl}/api/embeddings with {model, prompt}.
 * Throws EmbedUnavailableError on connection refused / network failure.
 */
export async function ollamaEmbed(opts: OllamaEmbedOptions): Promise<number[]> {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/api/embeddings`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: opts.model, prompt: opts.input }),
    });
  } catch (err) {
    throw new EmbedUnavailableError(
      `Ollama unreachable at ${opts.baseUrl}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!res.ok) {
    throw new EmbedUnavailableError(
      `Ollama returned ${res.status}: ${await res.text().catch(() => "")}`,
    );
  }
  const body = (await res.json()) as { embedding?: number[] };
  if (!body.embedding || !Array.isArray(body.embedding)) {
    throw new EmbedUnavailableError("Ollama response missing embedding");
  }
  return body.embedding;
}

export interface OpenAIEmbedOptions {
  apiKey: string;
  model: string;
  input: string;
}

export async function openaiEmbed(opts: OpenAIEmbedOptions): Promise<number[]> {
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({ model: opts.model, input: opts.input }),
    });
  } catch (err) {
    throw new EmbedUnavailableError(
      `OpenAI unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new EmbedUnavailableError(
      `OpenAI returned ${res.status}: ${await res.text().catch(() => "")}`,
    );
  }
  const body = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const vec = body.data?.[0]?.embedding;
  if (!vec || !Array.isArray(vec)) {
    throw new EmbedUnavailableError("OpenAI response missing embedding");
  }
  return vec;
}

/**
 * Embed `text` via the first available provider.
 * Priority: Ollama (local) → OpenAI (if OPENAI_API_KEY set) → throw.
 */
export async function embed(text: string): Promise<number[]> {
  const input = truncate(text);
  const settings = getSettings();

  // 1. Try Ollama first.
  try {
    return await ollamaEmbed({
      baseUrl: settings.ollamaBaseUrl,
      model: settings.ollamaEmbedModel,
      input,
    });
  } catch (err) {
    if (!(err instanceof EmbedUnavailableError)) throw err;
    // fall through to OpenAI
  }

  // 2. OpenAI fallback.
  const apiKey = process.env.OPENAI_API_KEY;
  const model =
    settings.openaiEmbedModel ??
    process.env.OPENAI_EMBED_MODEL ??
    "text-embedding-3-small";
  if (apiKey) {
    return openaiEmbed({ apiKey, model, input });
  }

  throw new EmbedUnavailableError(
    "No embedding provider available (Ollama unreachable, no OPENAI_API_KEY)",
  );
}

// ---------------------------------------------------------------------------
// Embedding write-path (ATR-018)
// ---------------------------------------------------------------------------

/**
 * Minimal repo shape needed to build the embedding text + content-hash gate.
 * Maps onto the fields a scanned/rescanned repo already carries.
 */
export interface EmbeddableRepo {
  repoId: number;
  slug: string;
  name: string;
  description: string | null;
  readmeContent: string | null;
}

/**
 * The semantic-search embedding text for a repo: name + description + readme,
 * joined with blank lines and trimmed. The downstream {@link embed} call
 * truncates to {@link MAX_INPUT_CHARS}.
 */
export function buildEmbeddingText(repo: {
  name: string;
  description: string | null;
  readmeContent: string | null;
}): string {
  return [repo.name, repo.description ?? "", repo.readmeContent ?? ""]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * `sha256` of a string. Stable digest used to gate re-embedding.
 */
function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * `sha256(readme ?? "")` — kept for callers/tests that reason about the README
 * hash specifically (it matches `metadata.ts`'s `readme_hash` convention).
 */
export function readmeContentHash(readmeContent: string | null): string {
  return sha256(readmeContent ?? "");
}

/**
 * The content-hash that gates re-embedding. Hashes the FULL embedding input
 * (name + description + readme, via {@link buildEmbeddingText}) — not the README
 * alone — so a name- or description-only change still triggers a re-embed.
 * (The earlier readme-only gate would keep a stale vector when, e.g., a
 * `package.json` description changed but the README did not.)
 *
 * The hash covers a superset of what `embed()` actually sends (which truncates
 * to {@link MAX_INPUT_CHARS}), so the invariant holds: we never SKIP when the
 * embedded content changed; at worst we re-embed when only the truncated tail
 * differs (a harmless extra embed, never a stale skip).
 */
export function embeddingContentHash(repo: {
  name: string;
  description: string | null;
  readmeContent: string | null;
}): string {
  return sha256(buildEmbeddingText(repo));
}

export type IndexEmbeddingOutcome =
  | "embedded"
  | "skipped-unchanged"
  | "skipped-unavailable";

/**
 * Compute + store the semantic-search embedding for one repo, gated on the
 * embedding-input content hash.
 *
 * Contract:   *   - Only re-embeds when {@link embeddingContentHash} (name + description +
   *     readme) differs from the hash stored alongside the existing vector row
   *     (returns `"skipped-unchanged"` when equal).
 *   - The embedding provider (Ollama / OpenAI) may be DOWN. A failed `embed()`
 *     is logged and SWALLOWED — this function NEVER throws. The scan/rescan
 *     path that calls it must complete (and the repo must still be FTS-indexed)
 *     regardless of embedding availability. Returns `"skipped-unavailable"`.
 *
 * Returns the outcome for observability/testing; callers may ignore it.
 */
export async function indexRepoEmbedding(
  repo: EmbeddableRepo,
): Promise<IndexEmbeddingOutcome> {
  const contentHash = embeddingContentHash(repo);

  // 1. Content-hash gate — skip the (expensive) embed + vector upsert when the
  //    embedding input (name + description + readme) is unchanged since the
  //    last successful embed.
  try {
    const prior = getEmbeddingContentHash(repo.repoId);
    if (prior !== null && prior === contentHash) {
      return "skipped-unchanged";
    }
  } catch (err) {
    // A failed gate read must not block (or fail) the scan — fall through and
    // attempt to (re)embed; the embed step is itself failure-tolerant.
    console.warn(
      "[backend] embedding content-hash read failed; will attempt re-embed",
      err instanceof Error ? err.message : String(err),
    );
  }

  // 2. Compute the vector. Ollama/OpenAI may be unreachable (it is on this
  //    machine) — log and skip; the scan still completes and FTS still works.
  let vector: number[];
  try {
    vector = await embed(buildEmbeddingText(repo));
  } catch (err) {
    if (err instanceof EmbedUnavailableError) {
      console.warn(
        `[backend] embedding unavailable for ${repo.slug}; skipping vector index (FTS-only)`,
        err.message,
      );
    } else {
      console.error(
        `[backend] unexpected embedding error for ${repo.slug}; skipping vector index`,
        err,
      );
    }
    return "skipped-unavailable";
  }

  // 3. Store. A vector-store write failure is non-fatal to the scan as well —
  //    the repo is already FTS-indexed, which is what the scan is for.
  try {
    upsertEmbedding({
      repo_id: repo.repoId,
      slug: repo.slug,
      vector,
      content_hash: contentHash,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(
      `[backend] embedding upsert failed for ${repo.slug}; FTS unaffected`,
      err,
    );
    return "skipped-unavailable";
  }

  return "embedded";
}
