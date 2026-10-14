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
 * The editor is mounted only once the stored note is in hand, and it takes its
 * starting text from that note rather than being seeded by an effect
 * afterwards. An editable empty box is a claim — "this repo has no note" —
 * and while the read is in flight the app does not know whether that is true.
 * Text typed into it would then be overwritten when the real note landed, and
 * making the seed defer to the typing instead would let a keystroke landing in
 * that window silently replace a note that was already stored. Waiting removes
 * both, so nothing is ever lost in either direction. Reading and failed reads
 * get the shapes the rest of the app gives them: a `SkeletonRegion` and the
 * shared `ErrorState` with its retry.
 *
 * Notes live under the app's own data directory, keyed on the catalog row id,
 * so they survive a repo moving and never touch the repository itself.
 */

import * as React from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { ErrorState } from "@renderer/components/ui/error-state";
import { Skeleton, SkeletonRegion } from "@renderer/components/ui/skeleton";
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

  // Reading, then a failure: neither can be drawn as an editor. The read is a
  // file in the app's own data directory, so a failure is transient more often
  // than not, and `ErrorState` carries the retry (ATR-063).
  if (note.isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <NotesHeading />
        <ErrorState
          title="Could not read the note"
          error={note.error}
          onRetry={() => void note.refetch()}
          retrying={note.isFetching}
        />
      </div>
    );
  }

  if (!note.data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <NotesHeading />
        <SkeletonRegion label="Loading the note…">
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
            <Skeleton className="min-h-[220px] rounded-md" />
            <Skeleton className="min-h-[220px] rounded-md" />
          </div>
        </SkeletonRegion>
      </div>
    );
  }

  // `key` is the whole of the editor's reset: a different slug is a different
  // editor, and the stored note is its starting text. Reaching this branch
  // twice for one slug must NOT re-seed it — a refetch landing mid-typing
  // would rewrite the textarea under the caret, which is the reason the save
  // writes into the cache instead of invalidating.
  return (
    <NotesEditor
      key={slug}
      slug={slug}
      repoName={repoName}
      stored={note.data.content}
    />
  );
}

/** The panel's title and its status line, shared by all three states. */
function NotesHeading({ status }: { status?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="atr-label font-semibold uppercase tracking-widest text-muted-foreground">
        Notes
      </p>
      {status ?? <p className="atr-meta text-muted-foreground" />}
    </div>
  );
}

/**
 * The editor, mounted only against a note that has actually been read.
 *
 * `stored` is the cache's copy, which the save mutation rewrites with the
 * server's answer. It is not a reset trigger: it is what "nothing to save"
 * is measured against.
 */
function NotesEditor({
  slug,
  repoName,
  stored,
}: {
  slug: string;
  repoName: string;
  /** What the server holds for this repo — the editor's starting text. */
  stored: string;
}) {
  const save = useSaveNote();

  const [text, setText] = React.useState(stored);
  const [status, setStatus] = React.useState<SaveStatus>(
    stored ? "saved" : "idle",
  );

  // Debounced autosave. Skips a no-op edit, so opening a note and closing it
  // writes nothing.
  React.useEffect(() => {
    if (stored === text) {
      // The editor agrees with what is stored: nothing to save. This is not
      // merely "don't fire a save" — it must also CLEAR a `dirty` that a
      // previous pass set, so the status cannot be left reading "Unsaved
      // changes" for an edit that was already persisted.
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
  }, [text, slug, stored]);

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
      <NotesHeading
        status={
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
        }
      />

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
