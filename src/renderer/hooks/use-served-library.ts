/**
 * The library the renderer is reading, for the screens that have to say so.
 *
 * `lib/browser-bridge.ts` publishes the answer once `loadExportedCatalog`
 * settles, and it is a subscription rather than a constant because the first
 * read happens on mount: a tab that resolved the export a frame late would
 * otherwise draw a badge for the demo library over this machine's own catalog,
 * or the reverse. `useSyncExternalStore` is what keeps that read consistent
 * across a concurrent render — a `useState` seeded at import reads whatever was
 * true on the first paint.
 */

import { useSyncExternalStore } from "react";

import {
  servedCatalogSource,
  subscribeToServedCatalogSource,
} from "@renderer/lib/browser-bridge";
import type { CatalogSource } from "@renderer/lib/demo-store";

export function useServedLibrary(): CatalogSource | null {
  return useSyncExternalStore(
    subscribeToServedCatalogSource,
    servedCatalogSource,
    // Nothing is served before a client exists, and this app renders no markup
    // on a server: the third argument is here because the signature asks for it.
    () => null,
  );
}
