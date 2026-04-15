import { getSettings } from "@/lib/db/queries";
import { EmbedUnavailableError, ollamaEmbed } from "./ollama";
import { openaiEmbed } from "./openai";

const MAX_INPUT_CHARS = 2000;

function truncate(s: string): string {
  if (!s) return "";
  return s.length <= MAX_INPUT_CHARS ? s : s.slice(0, MAX_INPUT_CHARS);
}

/**
 * Embed `text` via the first available provider.
 * Priority: Ollama (local) → OpenAI (if OPENAI_API_KEY set) → throw.
 *
 * Callers SHOULD catch EmbedUnavailableError and degrade gracefully.
 */
export async function embed(text: string): Promise<number[]> {
  const input = truncate(text);
  const settings = await getSettings();

  // Try Ollama first.
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

  const apiKey = process.env.OPENAI_API_KEY;
  const model = settings.openaiEmbedModel ?? process.env.OPENAI_EMBED_MODEL ?? "text-embedding-3-small";
  if (apiKey) {
    return openaiEmbed({ apiKey, model, input });
  }

  throw new EmbedUnavailableError(
    "No embedding provider available (Ollama unreachable, no OPENAI_API_KEY)",
  );
}

export { EmbedUnavailableError };
