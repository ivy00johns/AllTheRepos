/**
 * Repo cover art.
 *
 * Renders a project's own image when one was found on disk, and
 * otherwise draws a deterministic generated cover (see `lib/cover.ts`).
 * Either way every repo gets a distinct visual anchor, which is what
 * makes a 100+ project catalog browsable by memory instead of by
 * reading every name.
 *
 * The generated art is inline SVG rather than CSS gradients so the
 * motifs can be genuinely different shapes — a ring stack and a wave
 * field are far easier to tell apart at 48px than two gradients are.
 *
 * `data-cover` marks the art box for `tests/e2e/catalog-visual.spec.ts`, which
 * masks it and asserts its size instead of comparing its pixels: the motif is
 * rotated and sliced into a fractional scale, so a fraction of a pixel rasterizes
 * differently between two runs of the same code — which makes it a bad pixel
 * baseline and a perfectly good box to measure.
 */

import * as React from "react";

import { cn } from "@renderer/lib/cn";
import { generatedCover, type CoverMotif } from "@renderer/lib/cover";

interface RepoCoverProps {
  slug: string;
  name: string;
  /** Resolved image source (data URL) when the project ships artwork. */
  imageSrc?: string | null;
  /** Rendered size. Motif detail scales with it. */
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Motif geometry. Each returns SVG children drawn in a 100×100 viewBox,
 * stroked/filled with `currentColor` so the parent controls the hue.
 */
function Motif({
  motif,
  density,
}: {
  motif: CoverMotif;
  density: number;
}): React.ReactElement {
  const step = Math.round(12 / density);
  switch (motif) {
    case "grid":
      return (
        <g strokeWidth={1.5} stroke="currentColor" fill="none">
          {Array.from({ length: Math.ceil(100 / step) }, (_, i) => (
            <React.Fragment key={i}>
              <line x1={i * step} y1={0} x2={i * step} y2={100} />
              <line x1={0} y1={i * step} x2={100} y2={i * step} />
            </React.Fragment>
          ))}
        </g>
      );
    case "rings":
      return (
        <g strokeWidth={3} stroke="currentColor" fill="none">
          {Array.from({ length: 6 }, (_, i) => (
            <circle key={i} cx={50} cy={50} r={8 + i * (9 * density)} />
          ))}
        </g>
      );
    case "waves":
      return (
        <g strokeWidth={2.5} stroke="currentColor" fill="none">
          {Array.from({ length: 7 }, (_, i) => (
            <path
              key={i}
              d={`M -10 ${12 + i * 14} q 15 ${-10 * density} 30 0 t 30 0 t 30 0 t 30 0`}
            />
          ))}
        </g>
      );
    case "diagonals":
      return (
        <g strokeWidth={4} stroke="currentColor" fill="none">
          {Array.from({ length: Math.ceil(200 / (step * 1.6)) }, (_, i) => (
            <line
              key={i}
              x1={-100 + i * step * 1.6}
              y1={-10}
              x2={i * step * 1.6}
              y2={110}
            />
          ))}
        </g>
      );
    case "dots":
      return (
        <g fill="currentColor">
          {Array.from({ length: Math.ceil(100 / step) }, (_, row) =>
            Array.from({ length: Math.ceil(100 / step) }, (_, col) => (
              <circle
                key={`${row}-${col}`}
                cx={col * step + (row % 2 ? step / 2 : 0)}
                cy={row * step}
                r={2.2 * density}
              />
            )),
          )}
        </g>
      );
    case "blocks":
      return (
        <g fill="currentColor">
          {Array.from({ length: 5 }, (_, row) =>
            Array.from({ length: 5 }, (_, col) =>
              (row * 7 + col * 3) % 3 === 0 ? (
                <rect
                  key={`${row}-${col}`}
                  x={col * 20 + 2}
                  y={row * 20 + 2}
                  width={16}
                  height={16}
                  rx={2}
                />
              ) : null,
            ),
          )}
        </g>
      );
    case "arcs":
      return (
        <g strokeWidth={5} stroke="currentColor" fill="none">
          {Array.from({ length: 5 }, (_, i) => (
            <path
              key={i}
              d={`M 0 ${100 - i * 18} a ${100 - i * 18} ${100 - i * 18} 0 0 0 ${100 - i * 18} ${-(100 - i * 18)}`}
            />
          ))}
        </g>
      );
    case "triangles":
      return (
        <g fill="currentColor">
          {Array.from({ length: 4 }, (_, row) =>
            Array.from({ length: 4 }, (_, col) => (
              <polygon
                key={`${row}-${col}`}
                points={
                  (row + col) % 2 === 0
                    ? `${col * 25},${row * 25} ${col * 25 + 25},${row * 25} ${col * 25},${row * 25 + 25}`
                    : `${col * 25 + 25},${row * 25} ${col * 25 + 25},${row * 25 + 25} ${col * 25},${row * 25 + 25}`
                }
              />
            )),
          )}
        </g>
      );
  }
}

const SIZE_CLASSES = {
  sm: "h-8 w-8 rounded",
  md: "h-11 w-11 rounded-md",
  lg: "h-full w-full rounded-none",
} as const;

const LABEL_CLASSES = {
  sm: "atr-micro",
  md: "text-xs",
  lg: "text-2xl",
} as const;

export function RepoCover({
  slug,
  name,
  imageSrc,
  size = "md",
  className,
}: RepoCoverProps) {
  // A cover that fails to decode (moved file, unsupported format) must
  // fall back to generated art rather than leaving a broken-image box.
  const [imageFailed, setImageFailed] = React.useState(false);
  React.useEffect(() => setImageFailed(false), [imageSrc]);

  const cover = React.useMemo(() => generatedCover(slug, name), [slug, name]);
  const showImage = Boolean(imageSrc) && !imageFailed;

  if (showImage) {
    return (
      <img
        src={imageSrc as string}
        alt=""
        aria-hidden
        data-cover
        loading="lazy"
        decoding="async"
        onError={() => setImageFailed(true)}
        className={cn(
          SIZE_CLASSES[size],
          "shrink-0 bg-muted object-cover",
          className,
        )}
      />
    );
  }

  const gradientId = `cover-grad-${cover.seed.toString(36)}`;
  const clipId = `cover-clip-${cover.seed.toString(36)}`;

  return (
    <div
      aria-hidden
      data-cover
      className={cn(
        SIZE_CLASSES[size],
        "relative shrink-0 overflow-hidden",
        className,
      )}
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={`hsl(${cover.hue} 42% 26%)`} />
            <stop offset="100%" stopColor={`hsl(${cover.hueB} 38% 14%)`} />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x="0" y="0" width="100" height="100" />
          </clipPath>
        </defs>
        <rect width="100" height="100" fill={`url(#${gradientId})`} />
        <g
          clipPath={`url(#${clipId})`}
          transform={`rotate(${cover.rotation} 50 50)`}
          color={`hsl(${cover.hue} 70% 62%)`}
          opacity={0.28}
        >
          <Motif motif={cover.motif} density={cover.density} />
        </g>
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center font-mono font-semibold tracking-tight",
          LABEL_CLASSES[size],
        )}
        style={{
          color: `hsl(${cover.hue} 90% 88%)`,
          textShadow: "0 1px 3px rgb(0 0 0 / 0.55)",
        }}
      >
        {cover.initials}
      </span>
    </div>
  );
}
