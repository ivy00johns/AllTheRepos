/**
 * Native desktop notifications.
 *
 * Two entry points:
 *   - `handleNotify(input)` — Zod-validated façade for the
 *     `app:notify` IPC handler. Renderer pushes a `NotifyInput`,
 *     we show a `Notification`, return `{ shown }`.
 *   - `notifyScanComplete(repos, ms)` — main-initiated convenience
 *     wired to `scanService.events` in `src/main/index.ts`. Fires
 *     only when a scan reaches the `done` event.
 *
 * Defensive design: `Notification.isSupported()` is false on some
 * Linux distros and in the test harness. We short-circuit to
 * `{ shown: false }` rather than throwing — the renderer's calling
 * code already treats this as best-effort.
 */

import { Notification } from "electron";

import { NotifyInputSchema, NotifyResultSchema } from "@shared/schemas";
import type { NotifyInput, NotifyResult } from "@shared/types";

/**
 * Show a notification with the renderer-supplied payload.
 *
 * `actions` map onto Electron's `NotificationAction[]`. macOS shows ≤1
 * action reliably on a banner; we cap the array at 3 in the Zod schema.
 *
 * The IPC handler is responsible for `assertRendererFrame` + parsing
 * input through `NotifyInputSchema` BEFORE calling this function (we
 * also parse here defensively for direct callers).
 */
export function handleNotify(rawInput: unknown): NotifyResult {
  const input: NotifyInput = NotifyInputSchema.parse(rawInput);

  if (!Notification.isSupported()) {
    return NotifyResultSchema.parse({ shown: false });
  }

  const notification = new Notification({
    title: input.title,
    body: input.body,
    silent: input.silent ?? false,
    actions: input.actions
      ? input.actions.map((a) => ({ type: a.type, text: a.text }))
      : undefined,
  });

  // `notification.show()` returns void — the OS queues the notification
  // and renders it asynchronously. We optimistically return `shown: true`.
  notification.show();

  return NotifyResultSchema.parse({ shown: true });
}

/**
 * Convenience emitter for the "Scan complete" notification. Called
 * from the `scanService.events` "progress" subscription in
 * `src/main/index.ts` when the event kind is `"done"`.
 *
 * Kept here (not in the scan service) so the notification surface is
 * cohesive — every native notification flows through one module.
 */
export function notifyScanComplete(
  reposFound: number,
  durationMs: number,
): void {
  if (!Notification.isSupported()) return;

  const seconds = (durationMs / 1000).toFixed(1);
  const body =
    reposFound === 1
      ? `Found 1 repository in ${seconds}s`
      : `Found ${reposFound} repositories in ${seconds}s`;

  const notification = new Notification({
    title: "Scan complete",
    body,
    silent: false,
  });
  notification.show();
}
