/**
 * Ad-hoc build notice — the one-time explanation of a first launch that macOS
 * refused.
 *
 * A downloaded copy of an un-notarised build does not open. macOS shows
 * *"Apple could not verify … is free of malware"* and the only way through is
 * System Settings, and because the app is not running when that happens, no
 * amount of in-app help can be there for it. So the DMG carries the
 * instructions (`resources/READ-ME-FIRST.txt`) and this is the other half:
 * once the person *is* inside the app, it says what they just clicked through
 * and why, rather than leaving them to infer it from a document they may never
 * open again.
 *
 * Two deliberate properties:
 *
 *   - It appears only on a build macOS will treat this way — ad-hoc signed or
 *     unsigned, read off the running bundle. A notarised build never shows it,
 *     and neither does a development run, where there is no signature to
 *     explain.
 *   - It appears **once**. It is an explanation of a past event, not a
 *     standing warning, so dismissing it is remembered in Settings and it does
 *     not come back. A banner that reappears every launch is one people learn
 *     to ignore, which would cost more than it explains.
 */

import { ShieldAlert, X } from "lucide-react";

import type { UpdateStatus } from "@shared/types";

import { useSettings, useUpdateSettings } from "@renderer/hooks/use-settings";
import { useUpdate } from "@renderer/hooks/use-update";

/**
 * Whether this build deserves the explanation.
 *
 * Pure, and exported, because "shows once, never on a signed build" is the
 * whole contract and it is worth asserting without rendering React: the
 * failure mode is a banner that nags or one that never appears, and both are
 * invisible to every other test in the repository.
 *
 * `developer-id` is excluded explicitly rather than by testing `canInstall`:
 * a notarised-but-Gatekeeper-rejected build still must not be told it is
 * un-notarised. `unknown` is excluded too — that is an unpackaged run, where
 * there is no signature and nothing to explain.
 */
export function shouldShowAdHocNotice({
  signature,
  dismissed,
}: {
  signature: UpdateStatus["signature"];
  dismissed: boolean;
}): boolean {
  if (dismissed) return false;
  return signature === "ad-hoc" || signature === "unsigned";
}

export function AdHocBuildNotice() {
  const { status } = useUpdate();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();

  // No settings yet means the flag cannot be read *or* written — showing a
  // notice the app cannot remember dismissing would make it reappear forever.
  if (!settings.data) return null;

  // `?? false` because the contract type keeps the field optional so a
  // settings blob written before it existed still typechecks; absent means
  // not yet dismissed, which is what the schema defaults it to as well.
  const dismissed = settings.data.adHocNoticeDismissed ?? false;
  if (!shouldShowAdHocNotice({ signature: status.signature, dismissed })) {
    return null;
  }

  const dismiss = () => {
    updateSettings.mutate({ adHocNoticeDismissed: true });
  };

  return (
    <div
      role="status"
      className="flex shrink-0 items-start gap-3 border-b border-border bg-accent/10 px-3 py-2 text-xs"
    >
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
      <div className="flex flex-col gap-1">
        <span className="font-medium">
          macOS asked you to confirm the first launch — here is why
        </span>
        <span className="text-muted-foreground">
          This build is ad-hoc signed and not notarised by Apple, so macOS
          refused it until you allowed it in System Settings &rarr; Privacy
          &amp; Security. The same fact is why the app checks for new releases
          but does not install them: a notarised build removes both steps.
        </span>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss this explanation"
        className="ml-auto flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        <span>Got it</span>
        <X className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}
