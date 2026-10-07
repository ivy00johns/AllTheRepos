/**
 * useMenuCommandBus — subscribes to `menu:on:command` push events
 * and dispatches the carried `commandId` through the renderer's
 * action registry.
 *
 * The native macOS menu items don't carry function references; main
 * fires this event with the `Action.id` registered for the menu item
 * and the renderer runs the actual handler. See
 * `contracts/ipc.v1.md` §menu:on:command for the contract.
 *
 * Unknown ids are logged with a dev warning (per the contract guidance
 * about registry drift) and otherwise no-op.
 *
 * One subscription per renderer process — this hook should be mounted
 * exactly once, at the app root.
 */

import * as React from "react";

import { getAtr } from "@renderer/lib/atr";
import { router } from "@renderer/router";
import { useUiStore } from "@renderer/stores/ui";
import {
  dispatchAction,
  focusedSlugFromLocation,
  resolveFocusedRepo,
  type ActionContext,
} from "./registry";

export function useMenuCommandBus(): void {
  // Sibling of RouterProvider — `useNavigate` would null-crash here.
  // The router singleton's navigate is context-free.
  const navigate = router.navigate.bind(router);
  // Pull store actions by selector — re-renders only when the action
  // identities change (i.e. never, post-create).
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const openPalette = useUiStore((s) => s.openPalette);
  const closePalette = useUiStore((s) => s.closePalette);
  const togglePalette = useUiStore((s) => s.togglePalette);
  const pushNotice = useUiStore((s) => s.pushNotice);

  // Keep the context fresh via a ref so the listener registered below
  // always sees the latest `navigate`/store actions without needing to
  // re-subscribe (subscribing/unsubscribing on every render would
  // leak listeners on hot-reload).
  const ctxRef = React.useRef<ActionContext>({
    navigate,
    ui: { toggleSidebar, openPalette, closePalette, togglePalette },
    notify: pushNotice,
  });
  React.useEffect(() => {
    ctxRef.current = {
      navigate,
      ui: { toggleSidebar, openPalette, closePalette, togglePalette },
      notify: pushNotice,
    };
  }, [
    navigate,
    toggleSidebar,
    openPalette,
    closePalette,
    togglePalette,
    pushNotice,
  ]);

  React.useEffect(() => {
    const atr = getAtr();
    if (!atr) return;

    // The preload MAY expose the menu-command subscription on either
    // `menu.onCommand` (canonical) or `app.onMenuCommand` (alias). We
    // prefer the canonical channel and fall back to the alias so the
    // renderer doesn't break if backend-system named it differently.
    const handler = (payload: { commandId: string }): void => {
      // Resolve the focused repo from the router singleton at dispatch
      // time (the native menu carries only the action id; the renderer
      // owns the context). With no focused repo the repo.* actions
      // no-op safely.
      const loc = router.state.location;
      const slug = focusedSlugFromLocation({
        pathname: loc.pathname,
        search: loc.search as Record<string, unknown> | undefined,
      });
      dispatchAction(payload.commandId, {
        ...ctxRef.current,
        ...resolveFocusedRepo(slug),
      });
    };

    let unsubscribe: (() => void) | undefined;
    if (atr.menu?.onCommand) {
      unsubscribe = atr.menu.onCommand(handler);
    } else if (atr.app?.onMenuCommand) {
      unsubscribe = atr.app.onMenuCommand(handler);
    } else {
      if (import.meta.env?.DEV) {
        console.warn(
          "[actions] menu.onCommand subscription unavailable on preload bridge",
        );
      }
      return;
    }

    return () => {
      try {
        unsubscribe?.();
      } catch {
        // ignore — preload may have already torn down on hot-reload
      }
    };
  }, []);
}
