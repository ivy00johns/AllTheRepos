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
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import {
  Bot,
  Edit,
  FileText,
  History,
  PlayCircle,
  Plug,
  Wand2,
} from "lucide-react";

import { Button } from "@renderer/components/ui/button";
import { Separator } from "@renderer/components/ui/separator";
import {
  useClaudeRepoState,
  useLaunchClaude,
  useOpenClaudeMd,
} from "@renderer/hooks/use-claude";
import { getAtr } from "@renderer/lib/atr";
import { README_SANITIZE_SCHEMA } from "@renderer/lib/markdown";

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
      <div className="rounded-lg border border-dashed border-border bg-card/50 p-6">
        <p className="font-mono text-sm text-foreground">
          Claude integration unavailable — preload bridge missing.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Run via <code className="font-mono">pnpm electron:dev</code> so the
          Electron preload script loads.
        </p>
      </div>
    );
  }

  if (stateQuery.isLoading) {
    return (
      <div
        aria-busy="true"
        className="rounded-lg border border-border bg-card p-6 text-center font-mono text-sm text-muted-foreground"
      >
        Loading Claude state…
      </div>
    );
  }

  if (stateQuery.error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <p className="font-medium text-destructive">
          Failed to load Claude state
        </p>
        <pre className="mt-2 overflow-x-auto font-mono text-xs text-muted-foreground">
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
          variant="outline"
          onClick={handleOpenClaudeMd}
          disabled={openingMd || !state.claudeMdPath}
          aria-label="Edit CLAUDE.md"
        >
          <Edit className="h-4 w-4" aria-hidden />
          {openingMd ? "Opening…" : "Edit CLAUDE.md"}
        </Button>
        <span className="ml-auto font-mono atr-label uppercase tracking-widest text-muted-foreground">
          {tokens} tokens · {state.sessions.length} session
          {state.sessions.length === 1 ? "" : "s"}
        </span>
      </div>

      {launchError ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5 font-mono atr-label text-destructive">
          {launchError}
        </p>
      ) : null}

      {/* CLAUDE.md preview */}
      <section aria-labelledby="claude-md-heading">
        <SectionHeading
          id="claude-md-heading"
          icon={<FileText className="h-3.5 w-3.5" aria-hidden />}
        >
          CLAUDE.md
        </SectionHeading>
        {state.claudeMdContent ? (
          <div className="prose prose-invert prose-sm max-w-none rounded-md border border-border bg-card p-4 font-sans prose-headings:font-mono prose-code:font-mono prose-code:text-accent prose-a:text-accent">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[
                rehypeRaw,
                [rehypeSanitize, README_SANITIZE_SCHEMA],
              ]}
            >
              {state.claudeMdContent}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-border bg-card/50 p-3 text-xs italic text-muted-foreground">
            No CLAUDE.md detected at the repo root.
          </p>
        )}
      </section>

      <Separator />

      {/* Skills */}
      <section aria-labelledby="claude-skills-heading">
        <SectionHeading
          id="claude-skills-heading"
          icon={<Wand2 className="h-3.5 w-3.5" aria-hidden />}
        >
          Skills <CountBadge n={state.skills.length} />
        </SectionHeading>
        {state.skills.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {state.skills.map((s) => (
              <ClaudeSkillCard key={s.path} skill={s} />
            ))}
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            No skills configured under{" "}
            <code className="font-mono">.claude/skills/</code>.
          </p>
        )}
      </section>

      <Separator />

      {/* Agents */}
      <section aria-labelledby="claude-agents-heading">
        <SectionHeading
          id="claude-agents-heading"
          icon={<Bot className="h-3.5 w-3.5" aria-hidden />}
        >
          Agents <CountBadge n={state.agents.length} />
        </SectionHeading>
        {state.agents.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {state.agents.map((a) => (
              <ClaudeAgentCard key={a.path} agent={a} />
            ))}
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            No agents configured under{" "}
            <code className="font-mono">.claude/agents/</code>.
          </p>
        )}
      </section>

      <Separator />

      {/* MCP servers */}
      <section aria-labelledby="claude-mcp-heading">
        <SectionHeading
          id="claude-mcp-heading"
          icon={<Plug className="h-3.5 w-3.5" aria-hidden />}
        >
          MCP servers <CountBadge n={state.mcpServers.length} />
        </SectionHeading>
        {state.mcpServers.length > 0 ? (
          <div className="space-y-1.5">
            {state.mcpServers.map((m) => (
              <ClaudeMcpRow key={`${m.configuredIn}-${m.name}`} server={m} />
            ))}
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            No MCP servers configured for this repo.
          </p>
        )}
      </section>

      <Separator />

      {/* Sessions */}
      <section aria-labelledby="claude-sessions-heading">
        <SectionHeading
          id="claude-sessions-heading"
          icon={<History className="h-3.5 w-3.5" aria-hidden />}
        >
          Sessions <CountBadge n={state.sessions.length} />
        </SectionHeading>
        <ClaudeSessionsTable slug={slug} sessions={state.sessions} />
      </section>
    </div>
  );
}

interface SectionHeadingProps {
  id: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function SectionHeading({ id, icon, children }: SectionHeadingProps) {
  return (
    <h3
      id={id}
      className="mb-2 flex items-center gap-1.5 atr-label font-semibold uppercase tracking-widest text-muted-foreground"
    >
      {icon}
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
