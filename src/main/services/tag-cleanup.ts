/**
 * Tag cleanup: re-run the heuristic tagger and show what would change.
 *
 * `previewTagCleanup` writes nothing. `applyTagCleanup` acts on the answers the
 * user gave: `accept` writes the proposed heuristic set; `reject` records each
 * disputed change so every later rescan keeps the user's answer. User tags are
 * never read as proposals and never written here.
 *
 * A repo whose folder is missing is reported as unreadable and left alone.
 * Re-tagging it would see no files and strip every heuristic tag.
 */

import fs from "node:fs";

import type {
  LanguageBytes,
  Tag,
  TagCleanupApplyInput,
  TagCleanupApplyResult,
  TagCleanupPreviewResult,
  TagCleanupProposal,
} from "@shared/types";
import { getSqlite } from "../db/client";
import { readTagRejections } from "../db/queries";
import { applyTagRejections, inferTags } from "./tag";

/** The stored cap on a repo's tag list, shared with `upsertRepo`. */
const STORED_TAG_CAP = 12;

interface RepoRow {
  id: number;
  slug: string;
  name: string;
  full_path: string;
  languages_json: string | null;
  tags_json: string | null;
}

const REPO_COLUMNS =
  "id, slug, name, full_path, languages_json, tags_json FROM repos";

function parseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function isDirectory(fp: string): boolean {
  try {
    return fs.statSync(fp).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A proposal for one repo, `null` when nothing would change, or `"unreadable"`
 * when the folder is gone. Reads the folder but writes nothing.
 */
function computeProposal(
  row: RepoRow,
): TagCleanupProposal | null | "unreadable" {
  if (!isDirectory(row.full_path)) return "unreadable";

  const stored = parseArray<Tag>(row.tags_json);
  const current = stored.filter((t) => t.source !== "user");
  const inferred = inferTags({
    fullPath: row.full_path,
    languages: parseArray<LanguageBytes>(row.languages_json),
    readmeContent: null,
  });
  const proposed = applyTagRejections(
    inferred,
    current,
    readTagRejections(row.id),
  );

  const currentValues = current.map((t) => t.value);
  const proposedValues = proposed.map((t) => t.value);
  const added = proposedValues.filter((v) => !currentValues.includes(v));
  const removed = currentValues.filter((v) => !proposedValues.includes(v));
  if (added.length === 0 && removed.length === 0) return null;

  return {
    slug: row.slug,
    name: row.name,
    current: currentValues,
    proposed: proposedValues,
    added,
    removed,
  };
}

/** Every repo whose heuristic tags would change if re-tagged now. Read-only. */
export function previewTagCleanup(): TagCleanupPreviewResult {
  const rows = getSqlite()
    .prepare(`SELECT ${REPO_COLUMNS} ORDER BY name`)
    .all() as RepoRow[];

  const proposals: TagCleanupProposal[] = [];
  let unreadable = 0;
  for (const row of rows) {
    const result = computeProposal(row);
    if (result === "unreadable") {
      unreadable += 1;
    } else if (result) {
      proposals.push(result);
    }
  }
  return { proposals, scanned: rows.length, unreadable };
}

/**
 * Act on one decision per repo, in a single transaction. `accept` rewrites the
 * heuristic tags to the proposed set and keeps the user's tags. `reject`
 * remembers each disputed change: a rejected addition stays off, and a rejected
 * removal stays on.
 */
export function applyTagCleanup(
  input: TagCleanupApplyInput,
): TagCleanupApplyResult {
  const sqlite = getSqlite();
  const selectRepo = sqlite.prepare(`SELECT ${REPO_COLUMNS} WHERE slug = ?`);
  const writeTags = sqlite.prepare(
    "UPDATE repos SET tags_json = ?, updated_at = ? WHERE id = ?",
  );
  const remember = sqlite.prepare(
    `INSERT INTO tag_rejections (repo_id, value, kind) VALUES (?, ?, ?)
     ON CONFLICT (repo_id, value) DO UPDATE SET kind = excluded.kind`,
  );

  const result: TagCleanupApplyResult = {
    accepted: 0,
    rejected: 0,
    skipped: [],
  };

  const run = sqlite.transaction(() => {
    for (const { slug, decision } of input.decisions) {
      const row = selectRepo.get(slug) as RepoRow | undefined;
      const proposal = row ? computeProposal(row) : "unreadable";
      if (!row || proposal === "unreadable") {
        result.skipped.push(slug);
        continue;
      }

      if (decision === "accept") {
        result.accepted += 1;
        if (proposal === null) continue;
        const userTags = parseArray<Tag>(row.tags_json).filter(
          (t) => t.source === "user",
        );
        const heuristics: Tag[] = proposal.proposed.map((value) => ({
          value,
          source: "heuristic",
        }));
        const merged = [...userTags, ...heuristics].slice(0, STORED_TAG_CAP);
        writeTags.run(JSON.stringify(merged), new Date().toISOString(), row.id);
      } else {
        result.rejected += 1;
        if (proposal === null) continue;
        for (const value of proposal.added) remember.run(row.id, value, "add");
        for (const value of proposal.removed)
          remember.run(row.id, value, "keep");
      }
    }
  });
  run();

  return result;
}
