/**
 * useTrayOpenRepoBus — subscribes to `tray:on:open-repo` push events
 * and routes the main window to the repo detail page.
 *
 * Fired by main when the user clicks a recent-repo row in the tray
 * popover. Per `contracts/ipc.v1.md` §tray:on:open-repo the main
 * window is guaranteed to be visible by the time this event lands.
 *
 * Lives in the main App lifecycle (NOT in the tray-popover window —
 * the popover is the sender via main, not the receiver).
 */

import * as React from "react";

import { getAtr } from "@renderer/lib/atr";
import { router } from "@renderer/router";

export function useTrayOpenRepoBus(): void {
  // Sibling of RouterProvider — call the singleton's navigate directly
  // instead of `useNavigate()` (which crashes outside the router tree).
  const navigate = router.navigate.bind(router);
  const navRef = React.useRef(navigate);
  React.useEffect(() => {
    navRef.current = navigate;
  }, [navigate]);

  React.useEffect(() => {
    const atr = getAtr();
    if (!atr) return;

    // Bind the listener to whichever surface the preload exposed.
    // backend-system's Phase 2 preload extension uses
    // `app.onTrayOpenRepo` (alias); the canonical namespace is
    // `tray.onOpenRepo`. Try both.
    const handler = (payload: { slug?: string } | null | undefined): void => {
      if (!payload?.slug) return;
      void navRef.current({
        to: "/repos/$slug",
        params: { slug: payload.slug },
      });
    };

    let unsubscribe: (() => void) | undefined;
    if (atr.tray?.onOpenRepo) {
      unsubscribe = atr.tray.onOpenRepo(handler);
    } else if (atr.app?.onTrayOpenRepo) {
      unsubscribe = atr.app.onTrayOpenRepo(handler);
    } else if (atr.app?.onOpenRepo) {
      unsubscribe = atr.app.onOpenRepo(handler);
    } else {
      if (import.meta.env?.DEV) {
        console.warn(
          "[actions] tray.onOpenRepo subscription unavailable on preload bridge",
        );
      }
      return;
    }

    return () => {
      try {
        unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, []);
}
