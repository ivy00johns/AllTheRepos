/**
 * LauncherDefaults — pair of select dropdowns shown on the Settings
 * page. Lets the user pick which editor and terminal to use as the
 * default when clicking the launcher icon row on a repo card.
 *
 * Options come from `atr.launcher.detect()`, filtered to what is actually
 * installed. Two deliberate exceptions, both so the control never lies
 * about what is stored:
 *   - the editor enum carries an explicit `"none"`, so the "no default"
 *     choice is a real value that round-trips instead of being stored as
 *     something the schema would later reject;
 *   - a saved editor that is no longer installed stays in the list,
 *     labelled "(not detected)", instead of collapsing to the placeholder.
 *
 * We persist on every change via `atr.settings.update(...)` — no separate
 * save button, matching the embeddings inputs above it.
 */

import * as React from "react";

import type { DefaultEditorZ, TerminalIdZ } from "@shared/schemas";
import type { Settings, UpdateSettingsInput } from "@shared/types";

import { Label } from "@renderer/components/ui/label";
import { useLauncherDetect } from "@renderer/hooks/use-launcher";
import { useUpdateSettings } from "@renderer/hooks/use-settings";

interface LauncherDefaultsProps {
  settings: Settings;
  /**
   * Optional callback fired after a successful update so the parent
   * form can refresh its local `settings` snapshot. The settings
   * query cache is also updated by `useUpdateSettings.onSuccess`.
   */
  onUpdated?: (next: Settings) => void;
}

/** Shared classes for the two selects. */
const SELECT_CLASS =
  "h-9 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export function LauncherDefaults({
  settings,
  onUpdated,
}: LauncherDefaultsProps) {
  const detect = useLauncherDetect();
  const update = useUpdateSettings();

  const editors = (detect.data?.editors ?? []).filter((e) => e.available);
  const terminals = (detect.data?.terminals ?? []).filter((t) => t.available);

  const savedEditor = settings.defaultEditor;

  /**
   * Installed editors, plus the saved one when it is no longer present.
   * Built inline (rather than memoised): `filter` hands back a fresh array
   * every render anyway, and the list is at most fifteen rows.
   */
  const editorOptions: Array<{ id: string; name: string }> = editors.map(
    (e) => ({ id: e.id, name: e.name }),
  );
  if (
    savedEditor !== "none" &&
    !editorOptions.some((o) => o.id === savedEditor)
  ) {
    editorOptions.push({
      id: savedEditor,
      name: `${savedEditor} (not detected)`,
    });
  }

  const handleEditorChange = React.useCallback(
    async (value: string) => {
      const patch: UpdateSettingsInput = {
        defaultEditor: value as DefaultEditorZ,
      };
      const result = await update.mutateAsync(patch);
      onUpdated?.(result);
    },
    [update, onUpdated],
  );

  const handleTerminalChange = React.useCallback(
    async (value: string) => {
      const patch: UpdateSettingsInput = {
        defaultTerminal: value === "" ? null : (value as TerminalIdZ),
      };
      const result = await update.mutateAsync(patch);
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
          value={savedEditor}
          onChange={(e) => void handleEditorChange(e.target.value)}
          className={SELECT_CLASS}
          disabled={update.isPending}
        >
          <option value="none">— No default (use the first installed) —</option>
          {editorOptions.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        {editors.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">
            No supported editors found in /Applications, ~/Applications,
            /System/Applications or on PATH.
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            {editors.length} editor{editors.length === 1 ? "" : "s"} found.
            Detection runs once per launch — restart to re-scan.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="default-terminal">Default terminal</Label>
        <select
          id="default-terminal"
          aria-label="Default terminal"
          value={settings.defaultTerminal ?? ""}
          onChange={(e) => void handleTerminalChange(e.target.value)}
          className={SELECT_CLASS}
          disabled={terminals.length === 0 || update.isPending}
        >
          <option value="">
            {terminals.length === 0
              ? "No terminals detected"
              : "— Auto (first available) —"}
          </option>
          {terminals.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {terminals.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">
            No supported terminals found in /Applications or on PATH.
          </p>
        ) : null}
      </div>
    </div>
  );
}
