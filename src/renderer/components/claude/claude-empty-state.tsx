/**
 * ClaudeEmptyState — rendered when a repo has no `.claude/`
 * directory and no entry in `~/.claude.json`.
 *
 * A sentence on the page rather than a dashed box with a sparkle badge: the
 * handoff's empty states are a muted line plus the one thing to do, and the
 * copy still carries the phrase the e2e suite looks for ("hasn't met Claude
 * yet").
 */

import { FileText } from "lucide-react";

interface ClaudeEmptyStateProps {
  repoName?: string;
}

export function ClaudeEmptyState({ repoName }: ClaudeEmptyStateProps) {
  return (
    <div className="flex flex-col gap-2 py-2">
      <p className="text-body text-foreground">
        {repoName
          ? `${repoName} hasn’t met Claude yet.`
          : "No Claude state yet."}
      </p>
      <p className="max-w-prose text-body leading-relaxed text-muted-foreground">
        Add a{" "}
        <span className="inline-flex items-center gap-1 font-mono text-label text-foreground">
          <FileText className="h-3 w-3" aria-hidden />
          CLAUDE.md
        </span>{" "}
        file to the repo root, or run{" "}
        <code className="font-mono text-label text-foreground">claude</code>{" "}
        inside the repo to create a project entry. Skills, agents, MCP servers
        and sessions appear here once Claude Code touches the directory.
      </p>
    </div>
  );
}
