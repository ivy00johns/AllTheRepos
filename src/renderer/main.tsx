import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "@renderer/App";
import { SpotlightApp } from "@renderer/components/spotlight/spotlight-app";
import { TrayPopoverApp } from "@renderer/components/tray-popover/tray-popover-app";
import { queryClient } from "@renderer/lib/query-client";
import "@renderer/styles/globals.css";

/**
 * Same React bundle, three windows. Each Electron BrowserWindow loads
 * the same `index.html` and gets its own renderer process; we use
 * `window.location.hash` to decide which root component to mount.
 *
 *   - `#window=spotlight`     → <SpotlightApp />
 *   - `#window=tray-popover`  → <TrayPopoverApp />
 *   - anything else / missing → <App /> (the full catalog shell)
 *
 * Why hash-based: Electron sets `loadURL(..., { hash: 'window=...' })`
 * for the satellite windows; the renderer reads it synchronously
 * before mounting React. We MUST decide here (not inside <App />) so
 * the router / scan event bus / catalog QueryClient priming all stay
 * scoped to the main window.
 *
 * All three windows share the same QueryClient singleton at the
 * module level (each renderer process has its own copy — they don't
 * see each other's cache). The provider just makes the cache
 * reachable from `useRepos()` in the satellite windows.
 */
function selectRoot(): React.ComponentType {
  if (typeof window === "undefined") return App;
  const raw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(raw);
  const windowKind = params.get("window") ?? "main";
  if (windowKind === "spotlight") return SpotlightApp;
  if (windowKind === "tray-popover") return TrayPopoverApp;
  return App;
}

const Root = selectRoot();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Renderer bootstrap failed: #root not found in index.html");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </React.StrictMode>,
);
