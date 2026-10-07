/**
 * Folder-name validation.
 *
 * Lives in `shared/` because BOTH sides need it: the renderer validates
 * as you type so a bad name is caught before you press the button, and
 * the main process validates again at the IPC boundary because renderer
 * checks are advice, not enforcement. One implementation means the two
 * can never disagree about what's allowed.
 *
 * PURE module: no Node, no DOM, no Electron.
 */

/** Why a folder name was rejected. `null` reason ⇒ the name is fine. */
export type FolderNameProblem =
  | "empty"
  | "separator"
  | "dot-name"
  | "trailing"
  | "too-long"
  | "control-chars"
  | "colon";

export interface FolderNameCheck {
  ok: boolean;
  problem: FolderNameProblem | null;
  message: string | null;
  /** The name that would actually be used (trimmed). */
  normalized: string;
}

/** APFS/HFS+ and ext4 all cap a single path component at 255 bytes. */
const MAX_NAME_LENGTH = 255;

const MESSAGES: Record<FolderNameProblem, string> = {
  empty: "Enter a folder name",
  separator: "A folder name can't contain “/”",
  "dot-name": "“.” and “..” aren't usable folder names",
  trailing: "A folder name can't end in a space or a dot",
  "too-long": `Keep it under ${MAX_NAME_LENGTH} characters`,
  "control-chars": "A folder name can't contain control characters",
  colon: "Avoid “:” — the Finder displays it as “/”",
};

export function checkFolderName(raw: string): FolderNameCheck {
  const normalized = raw.trim();
  const fail = (problem: FolderNameProblem): FolderNameCheck => ({
    ok: false,
    problem,
    message: MESSAGES[problem],
    normalized,
  });

  if (normalized.length === 0) return fail("empty");
  if (normalized.includes("/")) return fail("separator");
  if (normalized === "." || normalized === "..") return fail("dot-name");
  // Byte length, not code units — a name of emoji hits the cap far sooner
  // than its `.length` suggests.
  if (new TextEncoder().encode(normalized).length > MAX_NAME_LENGTH) {
    return fail("too-long");
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return fail("control-chars");
  if (normalized.includes(":")) return fail("colon");
  // A trailing space or dot is legal on APFS but invisible, and it breaks
  // the moment the folder is synced to or archived on Windows.
  if (/[ .]$/.test(normalized)) return fail("trailing");

  return { ok: true, problem: null, message: null, normalized };
}

/** Convenience for callers that only need the boolean. */
export function isValidFolderName(raw: string): boolean {
  return checkFolderName(raw).ok;
}
