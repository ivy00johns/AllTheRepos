/**
 * `alltherepos://` URL scheme registration + parsing.
 *
 * See `contracts/protocol.v1.md` for the URL grammar.
 *
 * Lifecycle:
 *   - `registerProtocolHandler()` is called once from `app.whenReady()`
 *     in `src/main/index.ts`. It:
 *       1. Calls `app.setAsDefaultProtocolClient('alltherepos')`.
 *       2. Subscribes to `app.on('open-url')` (macOS).
 *       3. Subscribes to `app.on('second-instance')` (Linux/Windows
 *          forward-compat: the OS hands the URL as an argv entry).
 *
 *   - On URL receipt: parse → ensure main window visible → broadcast
 *     `protocol:on:deep-link` to every renderer window.
 */

import { app, webContents as electronWebContents } from "electron";

import { IPC } from "@shared/ipc";
import { DeepLinkPayloadSchema } from "@shared/schemas";
import type { DeepLinkPayload } from "@shared/types";

import { getMainWindow } from "@main/window/main-window";

export const PROTOCOL_SCHEME = "alltherepos" as const;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * The path patterns we accept. Order matters — first match wins.
 * Each entry pairs a regex (anchored, no leading `/`) with a function
 * that extracts named path captures into a `Record<string, string>`.
 */
const PATH_PATTERNS: Array<{
  match: RegExp;
  captures: (m: RegExpMatchArray) => Record<string, string>;
}> = [
  {
    // `repo/<slug>` — slug grammar matches `[A-Za-z0-9_-]+`.
    match: /^repo\/([A-Za-z0-9_-]+)$/,
    captures: (m) => ({ slug: m[1]! }),
  },
  {
    // `settings` — no captures.
    match: /^settings$/,
    captures: () => ({}),
  },
  {
    // `action/<id>` — id grammar matches ActionIdSchema (kebab + dots).
    match: /^action\/([a-z][a-z0-9.-]*)$/,
    captures: (m) => ({ actionId: m[1]! }),
  },
];

/**
 * Parse a full `alltherepos://...` URL into a `DeepLinkPayload`.
 * Returns `null` if the URL is malformed or doesn't match a known
 * path pattern. Never throws.
 */
export function parseDeepLink(rawUrl: string): DeepLinkPayload | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== `${PROTOCOL_SCHEME}:`) {
    return null;
  }

  // `new URL('alltherepos://repo/foo')` yields:
  //   host = 'repo', pathname = '/foo'
  // We re-stitch into a path with no leading slash to match the contract.
  const hostPart = url.host;
  const pathPart = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  const recombined = hostPart
    ? pathPart
      ? `${hostPart}/${pathPart}`
      : hostPart
    : pathPart;

  if (!recombined) return null;

  // Match against known path patterns.
  let pathCaptures: Record<string, string> | null = null;
  for (const pattern of PATH_PATTERNS) {
    const m = recombined.match(pattern.match);
    if (m) {
      pathCaptures = pattern.captures(m);
      break;
    }
  }
  if (pathCaptures === null) {
    return null;
  }

  // Query-string params. URLSearchParams decodes once for us.
  const queryParams: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    queryParams[key] = value;
  }

  // Path captures WIN on collision (per contract).
  const params: Record<string, string> = {
    ...queryParams,
    ...pathCaptures,
  };

  const payload: DeepLinkPayload = {
    path: recombined,
    params,
  };

  // Defensive: parse our own output through the schema. Catches drift
  // if the parser ever produces a shape the contract rejects.
  const result = DeepLinkPayloadSchema.safeParse(payload);
  if (!result.success) {
    return null;
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Broadcast a deep-link payload to every renderer window. The main
 * window is also brought forward (unminimized / focused) so the user
 * isn't left wondering where the URL went.
 */
export function dispatchDeepLink(payload: DeepLinkPayload): void {
  const main = getMainWindow();
  if (main) {
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
  }

  for (const wc of electronWebContents.getAllWebContents()) {
    if (!wc.isDestroyed()) {
      wc.send(IPC.PROTOCOL.ON_DEEP_LINK, payload);
    }
  }
}

/**
 * Internal handler invoked from both the `open-url` (macOS) and
 * `second-instance` (Linux/Windows) event handlers. Parses the URL,
 * logs malformed URLs in dev, and dispatches to renderers on success.
 */
function handleIncomingUrl(rawUrl: string): void {
  const payload = parseDeepLink(rawUrl);
  if (!payload) {
    console.warn(`[protocol] rejected malformed deep link: ${rawUrl}`);
    return;
  }
  dispatchDeepLink(payload);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the `alltherepos://` scheme + event handlers. Idempotent —
 * safe to call more than once on hot-reload.
 *
 * MUST be called inside `app.whenReady()` per the Electron docs
 * (setAsDefaultProtocolClient is allowed earlier but the event
 * subscriptions need the app to be ready).
 */
export function registerProtocolHandler(): void {
  // Register as the default handler for the scheme on the OS. Returns
  // false on platforms where this isn't supported; we accept that.
  const ok = app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
  if (!ok) {
    console.warn(
      `[protocol] setAsDefaultProtocolClient(${PROTOCOL_SCHEME}) returned false`,
    );
  }

  // macOS dispatch path.
  app.on("open-url", (event, rawUrl) => {
    event.preventDefault();
    handleIncomingUrl(rawUrl);
  });

  // Linux / Windows dispatch path: a second instance launches with the
  // URL as an argv entry. We claim it via `app.requestSingleInstanceLock`
  // in `src/main/index.ts`; here we just sniff argv for our scheme.
  app.on("second-instance", (_event, argv) => {
    const urlArg = argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));
    if (urlArg) {
      handleIncomingUrl(urlArg);
    }
  });

  // Defensive: also handle the case where the app was launched cold
  // with a URL in argv (first-instance startup with a deep link).
  // We do this AFTER the renderer windows are up; the caller (boot
  // sequence in `src/main/index.ts`) decides when to fire this.
  const launchUrl = process.argv.find((arg) =>
    arg.startsWith(`${PROTOCOL_SCHEME}://`),
  );
  if (launchUrl) {
    // Defer to next tick so the main window has a chance to mount its
    // protocol-event subscriber before we send.
    setImmediate(() => {
      handleIncomingUrl(launchUrl);
    });
  }
}
