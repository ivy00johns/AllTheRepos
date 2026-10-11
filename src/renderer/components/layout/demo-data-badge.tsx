/**
 * A screen reading the invented library says so, on every route it draws.
 *
 * In a browser tab with no Electron behind it, `lib/browser-bridge.ts` answers
 * every read from the demo library, and two of its answers are indistinguishable
 * from the real thing. `/settings` offers an update to 0.1.9 — a release that
 * does not exist, beside a `package.json` that says 0.1.8 and a feed whose
 * newest release is v0.1.8 — and `/debug` reports a main-process pid of 0.
 * "Update to 0.1.9" is a sentence somebody acts on, and the confusion it caused
 * is on the record; this badge is that confusion's fix.
 *
 * It says nothing about a release and nothing about the app: under Electron the
 * bridge never installs, `useServedLibrary()` stays null, and this renders
 * nothing at all. An exported catalog — `node scripts/export-catalog.mjs` — is
 * this machine's own library, so it is deliberately not marked either.
 *
 * The rule is a pure function of the source rather than a condition inside the
 * component, so it has a test instead of a comment. This suite runs with
 * `environment: "node"` and has no render test to put one in, which is the same
 * shape `adhoc-build-notice.tsx` uses for the same reason.
 */

import { FlaskConical } from "lucide-react";

import { useServedLibrary } from "@renderer/hooks/use-served-library";
import type { CatalogSource } from "@renderer/lib/demo-store";

/** True when this screen is reading the invented library. */
export function shouldMarkDemoData(source: CatalogSource | null): boolean {
  return source === "demo";
}

export function DemoDataBadge() {
  const source = useServedLibrary();

  if (!shouldMarkDemoData(source)) return null;

  return (
    <span
      data-demo-data="true"
      title="Every repo, folder, process and update on this screen is invented — a browser tab is reading the demo library, not your catalog. The app reads your own."
      className="flex shrink-0 cursor-help items-center gap-1.5 rounded-md bg-warning/15 px-2 py-1 text-xs text-warning"
    >
      <FlaskConical className="h-3.5 w-3.5" aria-hidden />
      <span className="font-mono atr-micro uppercase tracking-wider">Demo data</span>
      <span className="sr-only"> — nothing on this screen is real</span>
    </span>
  );
}
