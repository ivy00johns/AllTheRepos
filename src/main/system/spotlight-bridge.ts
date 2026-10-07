/**
 * Thin runtime bridge to the backend-windows-owned spotlight window.
 *
 * `backend-windows` ships `src/main/window/spotlight.ts` exporting:
 *   ```
 *   export const spotlightWindow: {
 *     toggle(): void;
 *     show(): void;
 *     hide(): void;
 *   };
 *   ```
 *
 * Dynamic `require` so the build succeeds before backend-windows merges
 * (see `tray-popover-bridge.ts` for the same rationale).
 */

type SpotlightApi = {
  toggle(): void;
  show(): void;
  hide(): void;
};

let cached: SpotlightApi | null = null;
let attempted = false;

function loadSpotlight(): SpotlightApi | null {
  if (cached) return cached;
  if (attempted) return null;
  attempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a module that may not be in the tree yet; see the header
    const mod = require("@main/window/spotlight") as
      | { spotlightWindow?: SpotlightApi }
      | undefined;
    if (mod && typeof mod.spotlightWindow === "object") {
      cached = mod.spotlightWindow;
      return cached;
    }
    return null;
  } catch {
    return null;
  }
}

export function showSpotlightWindow(): void {
  const api = loadSpotlight();
  if (!api) {
    console.warn(
      "[spotlight] spotlight window not available (backend-windows not loaded)",
    );
    return;
  }
  api.show();
}

export function hideSpotlightWindow(): void {
  const api = loadSpotlight();
  if (!api) return;
  api.hide();
}

export function toggleSpotlightWindow(): void {
  const api = loadSpotlight();
  if (!api) {
    console.warn(
      "[spotlight] spotlight window not available (backend-windows not loaded)",
    );
    return;
  }
  api.toggle();
}
