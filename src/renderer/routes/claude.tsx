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
import { ChevronDown, ChevronRight } from "lucide-react";

import { relativeTime } from "@renderer/components/catalog/relative-time";
import { ClaudeUsageHeatmap } from "@renderer/components/claude/claude-usage-heatmap";
import { PageHeader } from "@renderer/components/layout/page-header";
import { Button } from "@renderer/components/ui/button";
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
  // Roving tabindex for the range radios. The group is one tab stop and the
  // arrows move inside it, so we need a handle on each button to hand focus
  // over when a key selects a different one.
  const rangeButtons = React.useRef<Array<HTMLButtonElement | null>>([]);

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

  /**
   * Radios are a roving-tabindex group: exactly one sits in the tab order,
   * ArrowLeft/Right (and Up/Down) move between them, Home/End jump to the
   * ends, and moving focus selects. The control declared `role="radio"` and
   * `aria-checked` while implementing none of it, so all four were tab stops
   * and the keys a radio is expected to answer did nothing (ATR-065).
   */
  const selectRange = (index: number) => {
    const next = RANGE_OPTIONS[index];
    if (!next) return;
    setRange(next.key);
    rangeButtons.current[index]?.focus();
  };

  const handleRangeKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = RANGE_OPTIONS.length - 1;
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    let target: number | null = null;
    if (forward) target = (index + 1) % RANGE_OPTIONS.length;
    else if (backward) target = (index + last) % RANGE_OPTIONS.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = last;
    if (target === null) return;
    event.preventDefault();
    selectRange(target);
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Claude"
        actions={
          <div
            role="radiogroup"
            aria-label="Date range"
            className="flex items-center gap-0.5 rounded border border-border p-0.5"
          >
            {RANGE_OPTIONS.map((opt, index) => {
              const active = range === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  ref={(element) => {
                    rangeButtons.current[index] = element;
                  }}
                  onKeyDown={(event) => handleRangeKeyDown(event, index)}
                  onClick={() => setRange(opt.key)}
                  className={cn(
                    "h-[26px] rounded-[3px] px-2.5 font-mono text-label font-medium transition-colors duration-150",
                    active
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        }
      />

      {!bridgeAvailable ? (
        <p className="border-b border-border px-6 py-6 text-body text-muted-foreground">
          Claude usage unavailable — the preload bridge is missing. Run via{" "}
          <code className="font-mono text-label">pnpm electron:dev</code>.
        </p>
      ) : (
        <>
          <StatRow
            usage={usageQuery.data}
            projects={projectsQuery.data?.projects ?? []}
            isLoading={usageQuery.isLoading || projectsQuery.isLoading}
          />

          <section className="border-b border-border px-6 py-6">
            {usageQuery.data ? (
              <ClaudeUsageHeatmap
                byDay={usageQuery.data.byDay}
                weeks={range === "7d" ? 4 : range === "90d" ? 13 : 12}
              />
            ) : (
              <p className="text-body text-muted-foreground">
                {usageQuery.isLoading ? "Loading usage…" : "No usage data."}
              </p>
            )}
          </section>

          <section
            aria-labelledby="claude-projects-heading"
            className="flex flex-col pb-12"
          >
            <h2
              id="claude-projects-heading"
              className="px-6 pb-2 pt-6 text-label font-semibold text-muted-foreground"
            >
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

interface StatRowProps {
  usage: ClaudeGlobalUsageResult | undefined;
  projects: ClaudeProject[];
  isLoading: boolean;
}

/**
 * The handoff's stats: one full-bleed row of hairline-separated cells, not
 * four cards. A card around a single number doubles the chrome for no extra
 * information, and the four cards floated inside the page's padding while the
 * heatmap below ran edge to edge.
 */
function StatRow({ usage, projects, isLoading }: StatRowProps) {
  const totalTokens = usage?.totalTokens ?? 0;
  const totalSessions = projects.reduce((acc, p) => acc + p.sessionCount, 0);
  const activeDays = usage
    ? usage.byDay.filter((day) => day.totalTokens > 0).length
    : 0;

  const stats = [
    { label: "Sessions", value: totalSessions.toLocaleString() },
    { label: "Tokens", value: formatTokens(totalTokens) },
    { label: "Projects", value: projects.length.toLocaleString() },
    { label: "Active days", value: activeDays.toLocaleString() },
  ];

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] border-b border-border">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex flex-col gap-2 border-r border-border px-6 py-5 last:border-r-0"
        >
          <span className="text-label font-medium text-muted-foreground">
            {stat.label}
          </span>
          <span className="font-mono text-name-lg tabular-nums text-foreground">
            {isLoading ? "—" : stat.value}
          </span>
        </div>
      ))}
    </div>
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
      <p className="px-6 pb-6 text-body text-muted-foreground">
        No Claude projects detected.
      </p>
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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="h-9 border-y border-border">
            <th scope="col" className="w-8 pl-6" aria-label="Expand" />
            <th
              scope="col"
              className="pr-4 text-label font-medium text-muted-foreground"
            >
              Repository
            </th>
            <th
              scope="col"
              className="w-24 whitespace-nowrap px-3 text-right text-label font-medium text-muted-foreground"
            >
              Sessions
            </th>
            <th
              scope="col"
              className="w-28 whitespace-nowrap px-3 text-right text-label font-medium text-muted-foreground"
            >
              Tokens
            </th>
            <th
              scope="col"
              className="w-[124px] whitespace-nowrap pl-4 pr-3 text-label font-medium text-muted-foreground"
            >
              Last active
            </th>
            <th
              scope="col"
              className="w-[120px] whitespace-nowrap pl-4 pr-6 text-label font-medium text-muted-foreground"
            >
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
                    "h-10 border-b border-border/60 transition-colors duration-150 hover:bg-surface",
                    expanded && "bg-surface",
                  )}
                >
                  <td className="py-1 pl-6 pr-2">
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
                        className="grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors duration-150 hover:bg-surface-raised hover:text-foreground"
                      >
                        {expanded ? (
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                        )}
                      </button>
                    ) : null}
                  </td>
                  <td className="max-w-0 truncate py-1 pr-4">
                    {p.repoSlug ? (
                      <Link
                        to="/repos/$slug"
                        params={{ slug: p.repoSlug }}
                        className="block truncate text-body font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {displayRepoName(p)}
                      </Link>
                    ) : (
                      <span
                        className="block truncate text-body font-medium text-foreground"
                        title={p.repoPath}
                      >
                        {displayRepoName(p)}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1 text-right font-mono atr-meta tabular-nums">
                    {p.sessionCount.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1 text-right font-mono atr-meta tabular-nums text-foreground">
                    {formatTokens(p.totalTokens)}
                  </td>
                  <td
                    className="whitespace-nowrap pl-4 pr-3 py-1 font-mono atr-meta"
                    title={
                      p.lastActivityAt
                        ? new Date(p.lastActivityAt).toLocaleString()
                        : undefined
                    }
                  >
                    {relativeTime(p.lastActivityAt)}
                  </td>
                  <td className="py-1 pl-4 pr-6">
                    <TrendBars values={series} />
                  </td>
                </tr>
                {expanded && p.repoSlug ? (
                  <tr className="border-b border-border/60">
                    <td colSpan={6} className="bg-surface px-6 py-4">
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

/**
 * Trend — the project's weekly tokens as 4px bars, 18px tall at most.
 *
 * Only drawn when at least four of the twelve buckets are non-zero: with one
 * busy week among eleven empty ones the bars imply a trend that isn't there,
 * and the handoff would rather leave the cell empty than fabricate one.
 */
function TrendBars({ values }: { values: number[] }) {
  const points = values.slice(-12);
  const nonZero = points.filter((value) => value > 0).length;
  if (nonZero < 4) return null;
  const max = Math.max(...points, 1);
  return (
    <span aria-hidden className="flex h-[18px] items-end gap-0.5">
      {points.map((value, index) => (
        <span
          key={index}
          className="w-1 bg-sky-400"
          style={{
            height: `${Math.max(2, Math.round((value / max) * 18))}px`,
          }}
        />
      ))}
    </span>
  );
}

/**
 * The folder's own name, never `repoSlug` — a slug ends in a path hash
 * (`lighthouse-ui-e2b08309`) and the hash is not something a person reads.
 */
function displayRepoName(project: ClaudeProject): string {
  const folder = project.repoPath.split(/[\\/]/).filter(Boolean).pop();
  if (folder) return folder;
  return (
    project.repoSlug?.replace(/-[0-9a-f]{8}$/i, "") ?? project.hash.slice(0, 8)
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
    return <p className="text-body text-muted-foreground">Loading sessions…</p>;
  }
  if (repoStateQuery.isError) {
    return (
      <p className="text-body text-destructive">
        Couldn’t load sessions for {slug}.
      </p>
    );
  }

  const sessions: ClaudeSession[] = repoStateQuery.data?.sessions ?? [];
  if (sessions.length === 0) {
    return (
      <p className="text-body text-muted-foreground">
        No sessions recorded for this project.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      <p className="pb-2 text-label font-semibold text-muted-foreground">
        Sessions
      </p>
      {sessions.map((session) => {
        const open = openSessionId === session.id;
        return (
          <div
            key={session.id}
            className="border-b border-border/60 last:border-b-0"
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenSessionId(open ? null : session.id)}
              className={cn(
                "flex w-full items-center justify-between gap-3 py-2 pr-2 text-left transition-colors duration-150",
                open ? "bg-surface-raised" : "hover:bg-surface-raised/60",
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
                <span className="font-mono atr-meta text-foreground">
                  {session.id.slice(0, 8)}
                </span>
              </span>
              <span className="flex items-center gap-3 font-mono atr-meta">
                <span>{session.messageCount.toLocaleString()} msgs</span>
                <span className="text-foreground">
                  {formatTokens(session.tokenUsage.totalTokens)}
                </span>
                <span>{relativeTime(session.lastActivityAt)}</span>
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
      <div className="border-t border-border/60 px-3 py-2 text-body text-muted-foreground">
        Loading transcript…
      </div>
    );
  }
  if (transcript.isError) {
    return (
      <div className="border-t border-border/60 px-3 py-2 text-body text-destructive">
        Couldn’t load this transcript.
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="border-t border-border/60 px-3 py-2 text-body text-muted-foreground">
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
        <span className="font-mono atr-micro text-muted-foreground">
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
          <span className="atr-meta">End of transcript</span>
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
    <li className="border-b border-border/40 py-1.5 last:border-b-0">
      <div className="flex items-center justify-between gap-2 font-mono atr-meta">
        <span className="text-foreground">{event.type || "event"}</span>
        {timestamp ? (
          <span>{new Date(timestamp).toLocaleTimeString()}</span>
        ) : null}
      </div>
      {preview ? (
        <p className="mt-1 whitespace-pre-wrap break-words text-body text-foreground">
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
