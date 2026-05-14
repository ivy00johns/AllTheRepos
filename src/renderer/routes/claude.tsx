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
} from "@renderer/hooks/use-claude";
import { getAtr } from "@renderer/lib/atr";
import { cn } from "@renderer/lib/cn";
import type {
  ClaudeGlobalUsageInput,
  ClaudeGlobalUsageResult,
  ClaudeProject,
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
            {RANGE_OPTIONS.map((opt) => {
              const active = range === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setRange(opt.key)}
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
  // Build a hash → byWeek totals map for sparklines. The
  // globalUsage payload aggregates across ALL projects, so we can't
  // get per-project weekly series for free — we render the global
  // weekly series scaled by each project's share of total tokens
  // as a coarse approximation. (Phase 4 would expose per-project
  // weekly buckets directly.)
  const weeklySeries = React.useMemo(() => {
    if (!usage) return [];
    return usage.byWeek.map((w) => w.totalTokens);
  }, [usage]);

  const totalAcrossAll = usage?.totalTokens ?? 0;

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
            const share =
              totalAcrossAll > 0 ? p.totalTokens / totalAcrossAll : 0;
            const scaled = weeklySeries.map((v) => Math.round(v * share));
            return (
              <tr
                key={p.hash}
                className="border-b border-border last:border-b-0 hover:bg-muted/20"
              >
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
                    <ClaudeUsageSparkline values={scaled} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
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
