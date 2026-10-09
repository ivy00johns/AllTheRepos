/**
 * ClaudeUsageHeatmap — GitHub-style contribution grid.
 *
 * Renders the most recent N weeks (default 12) of daily token usage
 * as a 7-row × W-column SVG grid. Cells are 12×12 with 2px gaps.
 * Color intensity is bucketed into 5 levels (0..4) mapped onto the
 * `--color-muted` → `--color-accent` ramp via per-bucket Tailwind
 * utility classes.
 *
 * Pure SVG — no chart library dependency.
 */

import * as React from "react";

import type { ClaudeGlobalUsageResult } from "@shared/types";

interface ClaudeUsageHeatmapProps {
  byDay: ClaudeGlobalUsageResult["byDay"];
  /** Number of trailing weeks to render. Default 12. */
  weeks?: number;
}

const CELL = 12;
const GAP = 2;
const ROWS = 7;

const BUCKET_CLASSES = [
  "fill-muted",
  "fill-accent/20",
  "fill-accent/40",
  "fill-accent/65",
  "fill-accent",
];

export function ClaudeUsageHeatmap({
  byDay,
  weeks = 12,
}: ClaudeUsageHeatmapProps) {
  const data = React.useMemo(() => {
    // Index the byDay payload by YYYY-MM-DD for O(1) lookup.
    const map = new Map<string, number>();
    for (const d of byDay) map.set(d.date, d.totalTokens);

    // Build a contiguous trailing window of (weeks * 7) days
    // ending today.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const totalDays = weeks * 7;
    const start = new Date(today);
    start.setDate(start.getDate() - (totalDays - 1));

    const cells: { date: Date; tokens: number; bucket: number }[] = [];
    let max = 0;
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const key = formatYmd(d);
      const tokens = map.get(key) ?? 0;
      if (tokens > max) max = tokens;
      cells.push({ date: d, tokens, bucket: 0 });
    }
    // Assign buckets after we know the max.
    for (const c of cells) {
      c.bucket = bucketize(c.tokens, max);
    }
    return { cells, totalDays, max };
  }, [byDay, weeks]);

  const width = weeks * (CELL + GAP) - GAP;
  const height = ROWS * (CELL + GAP) - GAP;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between atr-label font-mono uppercase tracking-widest text-muted-foreground">
        <span>{weeks}-week activity</span>
        <span className="flex items-center gap-1.5">
          less
          {BUCKET_CLASSES.map((cls, i) => (
            <svg
              key={i}
              width={CELL}
              height={CELL}
              className="inline-block"
              aria-hidden
            >
              <rect width={CELL} height={CELL} rx={2} className={cls} />
            </svg>
          ))}
          more
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`Heatmap of Claude usage over the past ${weeks} weeks`}
      >
        {data.cells.map((c, i) => {
          const col = Math.floor(i / ROWS);
          const row = i % ROWS;
          const x = col * (CELL + GAP);
          const y = row * (CELL + GAP);
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={CELL}
              height={CELL}
              rx={2}
              className={BUCKET_CLASSES[c.bucket]}
            >
              <title>
                {formatYmd(c.date)} — {c.tokens.toLocaleString()} tokens
              </title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

function bucketize(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function formatYmd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
