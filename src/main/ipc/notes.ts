/**
 * IPC handlers — `notes:*` namespace.
 *
 * Two channels over one markdown file per repository, stored under the app's
 * own data directory (`services/notes.ts`). Everything here is deliberately
 * cheap: a note is one small file, so the panel reads it on selection and the
 * editor writes it on a debounce. Nothing is scheduled, cached, or watched.
 *
 * The renderer addresses a note by SLUG because that is the handle it holds;
 * this layer resolves the slug to the catalog row id, which is the storage
 * key. That indirection is the point — a slug changes when a repo moves, and
 * a note must not.
 *
 * Reading a note for a slug that no longer resolves is not an error: the row
 * can be removed between the catalog listing it and the click, and a stale
 * panel should show a blank note rather than an error. Writing is the
 * opposite — a write that cannot name its target must fail loudly, or the
 * user would be told their note was saved when it was not.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { IPC } from "@shared/ipc";
import {
  NotesGetInputSchema,
  NotesGetResultSchema,
  NotesSaveInputSchema,
  NotesSaveResultSchema,
} from "@shared/schemas";
import type { NotesGetResult, NotesSaveResult } from "@shared/types";

import { catalogService } from "@main/services/catalog";
import { readNote, writeNote } from "@main/services/notes";

import { assertRendererFrame } from "./_frame";

/** Read one repo's note. Unknown slug ⇒ a blank note, not an error. */
export async function handleNotesGet(raw: unknown): Promise<NotesGetResult> {
  const { slug } = NotesGetInputSchema.parse(raw);
  const repoId = await catalogService.resolveRepoId(slug);
  if (repoId === null) {
    return NotesGetResultSchema.parse({
      slug,
      content: "",
      updatedAt: null,
    });
  }
  const stored = readNote(repoId);
  return NotesGetResultSchema.parse({ slug, ...stored });
}

/** Write one repo's note. Blank content clears it. */
export async function handleNotesSave(raw: unknown): Promise<NotesSaveResult> {
  const input = NotesSaveInputSchema.parse(raw);
  const repoId = await catalogService.resolveRepoId(input.slug);
  if (repoId === null) {
    throw new Error(
      `No catalog entry matches the repository (${input.slug}). Rescan and try again.`,
    );
  }
  const stored = writeNote(repoId, input.content);
  return NotesSaveResultSchema.parse({ slug: input.slug, ...stored });
}

/** Register every `notes:*` handler. Idempotent. */
export function registerNotesHandlers(): void {
  ipcMain.removeHandler(IPC.NOTES.GET);
  ipcMain.handle(
    IPC.NOTES.GET,
    async (event: IpcMainInvokeEvent, raw): Promise<NotesGetResult> => {
      assertRendererFrame(event);
      return handleNotesGet(raw);
    },
  );

  ipcMain.removeHandler(IPC.NOTES.SAVE);
  ipcMain.handle(
    IPC.NOTES.SAVE,
    async (event: IpcMainInvokeEvent, raw): Promise<NotesSaveResult> => {
      assertRendererFrame(event);
      return handleNotesSave(raw);
    },
  );
}
