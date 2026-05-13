/**
 * useActionRegistration — one-shot hook that pushes the renderer's
 * action registry to the main process so main can build the native
 * Application menu and bind accelerators.
 *
 * Phase 2 has a static registry (the eight baseline actions). If a
 * future phase makes the list dynamic, the dep array MUST be widened
 * accordingly; the IPC handler is documented as re-callable in
 * `contracts/ipc.v1.md`, so re-firing is cheap.
 *
 * The hook is intentionally lenient — if the preload bridge is missing
 * (e.g. the renderer is open in a plain browser during QE), or if the
 * registration RPC throws, we log in dev and otherwise carry on. The
 * native menu just won't be built; the in-app palette still works.
 */

import * as React from "react";

import { getAtr } from "@renderer/lib/atr";
import { serializeActionsForIpc } from "./registry";

export function useActionRegistration(): void {
  React.useEffect(() => {
    const atr = getAtr();
    if (!atr) return;

    const payload = { actions: serializeActionsForIpc() };

    let cancelled = false;
    (async () => {
      try {
        const result = await atr.app.registerActions(payload);
        if (cancelled) return;
        if (import.meta.env?.DEV && result.skipped > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            `[actions] main skipped ${result.skipped} action(s) — see ipc.v1.md §app:registerActions`,
          );
        }
      } catch (err) {
        if (import.meta.env?.DEV) {
          // eslint-disable-next-line no-console
          console.warn("[actions] registerActions failed:", err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}
