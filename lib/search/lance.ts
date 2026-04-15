import path from "node:path";
import type { Connection, Table } from "@lancedb/lancedb";
import { getDataDir } from "@/lib/db/client";

const TABLE_NAME = "repo_embeddings";

let connPromise: Promise<Connection> | null = null;
let tablePromise: Promise<Table> | null = null;

async function getConn(): Promise<Connection> {
  if (!connPromise) {
    connPromise = (async () => {
      const { connect } = await import("@lancedb/lancedb");
      const dir = path.join(getDataDir(), "lance");
      return connect(dir);
    })();
  }
  return connPromise;
}

export interface EmbeddingRow {
  repo_id: number;
  slug: string;
  vector: number[];
  content_hash: string;
  updated_at: string;
}

async function getTable(): Promise<Table> {
  if (tablePromise) return tablePromise;
  tablePromise = (async () => {
    const conn = await getConn();
    const names = await conn.tableNames();
    if (names.includes(TABLE_NAME)) {
      return conn.openTable(TABLE_NAME);
    }
    // Seed with one row (Arrow needs a sample to infer schema), then delete it.
    const seed: Record<string, unknown> = {
      repo_id: -1,
      slug: "__seed__",
      vector: new Array(768).fill(0),
      content_hash: "",
      updated_at: new Date().toISOString(),
    };
    const tbl = await conn.createTable(TABLE_NAME, [seed]);
    try {
      await tbl.delete("repo_id = -1");
    } catch {
      /* ignore */
    }
    return tbl;
  })();
  return tablePromise;
}

export async function upsertEmbedding(row: EmbeddingRow): Promise<void> {
  const tbl = await getTable();
  // Delete prior row for this repo_id, then add fresh.
  try {
    await tbl.delete(`repo_id = ${row.repo_id}`);
  } catch {
    /* first-write path */
  }
  await tbl.add([row as unknown as Record<string, unknown>]);
}

export async function deleteEmbedding(repoId: number): Promise<void> {
  const tbl = await getTable();
  try {
    await tbl.delete(`repo_id = ${repoId}`);
  } catch {
    /* ignore */
  }
}

export interface VectorSearchHit {
  slug: string;
  score: number;
}

export async function vectorSearch(
  queryVector: number[],
  limit = 50,
): Promise<VectorSearchHit[]> {
  let tbl: Table;
  try {
    tbl = await getTable();
  } catch {
    return [];
  }
  try {
    const rows = (await tbl
      .search(queryVector)
      .limit(limit)
      .toArray()) as Array<{ slug?: string; _distance?: number }>;
    return rows
      .filter((r): r is { slug: string; _distance?: number } => typeof r.slug === "string" && r.slug !== "__seed__")
      .map((r) => ({
        slug: r.slug,
        // Lance returns a distance; convert to a similarity-like score (lower distance = higher score).
        score: typeof r._distance === "number" ? 1 / (1 + r._distance) : 0,
      }));
  } catch (err) {
    console.error("[backend] vectorSearch error", err);
    return [];
  }
}
