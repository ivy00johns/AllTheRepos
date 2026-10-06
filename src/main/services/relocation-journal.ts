/**
 * Relocation journal — the undo log shared by repo moves and folder
 * restructuring.
 *
 * Both operations end in the same place: something was renamed on disk
 * and some catalog rows now point at new paths. Journaling them into ONE
 * log means a single undo affordance walks back whatever you did last,
 * in order, without the UI having to know which kind of operation it was.
 *
 * The log is written atomically (temp file + rename) so a crash mid-write
 * can't leave a truncated journal — the one artefact you'd most want
 * intact after a crash.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

/** A catalog row that needs re-pointing, and where it went. */
export interface RepoMoveRecord {
  slug: string;
  fromPath: string;
  toPath: string;
}

/** The directory rename behind a folder move, rename, or creation. */
export interface FolderRecord {
  fromPath: string;
  toPath: string;
}

/**
 * One undoable batch.
 *
 * `kind` distinguishes what has to happen to reverse it:
 *   - `repos`  — rename each repo directory back.
 *   - `folder` — rename ONE directory back; the repo records are only
 *                there so their stored paths can be re-pointed.
 *   - `create` — remove the directory, but only if it's still empty.
 *
 * Entries written before `kind` existed have no such field and are
 * treated as `repos`, which is what they were.
 */
export interface JournalEntry {
  batchId: string;
  at: string;
  kind?: "repos" | "folder" | "create";
  moves: RepoMoveRecord[];
  folder?: FolderRecord;
}

const JOURNAL_FILE = "move-journal.json";
/** Keep enough history to walk back a bad afternoon, not forever. */
const JOURNAL_LIMIT = 50;

function journalPath(): string {
  return path.join(app.getPath("userData"), JOURNAL_FILE);
}

export async function readJournal(): Promise<JournalEntry[]> {
  try {
    const raw = await fs.readFile(journalPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as JournalEntry[]) : [];
  } catch {
    return [];
  }
}

export async function writeJournal(entries: JournalEntry[]): Promise<void> {
  const trimmed = entries.slice(-JOURNAL_LIMIT);
  const target = journalPath();
  const temp = `${target}.tmp`;
  await fs.writeFile(temp, JSON.stringify(trimmed, null, 2), "utf8");
  await fs.rename(temp, target);
}

/**
 * Append a batch and return its id.
 *
 * The id is derived from the clock rather than a counter so ids stay
 * unique across restarts without needing to read the journal first.
 */
export async function appendBatch(
  entry: Omit<JournalEntry, "batchId" | "at">,
): Promise<string> {
  const batchId = `mv-${Date.now().toString(36)}-${Math.floor(
    Math.random() * 1e4,
  )
    .toString(36)
    .padStart(3, "0")}`;
  const journal = await readJournal();
  journal.push({ ...entry, batchId, at: new Date().toISOString() });
  await writeJournal(journal);
  return batchId;
}

export async function removeBatch(batchId: string): Promise<void> {
  const journal = await readJournal();
  await writeJournal(journal.filter((entry) => entry.batchId !== batchId));
}

/** Most recent batch, or `null` when nothing has been done yet. */
export async function lastEntry(): Promise<JournalEntry | null> {
  const journal = await readJournal();
  return journal[journal.length - 1] ?? null;
}

export async function findEntry(
  batchId?: string,
): Promise<JournalEntry | null> {
  const journal = await readJournal();
  if (!batchId) return journal[journal.length - 1] ?? null;
  return journal.find((entry) => entry.batchId === batchId) ?? null;
}
