/**
 * Notes service — per-repo markdown scratchpad (NEW-PLAN.md §5.9).
 *
 * Storage: one file per repository at `{userData}/notes/<repoId>.md`,
 * where `repoId` is the catalog row's `id`. The row id is the key rather
 * than the slug because a slug is derived from the repo's full path and so
 * changes when the repo moves, while the id survives a move and a re-scan.
 *
 * Nothing is ever written inside a repository. That is the whole reason the
 * store lives here: `docs/COMMAND-DISCLOSURE.md` §4 promises that no file
 * content inside a repository is ever created, modified, or deleted, and a
 * `.alltherepos/notes.md` mirror (mooted in the plan) would break exactly
 * that promise. Notes live in the app's own data directory instead.
 *
 * Durability matches `services/settings.ts`: write a temp file, then rename
 * over the target, so a crash mid-write cannot truncate the previous note.
 *
 * A missing file is a normal answer (`content: ""`), never an error. Blank
 * content clears the note by emptying the file rather than removing it, and an
 * empty file reads as absent, so an empty editor and an absent note still
 * answer identically. Nothing here deletes: this app has no delete (§5 of
 * `docs/COMMAND-DISCLOSURE.md`, enforced by `scripts/check-read-only.mjs`).
 */

import fs from "node:fs";
import path from "node:path";

import { app } from "electron";

/**
 * What's physically on disk for one note. The IPC layer folds the addressed
 * slug back in; the service deliberately knows nothing about slugs.
 */
export interface StoredNote {
  content: string;
  updatedAt: string | null;
}

const NOTES_DIRNAME = "notes";
const NOTE_EXT = ".md";

let cachedDir: string | null = null;

/** `{userData}/notes` — memoized because `app.getPath` is a syscall. */
function notesDir(): string {
  if (cachedDir) return cachedDir;
  cachedDir = path.join(app.getPath("userData"), NOTES_DIRNAME);
  return cachedDir;
}

/**
 * The one place a note path is built.
 *
 * `repoId` has already been Zod-validated to a positive integer at the IPC
 * boundary, and this guard makes that a property of the service too: an
 * integer cannot contain a separator, so the path cannot escape `notes/`.
 */
function notePath(repoId: number): string {
  if (!Number.isInteger(repoId) || repoId <= 0) {
    throw new Error(`Invalid repo id for a note: ${String(repoId)}`);
  }
  return path.join(notesDir(), `${repoId}${NOTE_EXT}`);
}

/**
 * Read one repo's note. Absent file ⇒ `{ content: "", updatedAt: null }`.
 *
 * A read error other than "missing" (e.g. a permission problem on the app
 * data directory) also resolves empty rather than throwing: the notes tab is
 * a scratchpad, and failing the whole panel because the store is unreadable
 * would be a worse trade than showing a blank note.
 */
export function readNote(repoId: number): StoredNote {
  const fp = notePath(repoId);
  try {
    const content = fs.readFileSync(fp, "utf8");
    // A cleared note is an empty file, not an absent one. Folding the two
    // together here is what lets `writeNote` clear without deleting anything.
    if (content.trim() === "") return { content: "", updatedAt: null };
    return { content, updatedAt: fs.statSync(fp).mtime.toISOString() };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[backend] note read failed; treating as empty", err);
    }
    return { content: "", updatedAt: null };
  }
}

/**
 * Write one repo's note and return what was stored.
 *
 * Blank (whitespace-only) content clears the file rather than deleting it.
 * Otherwise the body is written verbatim — no trailing newline is appended or
 * stripped, so what the user typed round-trips exactly.
 */
export function writeNote(repoId: number, content: string): StoredNote {
  const fp = notePath(repoId);
  const body = content.trim() === "" ? "" : content;

  // Clearing a note that was never written stays a no-op: no file appears.
  if (body === "" && !fs.existsSync(fp)) {
    return { content: "", updatedAt: null };
  }

  fs.mkdirSync(notesDir(), { recursive: true });
  // Atomic temp-file + rename: the previous note is either fully replaced or
  // untouched, never half-written. Blank content writes an empty file, which
  // `readNote` answers as an absent note — the app has no delete to reach for.
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, fp);
  return body === ""
    ? { content: "", updatedAt: null }
    : { content: body, updatedAt: new Date().toISOString() };
}

/** Test/QE override — drop the memoized `userData` path. */
export function resetNotesCache(): void {
  cachedDir = null;
}
