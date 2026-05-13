/**
 * Installs the strict Content-Security-Policy header for renderer responses.
 *
 * Locked in Phase 0 per NEW-PLAN.md §3.4. The policy intentionally:
 *   - blocks remote script/style by default (`default-src 'self'`),
 *   - allows inline styles only (Tailwind / Radix runtime styles),
 *   - allows `data:` and `blob:` images (favicons, screenshots, etc.),
 *   - allows GitHub avatars,
 *   - allows local Ollama (`http://localhost:11434`) and the OpenAI fallback,
 *     plus localhost HMR sockets in development.
 *
 * In production we tighten `connect-src` to just self + Ollama + OpenAI.
 * In development we additionally allow any localhost HTTP/WS for HMR.
 */

import { session } from "electron";

/** Phase 0 CSP — see §3.4 of NEW-PLAN.md. */
function buildCspHeader(isDev: boolean): string {
  const connectSrc = isDev
    ? "'self' http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:* http://localhost:11434 https://api.openai.com"
    : "'self' http://localhost:11434 https://api.openai.com";

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://avatars.githubusercontent.com",
    `connect-src ${connectSrc}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Wires the CSP header on `session.defaultSession`. Call once from
 * `app.whenReady()` BEFORE the first BrowserWindow is created so the
 * very first document response carries the header.
 */
export function installContentSecurityPolicy(): void {
  const isDev =
    process.env.NODE_ENV !== "production" &&
    typeof process.env.ELECTRON_RENDERER_URL === "string" &&
    process.env.ELECTRON_RENDERER_URL.length > 0;

  const cspHeader = buildCspHeader(isDev);

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...(details.responseHeaders ?? {}) };

    // Strip any existing CSP set upstream so our policy wins deterministically.
    for (const key of Object.keys(responseHeaders)) {
      if (key.toLowerCase() === "content-security-policy") {
        delete responseHeaders[key];
      }
    }

    responseHeaders["Content-Security-Policy"] = [cspHeader];

    callback({ responseHeaders });
  });
}
