import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  FolderPlus,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import type { RepoDetail } from "@shared/types";

import { cn } from "@renderer/lib/cn";
import { useLauncher, useLauncherDetect } from "@renderer/hooks/use-launcher";
import { useProcessesForRepo } from "@renderer/hooks/use-processes";
import { useDeleteRepo, useSetRepoTags } from "@renderer/hooks/use-repos";
import {
  useAddGroupMembers,
  useGroups,
  useRemoveGroupMembers,
} from "@renderer/hooks/use-groups";
import { CreateGroupDialog } from "@renderer/components/groups/group-dialogs";
import { Markdown } from "@renderer/components/markdown";
import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { Input } from "@renderer/components/ui/input";
import { ClaudeTab } from "@renderer/components/claude/claude-tab";
import { useUiStore } from "@renderer/stores/ui";

import type { TaskRunState } from "@renderer/hooks/use-actions";
import { formatSize } from "@renderer/lib/format-size";
import { NotesTab } from "./notes-tab";
import { RelatedRepos } from "./related-repos";
import { FavoriteStar } from "./favorite-star";
import { TaskRunner } from "./task-runner";
import { cleanDescription } from "@renderer/lib/describe";

import { LanguageBar } from "./language-bar";
import { colorForLanguage } from "./language-colors";
import { relativeTime } from "./relative-time";

type DetailTab = "details" | "notes" | "claude";

interface RepoDetailContentProps {
  repo: RepoDetail;
  onClose?: () => void;
  variant?: "panel" | "page";
  /** Live task output, keyed by run id. */
  taskRuns?: Record<string, TaskRunState>;
  onClearRun?: (runId: string) => void;
  /** Open another repo — the Related list uses this to hop the panel. */
  onOpenRepo?: (slug: string) => void;
}

export function RepoDetailContent({
  repo,
  onClose,
  variant = "panel",
  taskRuns,
  onClearRun,
  onOpenRepo,
}: RepoDetailContentProps) {
  const [tags, setTags] = React.useState<string[]>(
    repo.tags.filter((t) => t.source === "user").map((t) => t.value),
  );
  const [draft, setDraft] = React.useState("");
  const [addingTag, setAddingTag] = React.useState(false);
  const { processes } = useProcessesForRepo(repo.slug);
  const port = processes[0]?.port ?? null;
  const size = formatSize(repo.sizeBytes);
  const page = variant === "page";
  // Full README is available here, so the fallback has far more to work
  // with than the 2 KB preview the list rows carry.
  const description = React.useMemo(
    () => cleanDescription(repo.description, repo.readmeContent),
    [repo.description, repo.readmeContent],
  );
  const [activeTab, setActiveTab] = React.useState<DetailTab>("details");
  // ATR-028: two-step confirm for "Remove from catalog" — no blocking
  // window.confirm, no accidental one-click deletes.
  const [confirmingRemove, setConfirmingRemove] = React.useState(false);

  const setRepoTags = useSetRepoTags();
  const deleteRepo = useDeleteRepo();

  // "Open in editor" must launch whatever the launcher will actually
  // launch — the resolved default, not a hardcoded scheme. Naming the app
  // in the button makes the default visible where it is used.
  const { openInEditor, openInTerminal, openInFinder, copyPath } =
    useLauncher();
  const detect = useLauncherDetect();
  const [openError, setOpenError] = React.useState<string | null>(null);
  const defaultEditorName = React.useMemo(() => {
    const id = detect.data?.defaults.editor;
    if (!id) return null;
    return detect.data?.editors.find((e) => e.id === id)?.name ?? null;
  }, [detect.data]);
  const openLabel = defaultEditorName
    ? `Open in ${defaultEditorName}`
    : "Open in editor";

  const handleOpenInEditor = React.useCallback(async () => {
    const result = await openInEditor(repo.slug);
    setOpenError(
      result.ok ? null : (result.reason ?? "Could not open editor."),
    );
  }, [openInEditor, repo.slug]);

  const handleOpenInTerminal = React.useCallback(async () => {
    const result = await openInTerminal(repo.slug);
    setOpenError(
      result.ok ? null : (result.reason ?? "Could not open a terminal."),
    );
  }, [openInTerminal, repo.slug]);

  const handleRemoveFromCatalog = () => {
    deleteRepo.mutate(
      { slug: repo.slug },
      {
        onSuccess: () => {
          // Panel variant: collapse the panel. Page variant: the route
          // component re-renders its not-found state once the detail
          // query invalidates; closing is still the friendlier exit.
          onClose?.();
        },
      },
    );
  };

  // Reset tab selection whenever the user switches to a different
  // repo — landing on a fresh detail should always show "Details"
  // first.
  React.useEffect(() => {
    setActiveTab("details");
    setConfirmingRemove(false);
  }, [repo.slug]);

  React.useEffect(() => {
    setTags(repo.tags.filter((t) => t.source === "user").map((t) => t.value));
  }, [repo.slug, repo.tags]);

  // Persist the full desired USER-tag set via `catalog:setTags`. The
  // server overwrites user tags and preserves heuristic/smart tags, so
  // we only ever send the user-editable values. Local state is updated
  // optimistically; on success the invalidated repo-detail query reseeds
  // `tags` from the canonical server response (the effect above).
  const persistTags = (next: string[]) => {
    setRepoTags.mutate(
      { slug: repo.slug, tags: next },
      {
        onError: () => {
          // Roll back to the server's last-known user tags on failure so
          // the UI never claims a tag stuck when it didn't.
          setTags(
            repo.tags.filter((t) => t.source === "user").map((t) => t.value),
          );
        },
      },
    );
  };

  const addTag = () => {
    const v = draft.trim().toLowerCase();
    if (!v || tags.includes(v)) return;
    const next = [...tags, v];
    setTags(next);
    setDraft("");
    persistTags(next);
  };

  const removeTag = (v: string) => {
    const next = tags.filter((t) => t !== v);
    setTags(next);
    persistTags(next);
  };

  const heuristicTags = repo.tags.filter((t) => t.source !== "user");

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden text-foreground",
        page ? "bg-background" : "border-l border-border bg-surface",
      )}
    >
      {/*
        The header is the handoff's: the name is the largest thing on the
        screen, the path and the description answer "what is this" under it,
        and the action row is Open / Terminal / … rather than a full-width
        green footer button. The page variant opens the name at the display
        tier on a full-bleed bar, with its actions on the same line. The panel
        is 320–440px wide, where a title and five controls on one line leave
        the name about ninety pixels: there, the close sits on the title's own
        line and the actions take a row of their own underneath, which is the
        handoff's order.
      */}
      <header
        className={cn(
          "shrink-0 border-b border-border",
          page ? "px-6 pb-5 pt-8" : "px-5 pb-4 pt-5",
        )}
      >
        <div className={cn(page ? "flex items-start gap-4" : "flex flex-col")}>
          <div className={cn("relative min-w-0 flex-1", !page && "pr-10")}>
            {/*
              The page is reached from the top bar or the panel's "open full
              detail page" link; without this line the only way back was the
              wordmark, which is a destination, not a back control. The
              standalone page had a Back button before the redesign and the
              quiet link keeps that affordance without reintroducing a second
              header bar.
            */}
            {page ? (
              <Link
                to="/"
                className="mb-2 inline-flex items-center gap-1.5 text-label font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                Back to catalog
              </Link>
            ) : null}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h2
                className={cn(
                  "m-0 min-w-0 truncate font-semibold text-foreground",
                  page ? "text-display" : "text-name-lg",
                )}
              >
                {repo.name}
              </h2>
              <FavoriteStar
                slug={repo.slug}
                name={repo.name}
                isFavorite={repo.isFavorite}
              />
              {repo.missing ? (
                <span
                  className="atr-meta text-destructive"
                  title={`${repo.fullPath} no longer exists on disk`}
                >
                  missing
                </span>
              ) : null}
              {repo.isDirty ? (
                <span className="atr-meta text-warning">uncommitted</span>
              ) : null}
            </div>
            <p className="atr-meta mt-1.5 truncate" title={repo.fullPath}>
              {repo.fullPath}
            </p>
            {description ? (
              <p
                className={cn(
                  "text-body text-muted-foreground",
                  page ? "mt-3 max-w-[68ch]" : "mt-2",
                )}
              >
                {description}
              </p>
            ) : null}
            {!page && onClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close detail panel"
                className="absolute right-0 top-0 grid h-8 w-8 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>

          <div
            className={cn(
              "flex items-center gap-1.5",
              page ? "shrink-0" : "mt-3",
            )}
          >
            <Button
              size="sm"
              aria-label={`Open ${repo.name} with the default editor`}
              title={openLabel}
              disabled={repo.missing}
              onClick={() => void handleOpenInEditor()}
            >
              Open
              <kbd
                aria-hidden
                className="rounded border border-background/30 px-1 font-mono atr-micro text-background/60"
              >
                ↵
              </kbd>
            </Button>
            <Button
              size="sm"
              variant="bordered"
              aria-label="Open in terminal"
              title="Open a terminal at this repo"
              disabled={repo.missing}
              onClick={() => void handleOpenInTerminal()}
            >
              Terminal
            </Button>
            {page ? null : (
              <Button
                asChild
                variant="bordered"
                size="sm"
                className="h-8 w-8 px-0"
              >
                <Link
                  to="/repos/$slug"
                  params={{ slug: repo.slug }}
                  aria-label="Open full detail page"
                  title="Open full detail page"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="bordered"
                  size="sm"
                  className="h-8 w-8 px-0"
                  aria-label="More repo actions"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={repo.missing}
                  onSelect={() => void openInFinder(repo.slug)}
                >
                  Reveal in Finder
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={repo.missing}
                  onSelect={() => void copyPath(repo.slug)}
                >
                  Copy path
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={repo.missing}
                  onSelect={() => setConfirmingRemove(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Remove from catalog…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {openError ? (
          <p
            role="status"
            aria-live="polite"
            className="atr-meta mt-2 text-destructive"
          >
            {openError}
          </p>
        ) : null}
      </header>

      {!repo.missing ? (
        <div className="shrink-0 empty:hidden [&:has(section)]:border-b [&:has(section)]:border-border">
          <TaskRunner
            slug={repo.slug}
            runs={taskRuns ?? {}}
            onClearRun={onClearRun ?? (() => {})}
          />
        </div>
      ) : null}

      {repo.missing ? (
        <div
          role="alert"
          className="flex flex-col gap-2 border-b border-border bg-destructive/10 p-3 text-xs"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
              aria-hidden
            />
            <div className="min-w-0">
              <p className="font-semibold text-destructive">
                Folder not found on disk
              </p>
              <p className="mt-0.5 text-muted-foreground">
                <span className="font-mono">{repo.fullPath}</span> no longer
                exists — the project was moved or deleted. If it was moved, run
                a scan and this entry relinks automatically (tags and groups
                included). If it&apos;s gone for good, you can remove the entry;
                only the catalog row is deleted, never files.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            {confirmingRemove ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmingRemove(false)}
                  disabled={deleteRepo.isPending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleRemoveFromCatalog}
                  disabled={deleteRepo.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  {deleteRepo.isPending
                    ? "Removing…"
                    : "Confirm — remove entry"}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmingRemove(true)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Remove from catalog…
              </Button>
            )}
          </div>
          {deleteRepo.isError ? (
            <p className="text-destructive">
              {deleteRepo.error.message || "Failed to remove the entry."}
            </p>
          ) : null}
        </div>
      ) : null}

      {/*
        Details · Notes · Claude: a 40px bar with an ink underline on the
        active tab, the same tab gesture as the catalog toolbar. The old tabs
        were pill buttons tinted with the accent, so the panel had a second
        selected-state vocabulary of its own.
      */}
      <div
        role="tablist"
        aria-label="Repo detail tabs"
        className={cn(
          "flex shrink-0 items-stretch gap-4 border-b border-border",
          page ? "px-6" : "px-5",
        )}
      >
        {(
          [
            { id: "details", label: "Details" },
            { id: "notes", label: "Notes" },
            { id: "claude", label: "Claude" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex h-10 cursor-pointer items-center text-label font-medium transition-colors duration-150",
              activeTab === tab.id
                ? "text-foreground shadow-[inset_0_-2px_0_var(--color-foreground)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "claude" ? (
          <div className="p-4">
            <ClaudeTab slug={repo.slug} repoName={repo.name} />
          </div>
        ) : activeTab === "notes" ? (
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <NotesTab slug={repo.slug} repoName={repo.name} />
          </div>
        ) : (
          <section className={cn(page ? "px-6 pb-16 pt-2" : "px-5 pb-6 pt-2")}>
            {/*
              The page's one measure. The handoff asks for a full-bleed header
              and then a single 68ch column; the header earns the width, the
              content does not. Before this the definition list happened to be
              narrow while the language bar and the related rows ran the full
              window, which read as three different layouts stacked.
            */}
            <div
              className={cn(
                "flex flex-col gap-7",
                page && "w-full max-w-[68ch]",
              )}
            >
              <div className={cn(page && "w-full max-w-[68ch]")}>
                <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                  <Field label="Branch">{repo.currentBranch ?? "—"}</Field>
                  <Field label="Last commit">
                    {relativeTime(repo.lastCommitDate)}
                  </Field>
                  <Field label="Status">
                    {repo.isDirty ? (
                      <span className="text-warning">Uncommitted changes</span>
                    ) : (
                      "Clean"
                    )}
                  </Field>
                  <Field label="Remote">
                    {repo.remoteUrl ? (
                      <span className="font-mono" title={repo.remoteUrl}>
                        {repo.remoteUrl}
                      </span>
                    ) : (
                      <span className="italic">None — local only</span>
                    )}
                  </Field>
                  <Field label="Size">{size ?? "—"}</Field>
                  <Field label="Port">
                    {port !== null ? (
                      <span className="text-status-live">
                        :{port} listening
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not running</span>
                    )}
                  </Field>
                </dl>
              </div>

              <div>
                <p className="atr-eyebrow">Languages</p>
                <LanguageBar languages={repo.languages} className="mt-2" />
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {repo.languages.map((l) => {
                    const total = repo.languages.reduce(
                      (sum, entry) => sum + entry.bytes,
                      0,
                    );
                    return (
                      <span
                        key={l.name}
                        className="inline-flex items-center gap-1.5 atr-meta"
                      >
                        <span
                          aria-hidden
                          className="h-2.5 w-0.5"
                          style={{
                            backgroundColor:
                              l.color || colorForLanguage(l.name),
                          }}
                        />
                        <span className="text-foreground">{l.name}</span>
                        <span>{Math.round((l.bytes / total) * 100)}%</span>
                      </span>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="atr-eyebrow">Tags</p>
                  <button
                    type="button"
                    onClick={() => setAddingTag((open) => !open)}
                    className="cursor-pointer text-label font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
                  >
                    {addingTag ? "Done" : "Add"}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => removeTag(t)}
                      disabled={setRepoTags.isPending}
                      aria-label={`Remove tag ${t}`}
                      className="group inline-flex cursor-pointer items-center gap-1 rounded border border-border px-1.5 py-1 font-mono atr-meta text-foreground transition-colors hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    >
                      {t}
                      <X
                        className="h-3 w-3 text-muted-foreground group-hover:text-destructive"
                        aria-hidden
                      />
                    </button>
                  ))}
                  {heuristicTags.map((t) => (
                    <span
                      key={`h-${t.value}`}
                      className="rounded border border-border/60 px-1.5 py-1 font-mono atr-meta"
                      title={`${t.source} tag (not editable)`}
                    >
                      {t.value}
                    </span>
                  ))}
                  {tags.length === 0 && heuristicTags.length === 0 ? (
                    <span className="atr-meta italic">No tags yet.</span>
                  ) : null}
                </div>
                {addingTag ? (
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      placeholder="Add tag…"
                      aria-label="New tag"
                      autoFocus
                      className="h-8 max-w-[240px]"
                    />
                    <Button
                      size="sm"
                      variant="bordered"
                      onClick={addTag}
                      disabled={!draft.trim() || setRepoTags.isPending}
                      aria-label="Add tag"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </div>

              <RelatedRepos
                slug={repo.slug}
                repoName={repo.name}
                onOpenRepo={onOpenRepo}
              />

              <GroupMembership repo={repo} />

              <div className={cn(page && "max-w-[68ch]")}>
                <p className="atr-eyebrow">Readme</p>
                {repo.readmeContent ? (
                  <div className="mt-3">
                    <Markdown>{repo.readmeContent}</Markdown>
                  </div>
                ) : (
                  <p className="mt-2 text-body italic text-muted-foreground">
                    No README detected.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * One definition-list cell: a sentence-case label over its value, closed by a
 * hairline. The fields are the panel's second question — after "what is
 * this", the git state and where it listens — so the label is 12/500 muted
 * and the value is the 13px the rest of the content is set in.
 */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 border-b border-border py-3">
      <dt className="text-label font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 min-w-0 truncate text-body text-foreground">
        {children}
      </dd>
    </div>
  );
}

/**
 * This repo's group memberships, and the only place one repo joins or leaves a
 * group on its own.
 *
 * The toolbar's "Add to group" acts on a selection, and a selection is built
 * with ⌘-click — a gesture nothing on screen advertises. So the same operation
 * is offered here, where a person already is when they are thinking about one
 * repo, and where no modifier key is needed.
 *
 * The badges are held in local state rather than rendered straight from
 * `repo.groups`. The panel's detail object is fetched once per repo by the
 * shell, so a membership written here would not appear until the repo was
 * reopened; the local list is updated when the write succeeds, and the
 * invalidation in the mutation hooks corrects it on the next load. The
 * mutations themselves re-read the group before writing, so "add" and "remove"
 * are safe against a stale list no matter what this panel is showing.
 */
function GroupMembership({ repo }: { repo: RepoDetail }) {
  const groupsQuery = useGroups();
  const addMembers = useAddGroupMembers();
  const removeMembers = useRemoveGroupMembers();
  const pushNotice = useUiStore((s) => s.pushNotice);

  const [memberships, setMemberships] = React.useState(repo.groups);
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    setMemberships(repo.groups);
  }, [repo.slug, repo.groups]);

  const memberIds = React.useMemo(
    () => new Set(memberships.map((group) => group.id)),
    [memberships],
  );
  const addable = (groupsQuery.data ?? []).filter(
    (group) => !group.isSmart && !memberIds.has(group.id),
  );

  const pending = addMembers.isPending || removeMembers.isPending;

  const add = (groupId: number, name: string) => {
    addMembers.mutate(
      { groupId, slugs: [repo.slug] },
      {
        onSuccess: (result) => {
          if (result.added === 0) {
            pushNotice(`${repo.name} is already in ${name}`);
            return;
          }
          setMemberships((prev) =>
            prev.some((group) => group.id === groupId)
              ? prev
              : [...prev, { id: groupId, name }],
          );
          pushNotice(`Added ${repo.name} to ${name}`);
        },
        onError: (error) =>
          pushNotice(
            `Could not add ${repo.name} to ${name} — ${error.message}`,
          ),
      },
    );
  };

  const remove = (groupId: number, name: string) => {
    removeMembers.mutate(
      { groupId, slugs: [repo.slug] },
      {
        onSuccess: (result) => {
          if (result.removed === 0) {
            pushNotice(`${repo.name} was not in ${name}`);
            return;
          }
          setMemberships((prev) =>
            prev.filter((group) => group.id !== groupId),
          );
          pushNotice(`Removed ${repo.name} from ${name}`);
        },
        onError: (error) =>
          pushNotice(
            `Could not remove ${repo.name} from ${name} — ${error.message}`,
          ),
      },
    );
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="atr-eyebrow">Groups</p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={pending}
              className="cursor-pointer text-label font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:cursor-wait disabled:opacity-60"
            >
              Add to group
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Add to</DropdownMenuLabel>
            {addable.length === 0 ? (
              <p className="px-2 pb-1.5 text-xs text-muted-foreground">
                Already in every group.
              </p>
            ) : (
              addable.map((group) => (
                <DropdownMenuItem
                  key={group.id}
                  onSelect={() => add(group.id, group.name)}
                >
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <span className="font-mono atr-micro text-muted-foreground">
                    {group.repoCount}
                  </span>
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setCreating(true)}>
              <FolderPlus className="h-3.5 w-3.5" aria-hidden />
              New group…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {memberships.length === 0 ? (
        <p className="mt-2 text-body italic text-muted-foreground">
          Not in a group.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {memberships.map((group) => (
            <span
              key={group.id}
              className="inline-flex items-center gap-1 rounded border border-border py-1 pl-2 pr-1 font-mono atr-meta text-foreground"
            >
              {group.name}
              <button
                type="button"
                aria-label={`Remove ${repo.name} from ${group.name}`}
                title={`Remove from ${group.name}`}
                disabled={pending}
                onClick={() => remove(group.id, group.name)}
                className="cursor-pointer rounded-sm p-0.5 text-muted-foreground transition-colors duration-150 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}

      <CreateGroupDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(group) => add(group.id, group.name)}
      />
    </div>
  );
}
