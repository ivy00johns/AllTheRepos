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
