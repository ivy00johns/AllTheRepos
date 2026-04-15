import type { LanguageBytes } from "@/lib/types";
import { cn } from "@/lib/utils";
import { colorForLanguage } from "./language-colors";

interface LanguageBarProps {
  languages: LanguageBytes[];
  className?: string;
}

/**
 * Stacked horizontal bar of language bytes, proportional segments.
 * 3px high, rounded. Fallback color is a muted gray for unknown languages.
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
  return (
    <div
      className={cn(
        "flex h-[3px] w-full overflow-hidden rounded-full bg-muted",
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
