"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

interface KeyboardShortcutsProps {
  slugs: string[];
  selectedSlug: string | null;
  onSelectSlug: (slug: string | null) => void;
  onOpenSelected?: () => void;
  onCloseDetail?: () => void;
}

/**
 * Client-side global shortcuts for the catalog page.
 * - `j` / `k` — move selection within current grid
 * - `enter` — "open" the selected repo (delegated via onOpenSelected)
 * - `esc` — close the detail panel
 * - `g s` — go to /settings (chord; second key within 800ms)
 * `/` is handled inside `SearchBar` so it can focus its own input.
 */
export function KeyboardShortcuts({
  slugs,
  selectedSlug,
  onSelectSlug,
  onOpenSelected,
  onCloseDetail,
}: KeyboardShortcutsProps) {
  const router = useRouter();
  const chord = React.useRef<{ key: string; ts: number } | null>(null);

  React.useEffect(() => {
    function isEditable(el: EventTarget | null) {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    }

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target)) {
        // allow Escape to bubble to SearchBar (it has its own handler)
        return;
      }

      // Chord: g s → /settings
      if (chord.current && Date.now() - chord.current.ts < 800) {
        if (chord.current.key === "g" && e.key === "s") {
          e.preventDefault();
          chord.current = null;
          router.push("/settings");
          return;
        }
      }
      if (e.key === "g") {
        chord.current = { key: "g", ts: Date.now() };
        return;
      }
      chord.current = null;

      if (e.key === "j" || e.key === "k") {
        if (slugs.length === 0) return;
        e.preventDefault();
        const curIdx = selectedSlug ? slugs.indexOf(selectedSlug) : -1;
        const delta = e.key === "j" ? 1 : -1;
        const nextIdx =
          curIdx === -1
            ? e.key === "j"
              ? 0
              : slugs.length - 1
            : (curIdx + delta + slugs.length) % slugs.length;
        const nextSlug = slugs[nextIdx];
        onSelectSlug(nextSlug);
        // Scroll into view
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(
            `[data-repo-slug="${nextSlug}"]`,
          );
          el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
        return;
      }

      if (e.key === "Enter" && selectedSlug) {
        e.preventDefault();
        onOpenSelected?.();
        return;
      }

      if (e.key === "Escape") {
        if (selectedSlug) {
          e.preventDefault();
          onCloseDetail?.();
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slugs, selectedSlug, onSelectSlug, onOpenSelected, onCloseDetail, router]);

  return null;
}
