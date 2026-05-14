/**
 * LauncherDefaults — pair of select dropdowns shown on the Settings
 * page. Lets the user pick which editor and terminal to use as the
 * default when clicking the launcher icon row on a repo card.
 *
 * Options come from `atr.launcher.detect()` filtered to
 * `available: true`. We persist on every change via
 * `atr.settings.update(...)` (no separate save button — matches the
 * existing Settings UX for the embeddings inputs).
 *
 * The `Settings` shared type does NOT yet include `defaultEditor` /
 * `defaultTerminal` from Phase 3a (the contract notes that this is a
 * forward-compatible additive change). To avoid editing the shared
 * `Settings` interface from the renderer agent, we cast the update
 * input as `Partial<Phase3aSettings>` locally. The backend reads
 * these keys defensively.
 */

import * as React from "react";

import type {
  DetectedEditorZ,
  DetectedTerminalZ,
  EditorIdZ,
  TerminalIdZ,
} from "@shared/schemas";
import type {
  EditorId,
  Settings,
  TerminalId,
  UpdateSettingsInput,
} from "@shared/types";

import { Label } from "@renderer/components/ui/label";
import { useLauncherDetect } from "@renderer/hooks/use-launcher";
import { useUpdateSettings } from "@renderer/hooks/use-settings";

/**
 * Phase 3a additive Settings keys. NOT modifying `@shared/types`
 * from the renderer side — keeping this local type so the renderer
 * can pass these keys through `settings:update` and the backend
 * handles them.
 */
type Phase3aSettings = Settings & {
  defaultEditor?: EditorId | null;
  defaultTerminal?: TerminalId | null;
};

interface LauncherDefaultsProps {
  settings: Settings;
  /**
   * Optional callback fired after a successful update so the parent
   * form can refresh its local `settings` snapshot. The settings
   * query cache is also updated by `useUpdateSettings.onSuccess`.
   */
  onUpdated?: (next: Settings) => void;
}

export function LauncherDefaults({
  settings,
  onUpdated,
}: LauncherDefaultsProps) {
  const detect = useLauncherDetect();
  const update = useUpdateSettings();

  const current = settings as Phase3aSettings;
  const editors = (detect.data?.editors ?? []).filter(
    (e): e is DetectedEditorZ => e.available,
  );
  const terminals = (detect.data?.terminals ?? []).filter(
    (t): t is DetectedTerminalZ => t.available,
  );

  const handleEditorChange = React.useCallback(
    async (value: string) => {
      const next: EditorIdZ | null = value === "" ? null : (value as EditorIdZ);
      const patch = { defaultEditor: next } as Partial<Phase3aSettings>;
      const result = await update.mutateAsync(patch as UpdateSettingsInput);
      onUpdated?.(result);
    },
    [update, onUpdated],
  );

  const handleTerminalChange = React.useCallback(
    async (value: string) => {
      const next: TerminalIdZ | null =
        value === "" ? null : (value as TerminalIdZ);
      const patch = { defaultTerminal: next } as Partial<Phase3aSettings>;
      const result = await update.mutateAsync(patch as UpdateSettingsInput);
      onUpdated?.(result);
    },
    [update, onUpdated],
  );

  if (detect.isLoading) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        Detecting installed launchers…
      </p>
    );
  }

  if (detect.error) {
    return (
      <p className="font-mono text-xs text-destructive">
        Launcher detection unavailable: {detect.error.message}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="default-editor">Default editor</Label>
        <select
          id="default-editor"
          aria-label="Default editor"
          value={current.defaultEditor ?? ""}
          onChange={(e) => void handleEditorChange(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={editors.length === 0 || update.isPending}
        >
          <option value="">
            {editors.length === 0
              ? "No editors detected"
              : "— None (no default) —"}
          </option>
          {editors.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        {editors.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">
            No supported editors found in /Applications or on PATH.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="default-terminal">Default terminal</Label>
        <select
          id="default-terminal"
          aria-label="Default terminal"
          value={current.defaultTerminal ?? ""}
          onChange={(e) => void handleTerminalChange(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={terminals.length === 0 || update.isPending}
        >
          <option value="">
            {terminals.length === 0
              ? "No terminals detected"
              : "— None (no default) —"}
          </option>
          {terminals.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {terminals.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">
            No supported terminals found in /Applications.
          </p>
        ) : null}
      </div>
    </div>
  );
}
