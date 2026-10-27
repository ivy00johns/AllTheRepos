import type { LanguageBytes } from "@shared/types";

import { cn } from "@renderer/lib/cn";

import { colorForLanguage } from "./language-colors";

interface LanguageBarProps {
  languages: LanguageBytes[];
  className?: string;
}

/**
 * Stacked horizontal bar of language bytes, proportional segments.
 * 3px high, rounded. Fallback color is a muted gray for unknown languages.
 *
 * Ported verbatim from `components/catalog/language-bar.tsx`.
 */
export function LanguageBar({ languages, className }: LanguageBarProps) {
  const total = languages.reduce((sum, l) => sum + l.bytes, 0);
  if (total === 0) {
    return (
      <div
        className={cn("h-[3px] w-full rounded-full bg-muted", className)}
        aria-hidden
      />
    );
  }
  return (      <div
        className={cn(
          /*
           * The handoff's composition bar: 4px tall, square segments with a
           * 2px gap, so the proportions read as a bar chart rather than as a
           * single blended rule.
           */
          "flex h-1 w-full gap-[2px] overflow-hidden",
          className,
        )}
      role="img"
      aria-label={`Language composition: ${languages
        .map((l) => `${l.name} ${Math.round((l.bytes / total) * 100)}%`)
        .join(", ")}`}
    >
      {languages.map((l) => {
        const pct = (l.bytes / total) * 100;
        if (pct < 0.5) return null;
        return (
          <span
            key={l.name}
            style={{
              width: `${pct}%`,
              backgroundColor: l.color || colorForLanguage(l.name),
            }}
            className="block h-full"
          />
        );
      })}
    </div>
  );
}
