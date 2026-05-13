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

import { getSettings } from "./settings";

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
export async function ollamaEmbed(
  opts: OllamaEmbedOptions,
): Promise<number[]> {
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

export async function openaiEmbed(
  opts: OpenAIEmbedOptions,
): Promise<number[]> {
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
      `OpenAI unreachable: ${
        err instanceof Error ? err.message : String(err)
      }`,
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
