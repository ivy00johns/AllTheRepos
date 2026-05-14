/**
 * ClaudeEmptyState — rendered when a repo has no `.claude/`
 * directory and no entry in `~/.claude.json`.
 *
 * Friendly CTA explaining how to start using Claude Code with this
 * repo. Pure presentation — no IPC calls.
 */

import { FileText, Sparkles } from "lucide-react";

interface ClaudeEmptyStateProps {
  repoName?: string;
}

export function ClaudeEmptyState({ repoName }: ClaudeEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Sparkles className="h-5 w-5" aria-hidden />
      </div>
      <div>
        <p className="font-mono text-sm text-foreground">
          {repoName
            ? `${repoName} hasn’t met Claude yet.`
            : "No Claude state yet."}
        </p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          Add a{" "}
          <span className="inline-flex items-center gap-1 font-mono text-foreground">
            <FileText className="h-3 w-3" aria-hidden />
            CLAUDE.md
          </span>{" "}
          file to the repo root, or run{" "}
          <code className="font-mono">claude</code> inside the repo to create a
          project entry. Skills, agents, MCP servers, and sessions will appear
          here once Claude Code touches the directory.
        </p>
      </div>
    </div>
  );
}
