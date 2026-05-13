/**
 * useDeepLinkBus — subscribes to `protocol:on:deep-link` push events
 * and routes them per `contracts/protocol.v1.md`.
 *
 * Routing table:
 *   - `repo/<slug>`         → navigate to `/repos/$slug`
 *   - `settings`            → navigate to `/settings`
 *   - `action/<id>`         → dispatch via the action registry
 *
 * Anything else logs a dev warning and no-ops. Per the contract,
 * `params.slug` / `params.actionId` are the canonical path captures
 * (path captures win over query-string entries on key collision —
 * that's enforced by main, the renderer just trusts the payload).
 */

import * as React from "react";

import { getAtr } from "@renderer/lib/atr";
import { router } from "@renderer/router";
import { useUiStore } from "@renderer/stores/ui";
import { dispatchAction, type ActionContext } from "./registry";

export function useDeepLinkBus(): void {
  // Use the router singleton directly. `useNavigate()` would crash here
  // because this hook is mounted as a sibling of RouterProvider, not
  // a child, and the navigation context is only valid inside the tree.
  const navigate = router.navigate.bind(router);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const openPalette = useUiStore((s) => s.openPalette);
  const closePalette = useUiStore((s) => s.closePalette);
  const togglePalette = useUiStore((s) => s.togglePalette);

  const ctxRef = React.useRef<ActionContext>({
    navigate,
    ui: { toggleSidebar, openPalette, closePalette, togglePalette },
  });
  React.useEffect(() => {
    ctxRef.current = {
      navigate,
      ui: { toggleSidebar, openPalette, closePalette, togglePalette },
    };
  }, [navigate, toggleSidebar, openPalette, closePalette, togglePalette]);

  React.useEffect(() => {
    const atr = getAtr();
    if (!atr) return;

    const handler = (payload: {
      path: string;
      params: Record<string, string>;
    }): void => {
      const { path, params } = payload;

      // `repo/<slug>` — navigate to repo detail.
      if (path.startsWith("repo/")) {
        const slug = params.slug ?? path.slice("repo/".length);
        if (slug) {
          void ctxRef.current.navigate({
            to: "/repos/$slug",
            params: { slug },
          });
        }
        return;
      }

      // `settings` — navigate to the settings page.
      if (path === "settings" || path.startsWith("settings/")) {
        void ctxRef.current.navigate({ to: "/settings" });
        return;
      }

      // `action/<id>` — dispatch via the action registry.
      if (path.startsWith("action/")) {
        const actionId = params.actionId ?? path.slice("action/".length);
        if (actionId) {
          dispatchAction(actionId, ctxRef.current);
        }
        return;
      }

      if (import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.warn(`[deep-link] unknown path "${path}"`);
      }
    };

    let unsubscribe: (() => void) | undefined;
    if (atr.protocol?.onDeepLink) {
      unsubscribe = atr.protocol.onDeepLink(handler);
    } else if (atr.app?.onDeepLink) {
      unsubscribe = atr.app.onDeepLink(handler);
    } else {
      if (import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.warn(
          "[actions] protocol.onDeepLink subscription unavailable on preload bridge",
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
