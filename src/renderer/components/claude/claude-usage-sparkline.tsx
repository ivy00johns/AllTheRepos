/**
 * ClaudeUsageSparkline — 80×20 SVG polyline sparkline.
 *
 * Renders a normalised line for a small time series (typically the
 * per-project weekly token totals from `globalUsage.byWeek`). The
 * stroke inherits `currentColor` so it picks up the surrounding
 * text color via Tailwind utility classes.
 */

import * as React from "react";

interface ClaudeUsageSparklineProps {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}

export function ClaudeUsageSparkline({
  values,
  width = 80,
  height = 20,
  className,
}: ClaudeUsageSparklineProps) {
  const points = React.useMemo(() => {
    if (values.length === 0) return "";
    const max = Math.max(...values, 1);
    const step = values.length === 1 ? 0 : width / (values.length - 1);
    return values
      .map((v, i) => {
        const x = i * step;
        // Invert Y because SVG (0,0) is top-left.
        const y = height - (v / max) * height;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [values, width, height]);

  if (values.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        className={className}
        aria-hidden
        focusable="false"
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeOpacity={0.25}
          strokeDasharray="2 2"
        />
      </svg>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="Token-usage sparkline"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}
