/**
 * ClaudeUsageHeatmap — the handoff's activity grid.
 *
 * A full-width HTML grid, not an SVG: 7 rows of 14px cells, one column per
 * week behind a 28px day-label gutter, 3px gaps, 2px radius. The SVG version
 * measured 12px cells and stopped wherever its intrinsic width ended, so on a
 * 1440 window it sat in a card as a small block in the corner while the
 * handoff's grid is the section's whole measure.
 *
 * The ramp is the activity ramp from the brief (`#1c2634` → `#2dd4bf`), which
 * is deliberately not the accent: the accent is the app mark and the live dot,
 * while activity is its own scale. The first level is the raised surface, so an
 * empty day reads as a slot rather than a hole.
 *
 * The window ends on this week's Sunday so the Mon/Wed/Fri labels line up;
 * days that have not happened yet are drawn empty rather than omitted, which
 * keeps the grid rectangular.
 */

import * as React from "react";

import type { ClaudeGlobalUsageResult } from "@shared/types";

interface ClaudeUsageHeatmapProps {
  byDay: ClaudeGlobalUsageResult["byDay"];
  /** Number of trailing weeks to render. Default 12. */
  weeks?: number;
}

const ROWS = 7;

/** The brief's activity ramp, darkest to brightest. Not the accent ramp. */
const HEAT = ["#1c2634", "#334155", "#3b82f6", "#38bdf8", "#2dd4bf"];

const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

export function ClaudeUsageHeatmap({
  byDay,
  weeks = 12,
}: ClaudeUsageHeatmapProps) {
  const { cells } = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const day of byDay) map.set(day.date, day.totalTokens);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // 0 = Monday. The label gutter names Mon/Wed/Fri, so the window has to
    // start on a Monday and end on the Sunday of the current week.
    const mondayIndex = (today.getDay() + 6) % 7;
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - mondayIndex));
    const start = new Date(end);
    start.setDate(start.getDate() - (weeks * 7 - 1));

    const total = weeks * ROWS;
    const days: Array<{ date: Date; tokenCount: number; bucket: number }> = [];
    let max = 0;
    for (let i = 0; i < total; i += 1) {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      const tokenCount = date > today ? 0 : (map.get(formatYmd(date)) ?? 0);
      if (tokenCount > max) max = tokenCount;
      days.push({ date, tokenCount, bucket: 0 });
    }
    for (const day of days) {
      day.bucket = day.date > today ? 0 : bucketize(day.tokenCount, max);
    }
    return { cells: days };
  }, [byDay, weeks]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="atr-eyebrow">Activity · last {weeks} weeks</span>
        <span className="flex items-center gap-1.5 atr-meta">
          less
          {HEAT.map((color) => (
            <span
              key={color}
              aria-hidden
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ backgroundColor: color }}
            />
          ))}
          more
        </span>
      </div>

      <div
        role="img"
        aria-label={`Daily Claude usage over the past ${weeks} weeks`}
        className="grid w-full"
        style={{
          gridTemplateColumns: `28px repeat(${weeks}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${ROWS}, 14px)`,
          gridAutoFlow: "column",
          gap: "3px",
        }}
      >
        {DAY_LABELS.map((label, index) => (
          <span
            key={`day-${index}`}
            aria-hidden
            className="atr-micro leading-[14px]"
          >
            {label}
          </span>
        ))}
        {cells.map((cell) => (
          <span
            key={formatYmd(cell.date)}
            className="rounded-[2px]"
            style={{ backgroundColor: HEAT[cell.bucket] }}
            title={`${formatYmd(cell.date)} — ${cell.tokenCount.toLocaleString()} tokens`}
          />
        ))}
      </div>
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
