import * as React from "react";
import { X } from "lucide-react";

import type { Group } from "@shared/types";

import { cn } from "@renderer/lib/cn";

import { colorForLanguage } from "./language-colors";

export interface ActiveFilters {
  language: string | null;
  tags: string[];
  groupId: number | null;
  dirtyOnly: boolean;
}

interface FilterChipsProps {
  filters: ActiveFilters;
  groups: Group[];
  onRemove: (patch: Partial<ActiveFilters>) => void;
  className?: string;
}

interface Chip {
  key: string;
  label: React.ReactNode;
  onRemove: () => void;
}

export function FilterChips({
  filters,
  groups,
  onRemove,
  className,
}: FilterChipsProps) {
  const chips: Chip[] = [];

  if (filters.language) {
    chips.push({
      key: `lang:${filters.language}`,
      label: (
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: colorForLanguage(filters.language) }}
          />
          {filters.language}
        </span>
      ),
      onRemove: () => onRemove({ language: null }),
    });
  }

  for (const t of filters.tags) {
    chips.push({
      key: `tag:${t}`,
      label: <span className="font-mono">#{t}</span>,
      onRemove: () => onRemove({ tags: filters.tags.filter((x) => x !== t) }),
    });
  }

  if (filters.groupId !== null) {
    const g = groups.find((g) => g.id === filters.groupId);
    if (g) {
      chips.push({
        key: `group:${g.id}`,
        label: <span>Group: {g.name}</span>,
        onRemove: () => onRemove({ groupId: null }),
      });
    }
  }

  if (filters.dirtyOnly) {
    chips.push({
      key: "dirty",
      label: <span>Dirty only</span>,
      onRemove: () => onRemove({ dirtyOnly: false }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      role="list"
      aria-label="Active filters"
    >
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.onRemove}
          role="listitem"
          aria-label={`Remove filter ${c.key}`}
          className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground transition-colors hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {c.label}
          <X
            className="h-3 w-3 text-muted-foreground group-hover:text-destructive"
            aria-hidden
          />
        </button>
      ))}
    </div>
  );
}
