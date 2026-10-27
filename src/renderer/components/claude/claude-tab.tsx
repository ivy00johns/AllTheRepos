/**
 * ClaudeTab — Claude state surface for one repo, rendered inside the
 * repo-detail panel.
 *
 * Layout (top → bottom):
 *   1. Header actions: "Launch Claude Code" (primary), "Edit CLAUDE.md".
 *   2. CLAUDE.md preview (markdown, sanitized).
 *   3. Skills section — grid of ClaudeSkillCard.
 *   4. Agents section — grid of ClaudeAgentCard.
 *   5. MCP servers — list of ClaudeMcpRow.
 *   6. Sessions table — ClaudeSessionsTable.
 *
 * Fallbacks:
 *   - Bridge missing → "bridge unavailable" notice.
 *   - `hasClaude=false` → `<ClaudeEmptyState />`.
 *   - Empty subsection → italic "No skills configured." note.
 */

import * as React from "react";
import { Edit, PlayCircle } from "lucide-react";

import { Button } from "@renderer/components/ui/button";
import { Separator } from "@renderer/components/ui/separator";
import {
  useClaudeRepoState,
  useLaunchClaude,
  useOpenClaudeMd,
} from "@renderer/hooks/use-claude";
import { getAtr } from "@renderer/lib/atr";
import { Markdown } from "@renderer/components/markdown";

import { ClaudeAgentCard } from "./claude-agent-card";
import { ClaudeEmptyState } from "./claude-empty-state";
import { ClaudeMcpRow } from "./claude-mcp-row";
import { ClaudeSessionsTable } from "./claude-sessions-table";
import { ClaudeSkillCard } from "./claude-skill-card";

interface ClaudeTabProps {
  slug: string;
  repoName?: string;
}

export function ClaudeTab({ slug, repoName }: ClaudeTabProps) {
  const bridgeAvailable = typeof window !== "undefined" && Boolean(getAtr());
  const stateQuery = useClaudeRepoState(bridgeAvailable ? slug : null);
  const launch = useLaunchClaude();
  const openClaudeMd = useOpenClaudeMd();
  const [launchError, setLaunchError] = React.useState<string | null>(null);
  const [launching, setLaunching] = React.useState(false);
  const [openingMd, setOpeningMd] = React.useState(false);

  if (!bridgeAvailable) {
    return (
      <p className="text-body text-muted-foreground">
        Claude integration unavailable — the preload bridge is missing. Run via{" "}
        <code className="font-mono text-label">pnpm electron:dev</code>.
      </p>
    );
  }

  if (stateQuery.isLoading) {
    return (
      <p aria-busy="true" className="text-body text-muted-foreground">
        Loading Claude state…
      </p>
    );
  }

  if (stateQuery.error) {
    return (
      <div className="border-l-2 border-destructive py-1 pl-3">
        <p className="text-body font-medium text-destructive">
          Failed to load Claude state
        </p>
        <pre className="mt-1 overflow-x-auto font-mono atr-meta">
          {stateQuery.error.message}
        </pre>
      </div>
    );
  }

  const state = stateQuery.data;
  if (!state || !state.hasClaude) {
    return <ClaudeEmptyState repoName={repoName} />;
  }

  const handleLaunch = async () => {
    setLaunchError(null);
    setLaunching(true);
    const result = await launch(slug);
    setLaunching(false);
    if (!result.ok) {
      setLaunchError(result.reason ?? "Failed to launch Claude Code");
    }
  };

  const handleOpenClaudeMd = async () => {
    setLaunchError(null);
    setOpeningMd(true);
    const result = await openClaudeMd(slug);
    setOpeningMd(false);
    if (!result.ok) {
      setLaunchError(result.reason ?? "Failed to open CLAUDE.md");
    }
  };

  const tokens = state.totalTokens.toLocaleString();

  return (
    <div className="space-y-5">
      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={handleLaunch}
          disabled={launching}
          aria-label="Launch Claude Code in this repo"
        >
          <PlayCircle className="h-4 w-4" aria-hidden />
          {launching ? "Launching…" : "Launch Claude Code"}
        </Button>
        <Button
          variant="bordered"
          onClick={handleOpenClaudeMd}
          disabled={openingMd || !state.claudeMdPath}
          aria-label="Edit CLAUDE.md"
        >
          <Edit className="h-4 w-4" aria-hidden />
          {openingMd ? "Opening…" : "Edit CLAUDE.md"}
        </Button>
        <span className="ml-auto atr-meta">
          {tokens} tokens · {state.sessions.length} session
          {state.sessions.length === 1 ? "" : "s"}
        </span>
      </div>

      {launchError ? (
        <p className="border-l-2 border-destructive py-1 pl-3 text-body text-destructive">
          {launchError}
        </p>
      ) : null}

      {/* CLAUDE.md preview */}
      <section aria-labelledby="claude-md-heading">
        <SectionHeading id="claude-md-heading">CLAUDE.md</SectionHeading>
        {state.claudeMdContent ? (
          <div className="rounded-md border border-border bg-surface p-4">
            <Markdown>{state.claudeMdContent}</Markdown>
          </div>
        ) : (
          <p className="text-body italic text-muted-foreground">
            No CLAUDE.md detected at the repo root.
          </p>
        )}
      </section>

      <Separator />

      {/* Skills */}
      <section aria-labelledby="claude-skills-heading">
        <SectionHeading id="claude-skills-heading">
          Skills <CountBadge n={state.skills.length} />
        </SectionHeading>
        {state.skills.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {state.skills.map((s) => (
              <ClaudeSkillCard key={s.path} skill={s} />
            ))}
          </div>
        ) : (
          <p className="text-body italic text-muted-foreground">
            No skills configured under{" "}
            <code className="font-mono text-label">.claude/skills/</code>.
          </p>
        )}
      </section>

      <Separator />

      {/* Agents */}
      <section aria-labelledby="claude-agents-heading">
        <SectionHeading id="claude-agents-heading">
          Agents <CountBadge n={state.agents.length} />
        </SectionHeading>
        {state.agents.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {state.agents.map((a) => (
              <ClaudeAgentCard key={a.path} agent={a} />
            ))}
          </div>
        ) : (
          <p className="text-body italic text-muted-foreground">
            No agents configured under{" "}
            <code className="font-mono text-label">.claude/agents/</code>.
          </p>
        )}
      </section>

      <Separator />

      {/* MCP servers */}
      <section aria-labelledby="claude-mcp-heading">
        <SectionHeading id="claude-mcp-heading">
          MCP servers <CountBadge n={state.mcpServers.length} />
        </SectionHeading>
        {state.mcpServers.length > 0 ? (
          <div className="space-y-1.5">
            {state.mcpServers.map((m) => (
              <ClaudeMcpRow key={`${m.configuredIn}-${m.name}`} server={m} />
            ))}
          </div>
        ) : (
          <p className="text-body italic text-muted-foreground">
            No MCP servers configured for this repo.
          </p>
        )}
      </section>

      <Separator />

      {/* Sessions */}
      <section aria-labelledby="claude-sessions-heading">
        <SectionHeading id="claude-sessions-heading">
          Sessions <CountBadge n={state.sessions.length} />
        </SectionHeading>
        <ClaudeSessionsTable slug={slug} sessions={state.sessions} />
      </section>
    </div>
  );
}

interface SectionHeadingProps {
  id: string;
  children: React.ReactNode;
}

/** A section name, not an eyebrow: sentence case at the 12px tier. */
function SectionHeading({ id, children }: SectionHeadingProps) {
  return (
    <h3
      id={id}
      className="mb-2 flex items-center gap-1.5 text-label font-semibold text-muted-foreground"
    >
      {children}
    </h3>
  );
}

function CountBadge({ n }: { n: number }) {
  return (
    <span className="ml-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-sm bg-muted px-1 font-mono atr-micro font-semibold text-foreground">
      {n}
    </span>
  );
}
