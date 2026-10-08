/**
 * Claude route ("/claude") — global usage view.
 *
 * Stat cards (totals) → heatmap → per-project table with sparklines.
 *
 * Range selector: 7d / 30d / 90d / all. Default 30d. The range maps
 * to the `from` / `to` ISO strings on `claude:globalUsage`.
 *
 * Bridge-missing fallback: renders the same "preload bridge missing"
 * notice used by /processes.
 */

import * as React from "react";
import { Link, createRoute } from "@tanstack/react-router";
import { ArrowLeft, Brain, FolderGit2 } from "lucide-react";

import { ChevronDown, ChevronRight } from "lucide-react";

import { ClaudeUsageHeatmap } from "@renderer/components/claude/claude-usage-heatmap";
import { ClaudeUsageSparkline } from "@renderer/components/claude/claude-usage-sparkline";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@renderer/components/ui/card";
import {
  useClaudeGlobalUsage,
  useClaudeProjects,
  useClaudeRepoState,
  useClaudeTranscript,
} from "@renderer/hooks/use-claude";
import { getAtr } from "@renderer/lib/atr";
import { cn } from "@renderer/lib/cn";
import type {
  ClaudeGlobalUsageInput,
  ClaudeGlobalUsageResult,
  ClaudeProject,
  ClaudeSession,
  TranscriptEvent,
} from "@shared/types";

import { Route as RootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/claude",
  component: ClaudePage,
});

type RangeKey = "7d" | "30d" | "90d" | "all";

const RANGE_OPTIONS: { key: RangeKey; label: string; days: number | null }[] = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: null },
];

function ClaudePage() {
  const bridgeAvailable = typeof window !== "undefined" && Boolean(getAtr());
  const [range, setRange] = React.useState<RangeKey>("30d");

  /**
   * The range selector is a real radio group, not a row of toggles with radio
   * roles pasted on. The roles were already right — a range is one of N with a
   * persistent choice — but the pattern behind them was missing: every option
   * was a tab stop and the arrow keys did nothing. Native radios answer arrows,
   * and the choice follows the focus, so the JSX below gives the group one tab
   * stop (the checked option) and lets the arrows both move and select, which
   * is also what the panel underneath reads.
   */
  const rangeButtonsRef = React.useRef<Array<HTMLButtonElement | null>>([]);

  /** Focus and select the option at `next`, wrapping at both ends. */
  const moveRange = React.useCallback((next: number) => {
    const index = (next + RANGE_OPTIONS.length) % RANGE_OPTIONS.length;
    const option = RANGE_OPTIONS[index];
    if (!option) return;
    setRange(option.key);
    rangeButtonsRef.current[index]?.focus();
  }, []);

  /**
   * Arrows move and select; Home/End jump. Enter and Space are left to the
   * `<button>`, so there is no hand-rolled activation to drift from it.
   */
  const handleRangeKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          event.preventDefault();
          moveRange(index + 1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          event.preventDefault();
          moveRange(index - 1);
          break;
        case "Home":
          event.preventDefault();
          moveRange(0);
          break;
        case "End":
          event.preventDefault();
          moveRange(RANGE_OPTIONS.length - 1);
          break;
        default:
          break;
      }
    },
    [moveRange],
  );

  const filter = React.useMemo<ClaudeGlobalUsageInput>(() => {
    const opt = RANGE_OPTIONS.find((o) => o.key === range);
    if (!opt || opt.days === null) return {};
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - opt.days);
    return {
      from: formatYmd(from),
      to: formatYmd(to),
    };
  }, [range]);

  const usageQuery = useClaudeGlobalUsage(filter);
  const projectsQuery = useClaudeProjects();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-accent" aria-hidden />
          <div>
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              Claude Usage
            </h1>
            <p className="text-sm text-muted-foreground">
              Aggregate Claude Code activity across every project on this
              machine.
            </p>
          </div>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </Link>
        </Button>
      </div>

      {!bridgeAvailable ? (
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-6">
          <p className="font-mono text-sm text-foreground">
            Claude usage unavailable — preload bridge missing.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Run via <code className="font-mono">pnpm electron:dev</code> so the
            Electron preload script loads.
          </p>
        </div>
      ) : (
        <>
          {/* Range selector */}
          <div
            role="radiogroup"
            aria-label="Date range"
            className="flex items-center gap-1 rounded-md border border-border bg-card p-1 self-start"
          >
            {RANGE_OPTIONS.map((opt, index) => {
              const active = range === opt.key;
              return (
                <button
                  key={opt.key}
                  ref={(element) => {
                    rangeButtonsRef.current[index] = element;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  // One tab stop for the group: the checked option carries it,
                  // the arrows move it. Before this, all four were tab stops
                  // and the keys a radio group answers did nothing (ATR-065).
                  tabIndex={active ? 0 : -1}
                  onClick={() => setRange(opt.key)}
                  onKeyDown={(event) => handleRangeKeyDown(event, index)}
                  className={cn(
                    "rounded-sm px-3 py-1 font-mono text-[11px] uppercase tracking-widest transition-colors",
                    active
                      ? "bg-accent/15 text-accent"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Stat cards */}
          <StatCards
            usage={usageQuery.data}
            projects={projectsQuery.data?.projects ?? []}
            isLoading={usageQuery.isLoading || projectsQuery.isLoading}
          />

          {/* Heatmap */}
          <section className="space-y-2">
            {usageQuery.data ? (
              <div className="rounded-lg border border-border bg-card p-4">
                <ClaudeUsageHeatmap
                  byDay={usageQuery.data.byDay}
                  weeks={range === "7d" ? 4 : range === "90d" ? 13 : 12}
                />
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center font-mono text-sm text-muted-foreground">
                {usageQuery.isLoading ? "Loading usage…" : "No usage data."}
              </div>
            )}
          </section>

          {/* Per-project table */}
          <section aria-labelledby="claude-projects-heading">
            <h2
              id="claude-projects-heading"
              className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              <FolderGit2 className="h-3.5 w-3.5" aria-hidden />
              Projects
            </h2>
            <ProjectsTable
              usage={usageQuery.data}
              projects={projectsQuery.data?.projects ?? []}
            />
          </section>
        </>
      )}
    </div>
  );
}

interface StatCardsProps {
  usage: ClaudeGlobalUsageResult | undefined;
  projects: ClaudeProject[];
  isLoading: boolean;
}

function StatCards({ usage, projects, isLoading }: StatCardsProps) {
  const totalTokens = usage?.totalTokens ?? 0;
  const totalSessions = projects.reduce((acc, p) => acc + p.sessionCount, 0);
  const activeProjects = projects.filter((p) => p.totalTokens > 0).length;

  // Sum the last 7 days from byDay for "this week's tokens".
  const thisWeek = React.useMemo(() => {
    if (!usage) return 0;
    const tail = usage.byDay.slice(-7);
    return tail.reduce((acc, d) => acc + d.totalTokens, 0);
  }, [usage]);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard
        label="Total tokens"
        value={formatTokens(totalTokens)}
        loading={isLoading}
      />
      <StatCard
        label="Sessions"
        value={totalSessions.toLocaleString()}
        loading={isLoading}
      />
      <StatCard
        label="Active projects"
        value={activeProjects.toLocaleString()}
        loading={isLoading}
      />
      <StatCard
        label="This week"
        value={formatTokens(thisWeek)}
        loading={isLoading}
      />
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  loading?: boolean;
}

function StatCard({ label, value, loading }: StatCardProps) {
  return (
    <Card className="p-4">
      <CardDescription className="text-[10px] uppercase tracking-widest">
        {label}
      </CardDescription>
      <CardContent className="p-0 pt-1">
        <CardTitle className="text-2xl">{loading ? "—" : value}</CardTitle>
      </CardContent>
    </Card>
  );
}

interface ProjectsTableProps {
  usage: ClaudeGlobalUsageResult | undefined;
  projects: ClaudeProject[];
}

function ProjectsTable({ usage, projects }: ProjectsTableProps) {
  // ATR-020 — render each project's OWN weekly token series. The
  // `globalUsage` payload now carries a per-project `byWeek` array
  // (bucketed with the same ISO-Monday logic as the global series),
  // so we no longer fake the trend by scaling the global series by a
  // project's token share. A project with no per-week data renders a
  // flat/empty sparkline (the sparkline component draws a dashed
  // baseline for an empty values array — no fabrication).
  const weeklyByHash = React.useMemo(() => {
    const map = new Map<string, number[]>();
    if (!usage) return map;
    for (const entry of usage.byProject) {
      if (entry.byWeek) {
        map.set(
          entry.hash,
          entry.byWeek.map((w) => w.totalTokens),
        );
      }
    }
    return map;
  }, [usage]);

  // Track which project row is expanded to show its session list.
  const [expandedHash, setExpandedHash] = React.useState<string | null>(null);

  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center font-mono text-sm text-muted-foreground">
        No Claude projects detected.
      </div>
    );
  }

  // Sort by totalTokens desc; tie-breaker on lastActivityAt.
  const sorted = [...projects].sort((a, b) => {
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
    const av = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
    const bv = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
    return bv - av;
  });

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="border-b border-border bg-muted/40 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th scope="col" className="w-6 px-2 py-2" aria-label="Expand" />
            <th scope="col" className="px-3 py-2 font-medium">
              Project
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Sessions
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Last activity
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Tokens
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Trend
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            // Real per-project weekly series (empty array ⇒ flat sparkline).
            const series = weeklyByHash.get(p.hash) ?? [];
            const expanded = expandedHash === p.hash;
            const canExpand = Boolean(p.repoSlug) && p.sessionCount > 0;
            return (
              <React.Fragment key={p.hash}>
                <tr
                  className={cn(
                    "border-b border-border hover:bg-muted/20",
                    expanded && "bg-muted/20",
                  )}
                >
                  <td className="px-2 py-2 align-middle">
                    {canExpand ? (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={
                          expanded
                            ? `Hide sessions for ${p.repoSlug}`
                            : `Show sessions for ${p.repoSlug}`
                        }
                        onClick={() =>
                          setExpandedHash(expanded ? null : p.hash)
                        }
                        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      >
                        {expanded ? (
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                        )}
                      </button>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {p.repoSlug ? (
                      <Link
                        to="/repos/$slug"
                        params={{ slug: p.repoSlug }}
                        className="font-mono text-foreground underline-offset-4 hover:underline"
                      >
                        {p.repoSlug}
                      </Link>
                    ) : (
                      <span
                        className="block max-w-[18rem] truncate font-mono text-muted-foreground"
                        title={p.repoPath}
                      >
                        {p.repoPath}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {p.sessionCount.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    {p.lastActivityAt
                      ? new Date(p.lastActivityAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-accent">
                    {formatTokens(p.totalTokens)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="inline-flex items-center text-accent">
                      <ClaudeUsageSparkline values={series} />
                    </span>
                  </td>
                </tr>
                {expanded && p.repoSlug ? (
                  <tr className="border-b border-border bg-muted/10">
                    <td colSpan={6} className="px-3 py-3">
                      <ProjectSessions slug={p.repoSlug} />
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ATR-021 — per-project session list + transcript viewer
// ---------------------------------------------------------------------------

interface ProjectSessionsProps {
  slug: string;
}

/**
 * Lists a project's sessions (loaded from `claude:repoState`) and lets
 * the user open any session's transcript inline. Clicking a session row
 * toggles the transcript viewer below it.
 */
function ProjectSessions({ slug }: ProjectSessionsProps) {
  const repoStateQuery = useClaudeRepoState(slug);
  const [openSessionId, setOpenSessionId] = React.useState<string | null>(null);

  if (repoStateQuery.isLoading) {
    return (
      <p className="font-mono text-[11px] text-muted-foreground">
        Loading sessions…
      </p>
    );
  }
  if (repoStateQuery.isError) {
    return (
      <p className="font-mono text-[11px] text-destructive">
        Couldn’t load sessions for {slug}.
      </p>
    );
  }

  const sessions: ClaudeSession[] = repoStateQuery.data?.sessions ?? [];
  if (sessions.length === 0) {
    return (
      <p className="font-mono text-[11px] text-muted-foreground">
        No sessions recorded for this project.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Sessions
      </p>
      {sessions.map((session) => {
        const open = openSessionId === session.id;
        return (
          <div key={session.id} className="rounded border border-border/60">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenSessionId(open ? null : session.id)}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-2 py-1.5 text-left font-mono text-[11px] transition-colors",
                open ? "bg-muted/40" : "hover:bg-muted/30",
              )}
            >
              <span className="flex items-center gap-1.5">
                {open ? (
                  <ChevronDown
                    className="h-3 w-3 text-muted-foreground"
                    aria-hidden
                  />
                ) : (
                  <ChevronRight
                    className="h-3 w-3 text-muted-foreground"
                    aria-hidden
                  />
                )}
                <span className="text-foreground">
                  {session.id.slice(0, 8)}
                </span>
              </span>
              <span className="flex items-center gap-3 text-muted-foreground">
                <span>{session.messageCount.toLocaleString()} msgs</span>
                <span className="text-accent">
                  {formatTokens(session.tokenUsage.totalTokens)}
                </span>
                <span>
                  {session.lastActivityAt
                    ? new Date(session.lastActivityAt).toLocaleString()
                    : "—"}
                </span>
              </span>
            </button>
            {open ? <TranscriptViewer sessionId={session.id} /> : null}
          </div>
        );
      })}
    </div>
  );
}

interface TranscriptViewerProps {
  sessionId: string;
}

/**
 * Renders a session transcript via the lazy infinite query, with a
 * "Load more" affordance that drives `fetchNextPage`.
 */
function TranscriptViewer({ sessionId }: TranscriptViewerProps) {
  const transcript = useClaudeTranscript(sessionId);

  const events = React.useMemo<TranscriptEvent[]>(() => {
    if (!transcript.data) return [];
    return transcript.data.pages.flatMap((page) => page.events);
  }, [transcript.data]);

  if (transcript.isLoading) {
    return (
      <div className="border-t border-border/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
        Loading transcript…
      </div>
    );
  }
  if (transcript.isError) {
    return (
      <div className="border-t border-border/60 px-3 py-2 font-mono text-[11px] text-destructive">
        Couldn’t load this transcript.
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="border-t border-border/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
        This session has no transcript events.
      </div>
    );
  }

  return (
    <div className="border-t border-border/60 bg-background/40 px-3 py-2">
      <ol className="flex max-h-80 flex-col gap-1 overflow-y-auto">
        {events.map((event, i) => (
          <TranscriptEventRow
            key={(event.uuid as string | undefined) ?? `${i}`}
            event={event}
          />
        ))}
      </ol>
      <div className="mt-2 flex items-center justify-between">
        <span className="font-mono text-[10px] text-muted-foreground">
          {events.length.toLocaleString()} event
          {events.length === 1 ? "" : "s"} loaded
        </span>
        {transcript.hasNextPage ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={transcript.isFetchingNextPage}
            onClick={() => void transcript.fetchNextPage()}
          >
            {transcript.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        ) : (
          <span className="font-mono text-[10px] text-muted-foreground">
            End of transcript
          </span>
        )}
      </div>
    </div>
  );
}

interface TranscriptEventRowProps {
  event: TranscriptEvent;
}

/**
 * One transcript event. The wire shape is loose (Zod passthrough), so we
 * surface the stable fields (`type`, `timestamp`) plus a best-effort text
 * preview pulled from common Claude Code event shapes.
 */
function TranscriptEventRow({ event }: TranscriptEventRowProps) {
  const preview = extractEventText(event);
  const timestamp =
    typeof event.timestamp === "string" ? event.timestamp : null;
  return (
    <li className="rounded border border-border/40 bg-card/60 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <span className="text-accent">{event.type || "event"}</span>
        {timestamp ? (
          <span>{new Date(timestamp).toLocaleTimeString()}</span>
        ) : null}
      </div>
      {preview ? (
        <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-foreground">
          {preview}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Best-effort text extraction from a transcript event. Claude Code's
 * JSONL shape isn't a stable public schema, so this walks the common
 * `message.content` shapes and falls back to null when nothing readable
 * is present (the row then shows just the type/timestamp header).
 */
function extractEventText(event: TranscriptEvent): string | null {
  const message = (event as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return truncatePreview(content);
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === "object") {
        const text = (block as { text?: unknown }).text;
        if (typeof text === "string" && text.length > 0) parts.push(text);
      } else if (typeof block === "string") {
        parts.push(block);
      }
    }
    if (parts.length > 0) return truncatePreview(parts.join("\n"));
  }
  return null;
}

function truncatePreview(text: string): string {
  const trimmed = text.trim();
  const MAX = 800;
  return trimmed.length > MAX ? `${trimmed.slice(0, MAX)}…` : trimmed;
}

function formatYmd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}
