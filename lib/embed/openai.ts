import { EmbedUnavailableError } from "./ollama";

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
