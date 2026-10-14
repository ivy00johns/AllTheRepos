/**
 * Notes tab — the per-repo markdown scratchpad (NEW-PLAN.md §5.9).
 *
 * A plain textarea editing a live, sanitized markdown preview. There is no
 * editor library here on purpose: the notes surface is a scratchpad, and the
 * rest of the app already renders markdown through one shared pipeline
 * (`react-markdown` + `remark-gfm` + `rehype-raw` + `rehype-sanitize` with
 * `README_SANITIZE_SCHEMA`). Reusing it means a note renders exactly like a
 * README, and there is one allowlist to audit rather than two.
 *
 * Autosave: typing updates local state immediately and schedules a save on a
 * short debounce. The save mutation writes the result into the cache instead
 * of invalidating, so the editor never refetches over the caret. `status`
 * reflects the round-trip honestly — "Saving…" while a write is in flight,
 * "Saved" once the server has answered, and the error text when it has not.
 *
 * Notes live under the app's own data directory, keyed on the catalog row id,
 * so they survive a repo moving and never touch the repository itself.
 */

import * as React from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { useNote, useSaveNote } from "@renderer/hooks/use-notes";
import { README_SANITIZE_SCHEMA } from "@renderer/lib/markdown";
import { cn } from "@renderer/lib/cn";

/** Quiet period after the last keystroke before a save is dispatched. */
const AUTOSAVE_DELAY_MS = 600;

const PLACEHOLDER =
  "# Scratchpad\n\nWhat is this repo for?\nWhat is half-finished?\nWhat would you tell the next person to touch it?";

interface NotesTabProps {
  slug: string;
  repoName: string;
}

type SaveStatus = "idle" | "dirty" | "saving" | "saved";

export function NotesTab({ slug, repoName }: NotesTabProps) {
  const note = useNote(slug);
  const save = useSaveNote();

  const [text, setText] = React.useState("");
  const [status, setStatus] = React.useState<SaveStatus>("idle");

  // Seed the editor once per repo, when that repo's note first arrives.
  // Guarding on the slug (not just the data) keeps a stale note from the
  // previous repo from flashing into the editor after a panel hop.
  const seededFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!note.data || seededFor.current === slug) return;
    seededFor.current = slug;
    setText(note.data.content);
    setStatus(note.data.content ? "saved" : "idle");
  }, [note.data, slug]);

  // Debounced autosave. Skips the seed value and any no-op edit, so opening a
  // note and closing it writes nothing.
  const lastSaved = note.data?.content;
  React.useEffect(() => {
    if (seededFor.current !== slug) return;
    if (lastSaved !== undefined && lastSaved === text) {
      // The editor agrees with what is stored: nothing to save. This is not
      // merely "don't fire a save" — it must also CLEAR a `dirty` that a
      // previous pass set. Seeding the editor runs the effect twice (once
      // against the empty pre-load state, once against the loaded note); the
      // first pass schedules a save of empty text and flips the status to
      // `dirty`, and the second pass cancels that timer. Leaving the status
      // alone there is how a freshly-opened note read "Unsaved changes"
      // forever, with no edit ever made.
      setStatus("saved");
      return;
    }
    setStatus("dirty");
    const timer = setTimeout(() => {
      setStatus("saving");
      save.mutate(
        { slug, content: text },
        { onSuccess: () => setStatus("saved") },
      );
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // `save` is intentionally not a dependency: the mutation handle is
    // re-created on every render, and listing it would restart the debounce
    // each time — a save that never fires while you type.
  }, [text, slug, lastSaved]);

  const statusLabel: string =
    save.isError && status !== "saving"
      ? (save.error?.message ?? "Could not save the note.")
      : status === "saving"
        ? "Saving…"
        : status === "dirty"
          ? "Unsaved changes"
          : status === "saved"
            ? "Saved"
            : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="atr-label font-semibold uppercase tracking-widest text-muted-foreground">
          Notes
        </p>
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "atr-meta",
            save.isError && status !== "saving"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {statusLabel}
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        <label className="flex min-h-[220px] flex-col gap-1.5">
          <span className="sr-only">Markdown for {repoName}</span>
          <textarea
            aria-label={`Note for ${repoName}`}
            value={text}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[220px] flex-1 resize-none rounded-md border border-border bg-muted/20 p-3 font-mono text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <div className="flex min-h-[220px] flex-col gap-1.5">
          <span className="atr-label font-semibold uppercase tracking-widest text-muted-foreground">
            Preview
          </span>
          <div className="min-h-[220px] flex-1 overflow-y-auto rounded-md border border-border bg-card/40 p-3">
            {text.trim() ? (
              <div className="prose prose-invert prose-sm max-w-none font-sans prose-headings:font-mono prose-code:font-mono prose-code:text-accent prose-a:text-accent">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw, [rehypeSanitize, README_SANITIZE_SCHEMA]]}
                >
                  {text}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-xs italic text-muted-foreground">
                Nothing yet — a note is yours alone. It is stored in the app's
                data folder, never inside the repo.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
