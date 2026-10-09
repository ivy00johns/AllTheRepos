/**
 * ClaudeSessionsTable — list of Claude sessions for one repo.
 *
 * Columns: Started | Last activity | Messages | Total tokens | Resume.
 *
 * The "Resume" button calls `useLaunchClaude(slug, { resumeSessionId })`
 * — the launcher delegates to the user's terminal. We surface a
 * `LauncherResult.reason` inline if the launch fails.
 */

import * as React from "react";
import { RotateCcw } from "lucide-react";

import type { ClaudeSession } from "@shared/types";
import { Button } from "@renderer/components/ui/button";
import { useLaunchClaude } from "@renderer/hooks/use-claude";
import { relativeTime } from "@renderer/components/catalog/relative-time";

interface ClaudeSessionsTableProps {
  slug: string;
  sessions: ClaudeSession[];
}

export function ClaudeSessionsTable({
  slug,
  sessions,
}: ClaudeSessionsTableProps) {
  const launch = useLaunchClaude();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (sessions.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-card/50 p-3 text-xs italic text-muted-foreground">
        No sessions recorded for this repo yet.
      </p>
    );
  }

  // Sort by lastActivityAt desc — most recently used first.
  const rows = React.useMemo(
    () =>
      [...sessions].sort((a, b) => {
        const av = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
        const bv = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
        return bv - av;
      }),
    [sessions],
  );

  const handleResume = async (sessionId: string) => {
    setError(null);
    setPendingId(sessionId);
    const result = await launch(slug, { resumeSessionId: sessionId });
    setPendingId(null);
    if (!result.ok) {
      setError(result.reason ?? "Failed to resume session");
    }
  };

  return (
    <div className="space-y-2">
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5 font-mono atr-label text-destructive">
          {error}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="border-b border-border bg-muted/40 font-mono atr-label uppercase tracking-widest text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Started
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Last activity
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Messages
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Tokens
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr
                key={s.id}
                className="border-b border-border last:border-b-0 hover:bg-muted/20"
              >
                <td className="px-3 py-2 font-mono text-muted-foreground">
                  {relativeTime(s.startedAt)}
                </td>
                <td className="px-3 py-2 font-mono text-foreground">
                  {relativeTime(s.lastActivityAt)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {s.messageCount.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right font-mono text-accent">
                  {formatTokens(s.tokenUsage.totalTokens)}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2"
                    onClick={() => handleResume(s.id)}
                    disabled={pendingId === s.id}
                    title={`Resume session ${s.id}`}
                    aria-label={`Resume session ${s.id}`}
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden />
                    Resume
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Format a token count with a unit suffix. We deliberately avoid
 * `Intl.NumberFormat` with `compact` notation because some Node /
 * Electron versions render it inconsistently across locales.
 */
function formatTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}
