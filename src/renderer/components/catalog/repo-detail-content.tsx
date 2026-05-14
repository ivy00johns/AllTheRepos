import * as React from "react";
import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import {
  ArrowUpRight,
  Brain,
  Circle,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Hash,
  Plus,
  Tag,
  X,
} from "lucide-react";

import type { RepoDetail } from "@shared/types";

import { cn } from "@renderer/lib/cn";
import { README_SANITIZE_SCHEMA } from "@renderer/lib/markdown";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Separator } from "@renderer/components/ui/separator";
import { ClaudeTab } from "@renderer/components/claude/claude-tab";

import { LanguageBar } from "./language-bar";
import { colorForLanguage } from "./language-colors";
import { relativeTime } from "./relative-time";

// Re-export the schema so other surfaces (e.g. the Claude tab) can
// reuse the same sanitize allowlist without diverging.
export { README_SANITIZE_SCHEMA };

type DetailTab = "details" | "claude";

interface RepoDetailContentProps {
  repo: RepoDetail;
  onClose?: () => void;
  variant?: "panel" | "page";
}

export function RepoDetailContent({
  repo,
  onClose,
  variant = "panel",
}: RepoDetailContentProps) {
  const [tags, setTags] = React.useState<string[]>(
    repo.tags.filter((t) => t.source === "user").map((t) => t.value),
  );
  const [draft, setDraft] = React.useState("");
  const [activeTab, setActiveTab] = React.useState<DetailTab>("details");

  // Reset tab selection whenever the user switches to a different
  // repo — landing on a fresh detail should always show "Details"
  // first.
  React.useEffect(() => {
    setActiveTab("details");
  }, [repo.slug]);

  React.useEffect(() => {
    setTags(repo.tags.filter((t) => t.source === "user").map((t) => t.value));
  }, [repo.slug, repo.tags]);

  const addTag = () => {
    const v = draft.trim().toLowerCase();
    if (!v || tags.includes(v)) return;
    setTags([...tags, v]);
    setDraft("");
    // TODO: wire to `useSetRepoTags` hook (catalog:setTags) — see Phase 1 report.
  };

  const removeTag = (v: string) => {
    setTags(tags.filter((t) => t !== v));
    // TODO: wire to `useSetRepoTags` hook (catalog:setTags) — see Phase 1 report.
  };

  const heuristicTags = repo.tags.filter((t) => t.source !== "user");

  const editorUrl = `vscode://file/${repo.fullPath}`;

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
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{
                backgroundColor: colorForLanguage(repo.primaryLanguage),
              }}
            />
            <h2 className="truncate font-mono text-lg font-semibold">
              {repo.name}
            </h2>
            {repo.isDirty ? (
              <Badge variant="warning" className="gap-1 font-mono">
                <Circle className="h-2 w-2 fill-current" aria-hidden />
                dirty
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground font-mono">
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
            "rounded-sm px-3 py-1 font-mono text-[11px] uppercase tracking-widest transition-colors",
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
            "inline-flex items-center gap-1.5 rounded-sm px-3 py-1 font-mono text-[11px] uppercase tracking-widest transition-colors",
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
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Languages
              </p>
              <LanguageBar languages={repo.languages} />
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
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
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Tags
              </p>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => removeTag(t)}
                    aria-label={`Remove tag ${t}`}
                    className="group inline-flex items-center gap-1 rounded-md border border-border-strong bg-card px-2 py-0.5 font-mono text-[11px] hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  disabled={!draft.trim()}
                  aria-label="Add tag"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            </div>

            {repo.groups.length > 0 ? (
              <>
                <Separator />
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
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
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                README
              </p>
              {repo.readmeContent ? (
                <div className="prose prose-invert prose-sm max-w-none font-sans prose-headings:font-mono prose-code:font-mono prose-code:text-accent prose-a:text-accent">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[
                      rehypeRaw,
                      [rehypeSanitize, README_SANITIZE_SCHEMA],
                    ]}
                  >
                    {repo.readmeContent}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-xs italic text-muted-foreground">
                  No README detected.
                </p>
              )}
            </div>
          </section>
        )}
      </div>

      <footer className="flex items-center gap-2 border-t border-border p-3">
        <Button asChild className="flex-1">
          <a href={editorUrl} aria-label={`Open ${repo.name} in VS Code`}>
            <ExternalLink className="h-4 w-4" aria-hidden />
            Open in VS Code
          </a>
        </Button>
        <Button asChild variant="outline" aria-label="Open full detail page">
          <Link to="/repos/$slug" params={{ slug: repo.slug }}>
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
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
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
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
