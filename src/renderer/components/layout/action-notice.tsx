/**
 * Action notice — a transient, dismissable one-liner.
 *
 * Exists because some actions are legitimately unreachable in the current
 * context: a native-menu `Open in Editor` with no repo selected used to
 * return silently, which reads as a broken menu. The action handler now
 * pushes a message here instead, so "nothing happened" becomes "here is
 * why nothing happened".
 *
 * Rendered once at the app root, under the scan status bar. Auto-dismisses
 * so it never stacks up; the user can also close it early.
 */

import * as React from "react";
import { X } from "lucide-react";

import { useUiStore } from "@renderer/stores/ui";

/** How long a notice stays on screen before it clears itself. */
const NOTICE_MS = 6000;

export function ActionNotice() {
  const notice = useUiStore((s) => s.notice);
  const dismiss = useUiStore((s) => s.dismissNotice);

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(dismiss, NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice, dismiss]);

  if (!notice) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-accent/10 px-3 text-xs"
    >
      <span className="truncate font-mono text-accent">{notice}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notice"
        className="ml-auto flex cursor-pointer items-center rounded px-1 py-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}
