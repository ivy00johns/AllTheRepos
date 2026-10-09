import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowUpRight,
  Brain,
  Circle,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Hash,
  Plus,
  Tag,
  Trash2,
  X,
} from "lucide-react";

import type { RepoDetail } from "@shared/types";

import { cn } from "@renderer/lib/cn";
import { useLauncher, useLauncherDetect } from "@renderer/hooks/use-launcher";
import { useDeleteRepo, useSetRepoTags } from "@renderer/hooks/use-repos";
import { Markdown } from "@renderer/components/markdown";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Separator } from "@renderer/components/ui/separator";
import { ClaudeTab } from "@renderer/components/claude/claude-tab";

import { useCover } from "@renderer/hooks/use-cover";
import type { TaskRunState } from "@renderer/hooks/use-actions";
import { RelatedRepos } from "./related-repos";
import { FavoriteStar } from "./favorite-star";
import { TaskRunner } from "./task-runner";
import { cleanDescription } from "@renderer/lib/describe";

import { LanguageBar } from "./language-bar";
import { RepoCover } from "./repo-cover";
import { colorForLanguage } from "./language-colors";
import { relativeTime } from "./relative-time";

type DetailTab = "details" | "claude";

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
  const cover = useCover(repo.slug);
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
  const { openInEditor } = useLauncher();
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
    setOpenError(result.ok ? null : (result.reason ?? "Could not open editor."));
  }, [openInEditor, repo.slug]);

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
        "flex h-full flex-col overflow-hidden bg-card text-card-foreground",
        variant === "panel"
          ? "border-l border-border"
          : "rounded-lg border border-border",
      )}
    >
      <header className="flex items-start gap-3 border-b border-border p-4">
        <RepoCover
          slug={repo.slug}
          name={repo.name}
          imageSrc={cover.data?.src}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FavoriteStar
              slug={repo.slug}
              name={repo.name}
              isFavorite={repo.isFavorite}
            />
            <h2 className="truncate font-mono text-lg font-semibold">
              {repo.name}
            </h2>
            {repo.missing ? (
              <Badge
                variant="destructive"
                className="gap-1 font-mono"
                title={`${repo.fullPath} no longer exists on disk`}
              >
                missing
              </Badge>
            ) : null}
            {repo.isDirty ? (
              <Badge variant="warning" className="gap-1 font-mono">
                <Circle className="h-2 w-2 fill-current" aria-hidden />
                dirty
              </Badge>
            ) : null}
          </div>
          {/*
            The repaired one-liner sits directly under the name because
            it answers "what IS this" — the question the panel exists to
            answer — before any path or git metadata.
          */}
          {description ? (
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              {description}
            </p>
          ) : null}
          <p className="atr-micro mt-1 truncate font-mono text-muted-foreground/80">
            {repo.fullPath}
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail panel"
            className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
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

      <div
        role="tablist"
        aria-label="Repo detail tabs"
        className="flex shrink-0 items-center gap-1 border-b border-border bg-card px-3 py-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "details"}
          onClick={() => setActiveTab("details")}
          className={cn(
            "atr-label rounded-sm px-3 py-1 font-mono uppercase tracking-widest transition-colors",
            activeTab === "details"
              ? "bg-accent/15 text-accent"
              : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
          )}
        >
          Details
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "claude"}
          onClick={() => setActiveTab("claude")}
          className={cn(
            "atr-label inline-flex items-center gap-1.5 rounded-sm px-3 py-1 font-mono uppercase tracking-widest transition-colors",
            activeTab === "claude"
              ? "bg-accent/15 text-accent"
              : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
          )}
        >
          <Brain className="h-3 w-3" aria-hidden />
          Claude
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "claude" ? (
          <div className="p-4">
            <ClaudeTab slug={repo.slug} repoName={repo.name} />
          </div>
        ) : (
          <section className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Meta
                icon={<GitBranch className="h-3.5 w-3.5" aria-hidden />}
                label="Branch"
                value={repo.currentBranch ?? "—"}
                mono
              />
              <Meta
                icon={<Hash className="h-3.5 w-3.5" aria-hidden />}
                label="Last commit"
                value={relativeTime(repo.lastCommitDate)}
              />
              <Meta
                icon={<FolderGit2 className="h-3.5 w-3.5" aria-hidden />}
                label="Remote"
                value={
                  repo.remoteUrl ? (
                    <span className="truncate font-mono">{repo.remoteUrl}</span>
                  ) : (
                    <span className="italic text-muted-foreground">none</span>
                  )
                }
              />
              <Meta
                icon={<Tag className="h-3.5 w-3.5" aria-hidden />}
                label="Primary"
                value={
                  repo.primaryLanguage ?? (
                    <span className="italic text-muted-foreground">
                      unknown
                    </span>
                  )
                }
              />
            </div>

            <div>
              <p className="atr-label mb-1.5 font-semibold uppercase tracking-widest text-muted-foreground">
                Languages
              </p>
              <LanguageBar languages={repo.languages} />
              <div className="atr-label mt-2 flex flex-wrap gap-2">
                {repo.languages.map((l) => (
                  <span
                    key={l.name}
                    className="inline-flex items-center gap-1.5 text-muted-foreground"
                  >
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: l.color || colorForLanguage(l.name),
                      }}
                    />
                    {l.name}
                  </span>
                ))}
              </div>
            </div>

            <Separator />

            <div>
              <p className="atr-label mb-2 font-semibold uppercase tracking-widest text-muted-foreground">
                Tags
              </p>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => removeTag(t)}
                    disabled={setRepoTags.isPending}
                    aria-label={`Remove tag ${t}`}
                    className="atr-micro group inline-flex items-center gap-1 rounded-md border border-border-strong bg-card px-2 py-0.5 font-mono hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    {t}
                    <X
                      className="h-3 w-3 text-muted-foreground group-hover:text-destructive"
                      aria-hidden
                    />
                  </button>
                ))}
                {heuristicTags.map((t) => (
                  <Badge
                    key={`h-${t.value}`}
                    variant="secondary"
                    className="font-mono"
                    title={`${t.source} tag (not editable)`}
                  >
                    {t.value}
                  </Badge>
                ))}
              </div>
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
                  placeholder="Add tag..."
                  aria-label="New tag"
                  className="h-8"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addTag}
                  disabled={!draft.trim() || setRepoTags.isPending}
                  aria-label="Add tag"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            </div>

            <Separator />

            <RelatedRepos
              slug={repo.slug}
              repoName={repo.name}
              onOpenRepo={onOpenRepo}
            />

            {repo.groups.length > 0 ? (
              <>
                <Separator />
                <div>
                  <p className="atr-label mb-2 font-semibold uppercase tracking-widest text-muted-foreground">
                    Groups
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {repo.groups.map((g) => (
                      <Badge key={g.id} variant="default">
                        {g.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            ) : null}

            <Separator />

            <div>
              <p className="atr-label mb-2 font-semibold uppercase tracking-widest text-muted-foreground">
                README
              </p>
              {repo.readmeContent ? (
                <Markdown>{repo.readmeContent}</Markdown>
              ) : (
                <p className="text-xs italic text-muted-foreground">
                  No README detected.
                </p>
              )}
            </div>
          </section>
        )}
      </div>

      <footer className="flex flex-col gap-1.5 border-t border-border p-3">
        <div className="flex items-center gap-2">
          {repo.missing ? (
            <Button
              className="flex-1"
              disabled
              title="Folder not found on disk — nothing to open"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              {openLabel}
            </Button>
          ) : (
            <Button
              className="flex-1"
              aria-label={`Open ${repo.name} with the default editor`}
              title={openLabel}
              onClick={() => void handleOpenInEditor()}
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              {openLabel}
            </Button>
          )}
          <Button asChild variant="outline" aria-label="Open full detail page">
            <Link to="/repos/$slug" params={{ slug: repo.slug }}>
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>
        {openError ? (
          <p
            role="status"
            aria-live="polite"
            className="atr-label font-mono text-destructive"
          >
            {openError}
          </p>
        ) : null}
      </footer>
    </div>
  );
}

interface MetaProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

function Meta({ icon, label, value, mono }: MetaProps) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="atr-label flex items-center gap-1.5 uppercase tracking-widest text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={cn("truncate text-foreground", mono && "font-mono text-xs")}
      >
        {value}
      </div>
    </div>
  );
}
