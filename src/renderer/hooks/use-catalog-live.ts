/**
 * Live catalog updates.
 *
 * Subscribes to the main process's filesystem watcher and refreshes the
 * catalog when repos appear, move or disappear on disk, so the app stops
 * being a snapshot of whenever you last ran a scan.
 *
 * It also surfaces the LAST change as a short-lived notice, because a
 * list that silently rearranges itself is unsettling — if two repos just
 * appeared, the UI should say so.
 */

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { CatalogChangeEvent } from "@shared/types";

import { getAtr } from "@renderer/lib/atr";

/** How long a change notice stays on screen before fading out. */
const NOTICE_MS = 6000;

function describe(event: CatalogChangeEvent): string | null {
  const parts: string[] = [];
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;

  if (event.added.length > 0)
    parts.push(`${plural(event.added.length, "repo")} added`);
  if (event.updated.length > 0) {
    parts.push(`${plural(event.updated.length, "repo")} updated`);
  }
  if (event.vanished.length > 0) {
    parts.push(`${plural(event.vanished.length, "repo")} no longer on disk`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export interface CatalogLiveState {
  /** Human-readable summary of the most recent change, or `null`. */
  notice: string | null;
  dismiss: () => void;
}

export function useCatalogLive(): CatalogLiveState {
  const queryClient = useQueryClient();
  const [notice, setNotice] = React.useState<string | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const atr = getAtr();
    if (!atr) return;

    const unsubscribe = atr.catalog.onChanged((event) => {
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
      const summary = describe(event);
      if (!summary) return;
      setNotice(summary);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setNotice(null), NOTICE_MS);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [queryClient]);

  const dismiss = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setNotice(null);
  }, []);

  return { notice, dismiss };
}
