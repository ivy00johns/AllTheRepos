/**
 * Unit test — the notes store (`services/notes.ts`).
 *
 * Notes are addressed by catalog row id and kept OUTSIDE every repository:
 * `{userData}/notes/<id>.md`. These tests pin the two properties that make
 * that the honest choice — the file lands under the app data directory and
 * nowhere else, and a missing note is a normal empty answer rather than an
 * error — plus the clear-on-blank behaviour and the atomic rewrite.
 *
 * Unlike the catalog specs this needs no SQLite: the service is pure
 * filesystem work behind a mocked `app.getPath`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let userDataDir = "";
vi.mock("electron", () => ({
  app: { getPath: () => userDataDir },
}));

async function loadNotes() {
  return import("@main/services/notes");
}

let tmp = "";

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atr-notes-"));
  userDataDir = tmp;
  // The service memoizes `app.getPath("userData")`; each test gets a fresh
  // temp dir, so the memo has to be dropped between them.
  (await import("@main/services/notes")).resetNotesCache();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("readNote", () => {
  it("answers empty (not an error) when there is no note", async () => {
    const { readNote } = await loadNotes();
    expect(readNote(42)).toEqual({ content: "", updatedAt: null });
  });

  it("round-trips content written by writeNote", async () => {
    const { readNote, writeNote } = await loadNotes();
    writeNote(7, "# Title\n\nbody\n");
    expect(readNote(7)).toEqual({
      content: "# Title\n\nbody\n",
      updatedAt: expect.any(String),
    });
  });
});

describe("writeNote", () => {
  it("stores the note under userData/notes/<id>.md, not in a repo", async () => {
    const { writeNote, resetNotesCache } = await loadNotes();
    resetNotesCache();
    writeNote(123, "hello");

    const expected = path.join(tmp, "notes", "123.md");
    expect(fs.existsSync(expected)).toBe(true);
    expect(fs.readFileSync(expected, "utf8")).toBe("hello");
    // The only directory the service created is its own store.
    expect(fs.readdirSync(tmp)).toEqual(["notes"]);
  });

  it("returns the content it stored and a fresh timestamp", async () => {
    const { writeNote } = await loadNotes();
    const result = writeNote(1, "note body");
    expect(result.content).toBe("note body");
    expect(result.updatedAt).not.toBeNull();
    expect(new Date(result.updatedAt!).getTime()).not.toBeNaN();
  });

  it("clears the note on whitespace-only content, without deleting its file", async () => {
    const { readNote, writeNote } = await loadNotes();
    writeNote(9, "something");
    const fp = path.join(tmp, "notes", "9.md");
    expect(fs.existsSync(fp)).toBe(true);

    expect(writeNote(9, "   \n\t ")).toEqual({ content: "", updatedAt: null });
    // This app has no delete, so clearing empties the file; `readNote` folds
    // an empty file into the same answer an absent one gives.
    expect(fs.existsSync(fp)).toBe(true);
    expect(fs.readFileSync(fp, "utf8")).toBe("");
    expect(readNote(9)).toEqual({ content: "", updatedAt: null });
  });

  it("clearing an already-absent note is a no-op, not an error", async () => {
    const { writeNote } = await loadNotes();
    expect(writeNote(55, "")).toEqual({ content: "", updatedAt: null });
    expect(fs.existsSync(path.join(tmp, "notes", "55.md"))).toBe(false);
  });

  it("rewrites atomically, leaving no temp file behind", async () => {
    const { writeNote } = await loadNotes();
    writeNote(3, "first");
    writeNote(3, "second");
    const dir = path.join(tmp, "notes");
    expect(fs.readdirSync(dir)).toEqual(["3.md"]);
    expect(fs.readFileSync(path.join(dir, "3.md"), "utf8")).toBe("second");
  });

  it("preserves the body verbatim — no appended or stripped newline", async () => {
    const { writeNote, readNote } = await loadNotes();
    writeNote(11, "no trailing newline");
    expect(readNote(11).content).toBe("no trailing newline");
  });

  it("refuses a non-integer or non-positive id before touching disk", async () => {
    const { writeNote } = await loadNotes();
    expect(() => writeNote(0, "x")).toThrow(/Invalid repo id/);
    expect(() => writeNote(-1, "x")).toThrow(/Invalid repo id/);
    expect(() => writeNote(1.5, "x")).toThrow(/Invalid repo id/);
    expect(fs.existsSync(path.join(tmp, "notes"))).toBe(false);
  });
});
