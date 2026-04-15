"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onDebouncedChange?: (value: string) => void;
  debounceMs?: number;
  loading?: boolean;
  className?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function SearchBar({
  value,
  onChange,
  onDebouncedChange,
  debounceMs = 250,
  loading,
  className,
  inputRef,
}: SearchBarProps) {
  const internalRef = React.useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? internalRef;

  // Global `/` focus shortcut — unless an editable element is focused
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        active?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      ref.current?.focus();
      ref.current?.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);

  // Debounce
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (!onDebouncedChange) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onDebouncedChange(value), debounceMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, debounceMs, onDebouncedChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (value) {
        onChange("");
      } else {
        ref.current?.blur();
      }
    }
  };

  return (
    <div className={cn("relative w-full", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search repos by name, description, tag, language..."
        aria-label="Search repos"
        className="h-11 w-full pl-9 pr-28 text-sm"
      />
      <div className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-[10px] text-muted-foreground">
        {loading ? (
          <span className="font-mono">searching…</span>
        ) : value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="pointer-events-auto flex items-center gap-1 rounded-sm px-1 font-mono hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3 w-3" aria-hidden />
            esc
          </button>
        ) : (
          <>
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">
              /
            </kbd>
            <span>focus</span>
          </>
        )}
      </div>
    </div>
  );
}
