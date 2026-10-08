/**
 * LauncherButtons — icon row rendered on each repo card.
 *
 * Five icons:
 *   - ExternalLink → open in editor (uses Settings.defaultEditor)
 *   - Terminal     → open in terminal (uses Settings.defaultTerminal)
 *   - FolderOpen   → reveal in Finder
 *   - LinkExternal → open `git remote origin` in browser
 *   - Copy         → copy absolute repo path to clipboard
 *
 * Each button is a small ghost icon button (32×32 ish) wired through
 * `useLauncher()`. When a result returns `{ ok: false, reason }` we
 * surface a brief inline pill below the row (auto-dismisses after
 * ~3s) — there's no toast lib in 3a.
 *
 * Click handlers stop propagation so the icon row doesn't bubble
 * into the parent repo-card's onClick (which would otherwise navigate
 * or open the editor).
 */

import * as React from "react";
import {
  Copy,
  ExternalLink,
  FolderOpen,
  Github,
  Terminal as TerminalIcon,
} from "lucide-react";

import type { LauncherResult } from "@shared/types";

import { Button } from "@renderer/components/ui/button";
import { useLauncher } from "@renderer/hooks/use-launcher";
import { cn } from "@renderer/lib/cn";

interface LauncherButtonsProps {
  slug: string;
  className?: string;
  /**
   * When false (the default), the inline error pill renders inside
   * a wrapping <div>. When true, the icon row renders as a bare
   * flex span — the caller is responsible for arranging the error
   * message externally. Used by tight layouts where the error
   * surface lives elsewhere.
   */
  inline?: boolean;
}

interface ErrorState {
  message: string;
  expiresAt: number;
}

export function LauncherButtons({
  slug,
  className,
  inline = false,
}: LauncherButtonsProps) {
  const launcher = useLauncher();
  const [error, setError] = React.useState<ErrorState | null>(null);

  // Auto-dismiss the error pill after 3s.
  React.useEffect(() => {
    if (!error) return;
    const remaining = Math.max(0, error.expiresAt - Date.now());
    const t = window.setTimeout(() => setError(null), remaining);
    return () => window.clearTimeout(t);
  }, [error]);

  const handle = React.useCallback(
    async (
      action: () => Promise<LauncherResult>,
      label: string,
      e?: React.MouseEvent,
    ) => {
      e?.stopPropagation();
      try {
        const result = await action();
        if (!result.ok) {
          setError({
            message: `${label}: ${result.reason ?? "failed"}`,
            expiresAt: Date.now() + 3_000,
          });
        }
      } catch (err) {
        setError({
          message: `${label}: ${err instanceof Error ? err.message : String(err)}`,
          expiresAt: Date.now() + 3_000,
        });
      }
    },
    [],
  );

  const iconCls = "h-3.5 w-3.5";
  const btnCls = "h-7 w-7 p-0 text-muted-foreground hover:text-foreground";

  const row = (
    <div
      className={cn("inline-flex items-center gap-0.5", className)}
      // Don't let the icon row's clicks bubble into the parent card.
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Button
        variant="ghost"
        size="sm"
        className={btnCls}
        aria-label="Open in editor"
        title="Open in editor"
        onClick={(e) =>
          handle(() => launcher.openInEditor(slug), "Open in editor", e)
        }
      >
        <ExternalLink className={iconCls} aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={btnCls}
        aria-label="Open in terminal"
        title="Open in terminal"
        onClick={(e) =>
          handle(() => launcher.openInTerminal(slug), "Open in terminal", e)
        }
      >
        <TerminalIcon className={iconCls} aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={btnCls}
        aria-label="Reveal in Finder"
        title="Reveal in Finder"
        onClick={(e) =>
          handle(() => launcher.openInFinder(slug), "Reveal in Finder", e)
        }
      >
        <FolderOpen className={iconCls} aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={btnCls}
        aria-label="Open remote (origin)"
        title="Open remote (origin)"
        onClick={(e) =>
          handle(() => launcher.openRemote(slug), "Open remote", e)
        }
      >
        <Github className={iconCls} aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={btnCls}
        aria-label="Copy path"
        title="Copy path"
        onClick={(e) => handle(() => launcher.copyPath(slug), "Copy path", e)}
      >
        <Copy className={iconCls} aria-hidden />
      </Button>
    </div>
  );

  if (inline) return row;

  return (
    <div className="flex flex-col gap-1">
      {row}
      {error ? (
        <p
          role="status"
          aria-live="polite"
          className="font-mono atr-label text-destructive"
        >
          {error.message}
        </p>
      ) : null}
    </div>
  );
}
