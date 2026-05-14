/**
 * Claude session JSONL parser + transcript chunk reader.
 *
 * `~/.claude/projects/<hash>/<sessionId>.jsonl` is the per-session
 * append-only log emitted by Claude Code. Each line is a JSON event
 * with a varying shape; the only stable fields we rely on are:
 *
 *   - `timestamp`         — ISO-8601 string on most events.
 *   - `message?.usage`    — `{ input_tokens, output_tokens, ... }` on
 *                           assistant turns.
 *   - `type`              — string discriminator (`user` / `assistant`
 *                           / `system` / etc.) used only to ignore
 *                           system events for timestamp extraction.
 *
 * Token-usage / timestamp extraction is best-effort. Malformed lines
 * are silently skipped — Claude Code's wire format is not a stable
 * public schema (per `contracts/ipc.v3b.md` "Domain rules").
 */

import { createInterface } from "node:readline";
import fs from "node:fs";

import type { ClaudeSession, TokenUsage, TranscriptEvent } from "@shared/types";
import { TranscriptEventSchema } from "@shared/schemas";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SessionMetadata {
  startedAt: string | null;
  lastActivityAt: string | null;
  messageCount: number;
  tokenUsage: TokenUsage;
}

export interface TranscriptChunk {
  events: TranscriptEvent[];
  nextCursor: number | null;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRANSCRIPT_MAX_BYTES_CAP = 262_144; // 256 KB
const TRANSCRIPT_DEFAULT_BYTES = 65_536; // 64 KB

// ---------------------------------------------------------------------------
// Token usage helpers
// ---------------------------------------------------------------------------

export function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
  };
}

/**
 * Accumulate an event's `message.usage` block into `acc`. Returns
 * true when a usage block was actually applied so the caller can
 * count "messages with usage" if it wants to.
 */
export function accumulateUsage(
  acc: TokenUsage,
  event: Record<string, unknown> | null | undefined,
): boolean {
  if (!event || typeof event !== "object") return false;
  const message = (event as { message?: unknown }).message;
  if (!message || typeof message !== "object") return false;
  const usage = (message as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return false;

  const u = usage as Record<string, unknown>;
  const input = numOr0(u.input_tokens);
  const output = numOr0(u.output_tokens);
  const cacheCreate = numOr0(u.cache_creation_input_tokens);
  const cacheRead = numOr0(u.cache_read_input_tokens);

  acc.inputTokens += input;
  acc.outputTokens += output;
  acc.cacheCreationInputTokens += cacheCreate;
  acc.cacheReadInputTokens += cacheRead;
  acc.totalTokens += input + output + cacheCreate + cacheRead;
  return true;
}

function numOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

// ---------------------------------------------------------------------------
// parseSessionMetadata
// ---------------------------------------------------------------------------

/**
 * Walk a JSONL session file line by line and produce its rolled-up
 * metadata (timestamps + token totals + message count).
 *
 * Memory-bounded via readline streaming — files up to tens of MB
 * scan in well under a second. We always read the whole file for
 * accurate token aggregation; large files (>5 MB) only occur on
 * marathon sessions and are still cheap to scan once.
 */
export async function parseSessionMetadata(
  filePath: string,
): Promise<SessionMetadata> {
  const tokenUsage = emptyTokenUsage();
  let startedAt: string | null = null;
  let lastActivityAt: string | null = null;
  let messageCount = 0;

  let stream: fs.ReadStream;
  try {
    stream = fs.createReadStream(filePath, { encoding: "utf8" });
  } catch (err) {
    console.warn(`[claude] failed to open session file ${filePath}:`, err);
    return {
      startedAt: null,
      lastActivityAt: null,
      messageCount: 0,
      tokenUsage,
    };
  }

  // Catch stream-level errors so a missing/unreadable file doesn't
  // crash the boot loop.
  const errorPromise = new Promise<void>((resolve) => {
    stream.once("error", (err) => {
      console.warn(`[claude] stream error on ${filePath}:`, err);
      resolve();
    });
  });

  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    await Promise.race([
      (async () => {
        for await (const line of rl) {
          if (!line) continue;
          messageCount += 1;
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          if (!parsed || typeof parsed !== "object") continue;
          const obj = parsed as Record<string, unknown>;

          // Timestamps — first/last event carrying a `timestamp` string.
          const ts = obj.timestamp;
          if (typeof ts === "string" && ts.length > 0) {
            if (startedAt === null) startedAt = ts;
            lastActivityAt = ts;
          }

          // Token usage — always check; assistant turns carry this.
          accumulateUsage(tokenUsage, obj);
        }
      })(),
      errorPromise,
    ]);
  } finally {
    rl.close();
    stream.destroy();
  }

  // mtime fallback for lastActivityAt only — startedAt has no sensible
  // fallback because the file mtime is also when it was last written.
  if (lastActivityAt === null) {
    try {
      const stats = fs.statSync(filePath);
      lastActivityAt = stats.mtime.toISOString();
    } catch {
      // best-effort — leave null
    }
  }

  return { startedAt, lastActivityAt, messageCount, tokenUsage };
}

// ---------------------------------------------------------------------------
// readTranscriptChunk
// ---------------------------------------------------------------------------

/**
 * Read a chunk of one session JSONL file starting at byte offset
 * `cursor`. Reads up to `maxBytes` then continues until the next
 * newline so events are never split mid-JSON.
 *
 * Returns:
 *   - `events`      — Zod-passthrough-validated transcript events.
 *   - `nextCursor`  — next byte offset to read from, or null at EOF.
 *   - `hasMore`     — `nextCursor !== null`.
 *
 * Defensive: malformed lines are silently skipped (`try/catch` around
 * `JSON.parse`); missing files return an empty chunk with EOF.
 */
export async function readTranscriptChunk(
  filePath: string,
  cursor = 0,
  maxBytes: number = TRANSCRIPT_DEFAULT_BYTES,
): Promise<TranscriptChunk> {
  const capped = Math.min(Math.max(maxBytes, 1024), TRANSCRIPT_MAX_BYTES_CAP);

  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return { events: [], nextCursor: null, hasMore: false };
  }

  if (cursor >= size) {
    return { events: [], nextCursor: null, hasMore: false };
  }

  // Read [cursor, cursor + capped). Then keep reading byte-by-byte
  // until we hit a newline or EOF so the LAST event in the chunk is
  // never split.
  const initialEnd = Math.min(size - 1, cursor + capped - 1);
  let buffer = await readByteRange(filePath, cursor, initialEnd);
  let endOffset = initialEnd + 1; // exclusive end

  if (endOffset < size) {
    const tail = await readUntilNewline(filePath, endOffset, size);
    buffer = Buffer.concat([buffer, tail.buffer]);
    endOffset = tail.endExclusive;
  }

  const text = buffer.toString("utf8");
  const lines = text.split("\n");
  const events: TranscriptEvent[] = [];
  for (const line of lines) {
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const result = TranscriptEventSchema.safeParse(parsed);
    if (result.success) {
      events.push(result.data);
    }
  }

  const reachedEof = endOffset >= size;
  const nextCursor = reachedEof ? null : endOffset;
  return { events, nextCursor, hasMore: nextCursor !== null };
}

function readByteRange(
  filePath: string,
  start: number,
  endInclusive: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = fs.createReadStream(filePath, {
      start,
      end: endInclusive,
    });
    stream.on("data", (chunk) => {
      chunks.push(
        typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk,
      );
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function readUntilNewline(
  filePath: string,
  start: number,
  size: number,
): Promise<{ buffer: Buffer; endExclusive: number }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let consumed = 0;
    let finished = false;
    const stream = fs.createReadStream(filePath, { start, end: size - 1 });

    const finish = (foundNewline: boolean): void => {
      if (finished) return;
      finished = true;
      stream.destroy();
      resolve({
        buffer: Buffer.concat(chunks),
        endExclusive: start + consumed,
      });
      void foundNewline; // suppressed — informational
    };

    stream.on("data", (chunk) => {
      const buf =
        typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      const nlIdx = buf.indexOf(0x0a /* \n */);
      if (nlIdx === -1) {
        chunks.push(buf);
        consumed += buf.length;
        return;
      }
      const upTo = buf.subarray(0, nlIdx + 1);
      chunks.push(upTo);
      consumed += upTo.length;
      finish(true);
    });
    stream.on("error", (err) => {
      if (finished) return;
      finished = true;
      reject(err);
    });
    stream.on("end", () => finish(false));
  });
}
