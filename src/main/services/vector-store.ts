/**
 * Vector store — repo embeddings as a `vec0` table in the catalog's own SQLite
 * file, through the `sqlite-vec` extension.
 *
 * This replaces the LanceDB wrapper that used to live here. The reason is not
 * that LanceDB was wrong; it is that LanceDB ships **prebuilt binaries, one npm
 * package per platform, and there is no darwin-x64 package** — none at all past
 * `0.22.3`, while this app is on `0.27.2`. So "does the app work on an Intel
 * Mac?" had stopped being a question about this code and become a question
 * about somebody else's release matrix, with a silent failure at the end of it:
 * `vectorSearch` returns `[]` by design, so semantic search quietly stops
 * existing on that architecture and every gate stays green.
 *
 * `sqlite-vec` publishes a binary for every platform this app could ever ship
 * (`darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`, `windows-x64`), the
 * FTS5 index it sits beside is already in that same file, and the repository is
 * one file lighter for the change. `scripts/check-platforms.mjs` reads that
 * matrix straight out of the installed packages, so the day the coupling comes
 * back is a red check rather than a user noticing.
 *
 * What the store is:
 *   - one virtual table, `repo_embeddings`, keyed on `repos.id`;
 *   - `slug` / `content_hash` / `updated_at` kept beside the vector as vec0
 *     metadata columns, so a KNN query and the content-hash gate both read out
 *     of one place and cannot drift;
 *   - L2 distance (`vec0`'s default metric) over normalised embedding vectors.
 *     For unit vectors L2 and cosine rank identically, which is why the
 *     distance → score conversion below is the same `1 / (1 + d)` the LanceDB
 *     wrapper used.
 *
 * Everything here is **synchronous**. `better-sqlite3` is synchronous and so is
 * the extension once loaded; the previous wrapper was async only because
 * LanceDB's API was. `embedding.ts` awaits these calls, which a non-promise
 * satisfies, but callers that want to be literal about it are welcome to drop
 * the `await`.
 *
 * Failure is soft, on purpose, and *reported*. Any step of {@link ensureReady}
 * failing (no platform package for this machine, a dylib that will not load,
 * a database that rejects the DDL) leaves {@link vectorStoreStatus} saying so,
 * which is what lets search tell the user it answered with keywords only
 * instead of pretending the whole feature was never there.
 */

import fs from "node:fs";
import path from "node:path";

import * as sqliteVec from "sqlite-vec";

import { getSqlite } from "@main/db/client";

/** The table this store owns. Named for what it holds, not for how it is queried. */
export const VECTOR_TABLE = "repo_embeddings";

/**
 * Vector width, in floats. `nomic-embed-text` (the default Ollama model) and
 * OpenAI's `text-embedding-3-small` both return 768 — and `vec0` enforces it,
 * so a provider that starts returning something else fails loudly at the insert
 * instead of writing a table full of half-incomparable vectors.
 */
export const EMBEDDING_DIM = 768;

const DDL = `CREATE VIRTUAL TABLE IF NOT EXISTS ${VECTOR_TABLE} USING vec0(
  repo_id INTEGER PRIMARY KEY,
  slug TEXT,
  content_hash TEXT,
  updated_at TEXT,
  embedding float[${EMBEDDING_DIM}]
);`;

export interface EmbeddingRow {
  repo_id: number;
  slug: string;
  vector: number[];
  content_hash: string;
  updated_at: string;
}

export interface VectorSearchHit {
  slug: string;
  score: number;
}

/** What `ensureReady()` found, memoised for the life of the process. */
type Runtime =
  | { ok: true; version: string }
  | { ok: false; reason: string };

let runtime: Runtime | null = null;

/** The library's file name, spelled as `sqlite-vec` itself spells it. */
const EXTENSION_FILE =
  process.platform === "win32"
    ? "vec0.dll"
    : process.platform === "darwin"
      ? "vec0.dylib"
      : "vec0.so";

interface ExtensionSearch {
  /** Paths to try, in order. Empty when there is nothing to try at all. */
  candidates: string[];
  /** Why the wrapper could not name its own library, when it could not. */
  wrapperError: string | null;
}

/**
 * Where to look for the extension, in order.
 *
 *   1. The wrapper package's own answer. Correct wherever the per-platform
 *      package sits beside it — a development checkout, or npm's flat layout.
 *   2. `<resources>/vec0.<ext>`, where `scripts/pack-vector-extension.mjs`
 *      puts it at build time. It has to exist as a fallback because
 *      electron-builder collects `dependencies` and not
 *      `optionalDependencies`, and the per-platform package is the latter — so
 *      the packaged app contains the wrapper and not its library, and (1)
 *      throws. Measured on a real bundle, not assumed.
 *
 * The wrapper's failure is carried out rather than swallowed: it is the only
 * thing that can say *which* package is missing, and the difference between
 * "this install has no darwin-x64 package" and "this bundle is missing its
 * resources copy" is the entire diagnosis.
 */
export function extensionSearch(): ExtensionSearch {
  const candidates: string[] = [];
  let wrapperError: string | null = null;
  try {
    candidates.push(sqliteVec.getLoadablePath());
  } catch (err) {
    wrapperError = err instanceof Error ? err.message : String(err);
  }
  // `process.resourcesPath` is Electron's; under plain Node (unit tests) it is
  // absent, and there is nothing to add.
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  if (typeof resourcesPath === "string" && resourcesPath.length > 0) {
    candidates.push(path.join(resourcesPath, EXTENSION_FILE));
  }
  return { candidates, wrapperError };
}

/**
 * The paths to try, which is what a test asserting the search order wants.
 * Exported rather than inlined so that order is a tested fact.
 */
export function extensionCandidates(): string[] {
  return extensionSearch().candidates;
}

/** The first candidate that exists on disk, or a description of what was tried. */
function resolveExtensionPath(): string {
  const { candidates, wrapperError } = extensionSearch();
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found) return found;

  const saidSo = wrapperError ? ` (the wrapper said: ${wrapperError})` : "";
  throw new Error(
    candidates.length === 0
      ? `no ${EXTENSION_FILE} for this platform, and the sqlite-vec wrapper ` +
          `could not name one${saidSo}`
      : `no ${EXTENSION_FILE} at ${candidates.join(" or ")}${saidSo}`,
  );
}

/**
 * Load the extension and create the table, once.
 *
 * Memoised in both directions: a machine without a loadable extension should
 * not pay a failed `dlopen` on every search — and, more importantly, should not
 * pay it on every *keystroke*, which is what a debounced search box actually
 * does.
 */
function ensureReady(): Runtime {
  if (runtime) return runtime;
  try {
    const sqlite = getSqlite();
    sqlite.loadExtension(resolveExtensionPath());
    const version = (
      sqlite.prepare("SELECT vec_version() AS v").get() as { v: string }
    ).v;
    sqlite.exec(DDL);
    runtime = { ok: true, version };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn("[backend] vector store unavailable; FTS-only", reason);
    runtime = { ok: false, reason };
  }
  return runtime;
}

export interface VectorStoreStatus {
  available: boolean;
  /** The extension's own version, when it loaded. */
  version: string | null;
  /** Why it did not, when it did not. */
  reason: string | null;
}

/**
 * Whether vectors are usable, and why not when they are not. Forces the load
 * attempt, so the answer is about this machine rather than about the code.
 */
export function vectorStoreStatus(): VectorStoreStatus {
  const ready = ensureReady();
  return ready.ok
    ? { available: true, version: ready.version, reason: null }
    : { available: false, version: null, reason: ready.reason };
}

/**
 * Encode an embedding as the little-endian `float32` blob `vec0` expects.
 *
 * `vec0` also accepts a JSON array of numbers, which is what the probes used
 * first — but that is ~7 KB of text per 768-float vector against 3 KB of binary,
 * on a table that is read by every search and rewritten by every scan.
 *
 * `vec0` validates the width and throws `Dimension mismatch`, so a provider
 * that changes model under us is a caught error here, not a corrupt table.
 */
function toVectorBlob(vector: number[]): Buffer {
  if (vector.length !== EMBEDDING_DIM) {
    throw new Error(
      `[vector-store] expected a ${EMBEDDING_DIM}-dimension vector, got ${vector.length}`,
    );
  }
  return Buffer.from(new Float32Array(vector).buffer);
}

/**
 * Primary-key binds go through `BigInt`.
 *
 * `vec0` rejects a primary key it did not receive as a true SQLite INTEGER
 * (`Only integers are allows for primary key values`), and better-sqlite3 binds
 * a JavaScript number as a REAL. Integers *read* back as numbers, so this is a
 * write-side detail only — but it is the kind of detail that looks like a typo
 * to the next reader, which is why it is a named function with this comment
 * rather than an inline `BigInt(row.repo_id)`.
 */
function key(repoId: number): bigint {
  return BigInt(repoId);
}

/**
 * Read the `content_hash` of the stored embedding for `repoId`, or `null` when
 * there is none (or the store is unavailable).
 *
 * Used by the content-hash gate in `embedding.ts > indexRepoEmbedding` so a
 * rescan only re-embeds when the embedding input actually changed. Any failure
 * resolves to `null`, which the caller reads as "not yet embedded" and will
 * therefore (re)embed — a failed read never silently skips an embed, which is
 * the only safe direction for this to fail in.
 */
export function getEmbeddingContentHash(repoId: number): string | null {
  if (!ensureReady().ok) return null;
  try {
    const row = getSqlite()
      .prepare(
        `SELECT content_hash AS hash FROM ${VECTOR_TABLE} WHERE repo_id = ?`,
      )
      .get(repoId) as { hash?: string } | undefined;
    return typeof row?.hash === "string" ? row.hash : null;
  } catch (err) {
    console.warn(
      "[backend] vector content-hash read failed",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Store (or replace) one repo's embedding.
 *
 * Delete-then-insert rather than `INSERT OR REPLACE`: `vec0` has no upsert, and
 * a plain second insert is a `UNIQUE constraint failed` — correct of it, and a
 * confusing thing to meet in a log. Both statements run inside one transaction
 * so a failed insert cannot leave the row deleted.
 */
export function upsertEmbedding(row: EmbeddingRow): void {
  if (!ensureReady().ok) {
    throw new Error("[vector-store] unavailable — cannot store an embedding");
  }
  const sqlite = getSqlite();
  const write = sqlite.transaction((entry: EmbeddingRow) => {
    sqlite
      .prepare(`DELETE FROM ${VECTOR_TABLE} WHERE repo_id = ?`)
      .run(key(entry.repo_id));
    sqlite
      .prepare(
        `INSERT INTO ${VECTOR_TABLE}(repo_id, slug, content_hash, updated_at, embedding)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        key(entry.repo_id),
        entry.slug,
        entry.content_hash,
        entry.updated_at,
        toVectorBlob(entry.vector),
      );
  });
  write(row);
}

/**
 * Drop one repo's embedding. Best-effort by contract: the catalog row is the
 * source of truth, so a failure here is logged by the caller and never fails
 * the delete that triggered it.
 */
export function deleteEmbedding(repoId: number): void {
  if (!ensureReady().ok) return;
  getSqlite()
    .prepare(`DELETE FROM ${VECTOR_TABLE} WHERE repo_id = ?`)
    .run(key(repoId));
}

/**
 * Nearest neighbours by L2 distance, as `{slug, score}` pairs.
 *
 * Empty (never throwing) when the store is unavailable — the caller is a search
 * that must still answer with FTS results. The status function is how a caller
 * tells "no vectors stored yet" apart from "no vector store at all".
 */
export function vectorSearch(
  queryVector: number[],
  limit = 50,
): VectorSearchHit[] {
  if (!ensureReady().ok) return [];
  try {
    const rows = getSqlite()
      .prepare(
        `SELECT slug, distance FROM ${VECTOR_TABLE}
         WHERE embedding MATCH ? AND k = ?
         ORDER BY distance`,
      )
      .all(toVectorBlob(queryVector), limit) as Array<{
      slug: string;
      distance: number;
    }>;
    return rows
      .filter((r) => typeof r.slug === "string")
      .map((r) => ({
        slug: r.slug,
        // L2 distance → similarity-shaped score: nearer is larger, and the
        // ranking the RRF merge sees is the ranking the store returned.
        score: 1 / (1 + r.distance),
      }));
  } catch (err) {
    console.error(
      "[backend] vectorSearch error",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

/**
 * How many embeddings are stored. Used by tests and diagnostics; not on the
 * search path.
 */
export function countEmbeddings(): number {
  if (!ensureReady().ok) return 0;
  try {
    return (
      getSqlite()
        .prepare(`SELECT count(*) AS n FROM ${VECTOR_TABLE}`)
        .get() as { n: number }
    ).n;
  } catch {
    return 0;
  }
}

/**
 * Forget the memoised load result, so the next call re-attempts it against the
 * current data directory and connection. Test/QE seam.
 */
export function resetVectorStoreCache(): void {
  runtime = null;
}
