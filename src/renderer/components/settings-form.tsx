import * as React from "react";
import {
  CheckCircle2,
  FolderPlus,
  Play,
  Save,
  Trash2,
  XCircle,
} from "lucide-react";

import type { Settings } from "@shared/types";

import { LauncherDefaults } from "@renderer/components/launcher/launcher-defaults";
import { cn } from "@renderer/lib/cn";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import { Separator } from "@renderer/components/ui/separator";
import { useScan } from "@renderer/hooks/use-scan";
import { useUpdateSettings } from "@renderer/hooks/use-settings";

interface SettingsFormProps {
  initialSettings: Settings;
}

interface ScanStats {
  events: number;
  discovered: number;
  indexed: number;
  errors: number;
  lastMessage: string | null;
  done: boolean;
  success: boolean | null;
}

const EMPTY_STATS: ScanStats = {
  events: 0,
  discovered: 0,
  indexed: 0,
  errors: 0,
  lastMessage: null,
  done: false,
  success: null,
};

/**
 * SettingsForm — ported from `components/settings-form.tsx`.
 *
 * The Next.js version called `addScanPath`, `removeScanPath`, and
 * `saveSettings` Server Actions, and POSTed to `/api/scan` for the
 * NDJSON progress stream. In Electron these route through the
 * `useUpdateSettings` mutation and `useScan` hook (which subscribes to
 * `scan:on:progress` events via the preload bridge).
 */
export function SettingsForm({ initialSettings }: SettingsFormProps) {
  const [settings, setSettings] = React.useState<Settings>(initialSettings);
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [newPath, setNewPath] = React.useState("");
  const [scanStats, setScanStats] = React.useState<ScanStats>(EMPTY_STATS);

  const { mutateAsync: updateSettings } = useUpdateSettings();
  const { state: scanState, startScan } = useScan();
  const scanning = scanState.phase === "running";

  // Mirror live scan state from the Zustand-backed `useScan()` store
  // into local UI stats. The store coalesces push events; here we
  // translate each store-shape change into the same "events / found /
  // indexed / errors / lastMessage" UI the Next.js version showed.
  React.useEffect(() => {
    if (scanState.phase === "idle") return;
    setScanStats((prev) => {
      const next: ScanStats = { ...prev, events: prev.events + 1 };
      next.discovered = scanState.total;
      next.indexed = scanState.processed;
      if (scanState.phase === "running") {
        next.lastMessage = scanState.currentPath
          ? `Scanning ${scanState.currentPath}`
          : `Scanning…`;
        next.done = false;
        next.success = null;
      } else if (scanState.phase === "done") {
        next.done = true;
        next.success = !scanState.lastError;
        next.lastMessage = `Completed — ${scanState.reposFound} repos${
          scanState.durationMs !== null ? ` in ${scanState.durationMs}ms` : ""
        }`;
      } else if (scanState.phase === "error") {
        next.errors = prev.errors + 1;
        next.done = true;
        next.success = false;
        next.lastMessage = scanState.lastError ?? "Scan failed";
      } else if (scanState.phase === "cancelled") {
        next.done = true;
        next.success = false;
        next.lastMessage = "Scan cancelled";
      }
      return next;
    });
  }, [
    scanState.phase,
    scanState.processed,
    scanState.total,
    scanState.currentPath,
    scanState.reposFound,
    scanState.lastError,
    scanState.durationMs,
  ]);

  const handleAddPath = async () => {
    const p = newPath.trim();
    if (!p) return;
    const nextPaths = settings.scanPaths.includes(p)
      ? settings.scanPaths
      : [...settings.scanPaths, p];
    const next = await updateSettings({ scanPaths: nextPaths });
    setSettings(next);
    setNewPath("");
  };

  const handleRemovePath = async (p: string) => {
    const nextPaths = settings.scanPaths.filter((x) => x !== p);
    const next = await updateSettings({ scanPaths: nextPaths });
    setSettings(next);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const next = await updateSettings({
        ollamaBaseUrl: settings.ollamaBaseUrl,
        ollamaEmbedModel: settings.ollamaEmbedModel,
        openaiEmbedModel: settings.openaiEmbedModel,
        defaultEditor: settings.defaultEditor,
      });
      setSettings(next);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  const handleScan = async () => {
    setScanStats({ ...EMPTY_STATS });
    try {
      await startScan();
    } catch (e) {
      setScanStats((s) => ({
        ...s,
        done: true,
        success: false,
        lastMessage: e instanceof Error ? e.message : String(e),
      }));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="font-mono text-base font-semibold">Scan paths</h2>
          <p className="text-xs text-muted-foreground">
            Directories recursively searched for{" "}
            <code className="font-mono">.git</code> folders.
          </p>
        </div>
        <ul className="flex flex-col gap-1.5">
          {settings.scanPaths.length === 0 ? (
            <li className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              No paths configured yet.
            </li>
          ) : null}
          {settings.scanPaths.map((p) => (
            <li
              key={p}
              className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2"
            >
              <code className="flex-1 truncate font-mono text-xs">{p}</code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleRemovePath(p)}
                aria-label={`Remove scan path ${p}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Input
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddPath();
              }
            }}
            placeholder="/Users/johns/Repos"
            aria-label="New scan path"
            className="font-mono text-xs"
          />
          <Button
            variant="outline"
            onClick={handleAddPath}
            disabled={!newPath.trim()}
          >
            <FolderPlus className="h-4 w-4" aria-hidden />
            Add path
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="font-mono text-base font-semibold">Embeddings</h2>
          <p className="text-xs text-muted-foreground">
            Used for semantic search. Ollama is preferred; OpenAI is a fallback.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ollama-url">Ollama base URL</Label>
            <Input
              id="ollama-url"
              value={settings.ollamaBaseUrl}
              onChange={(e) =>
                setSettings({ ...settings, ollamaBaseUrl: e.target.value })
              }
              placeholder="http://localhost:11434"
              className="font-mono text-xs"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ollama-model">Ollama model</Label>
            <Input
              id="ollama-model"
              value={settings.ollamaEmbedModel}
              onChange={(e) =>
                setSettings({ ...settings, ollamaEmbedModel: e.target.value })
              }
              placeholder="nomic-embed-text"
              className="font-mono text-xs"
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="openai-model">OpenAI model (fallback)</Label>
            <Input
              id="openai-model"
              value={settings.openaiEmbedModel ?? ""}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  openaiEmbedModel: e.target.value || null,
                })
              }
              placeholder="text-embedding-3-small"
              className="font-mono text-xs"
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="font-mono text-base font-semibold">Default editor</h2>
          <p className="text-xs text-muted-foreground">
            Used when you middle-click or press Enter on a repo card.
          </p>
        </div>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Default editor</legend>
          {(["vscode", "cursor", "none"] as const).map((v) => (
            <label
              key={v}
              className={cn(
                "inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                settings.defaultEditor === v
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-border text-muted-foreground hover:border-border-strong",
              )}
            >
              <input
                type="radio"
                name="editor"
                value={v}
                checked={settings.defaultEditor === v}
                onChange={() => setSettings({ ...settings, defaultEditor: v })}
                className="h-3.5 w-3.5 accent-accent"
              />
              <span className="font-mono capitalize">{v}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="font-mono text-base font-semibold">
            Default editor &amp; terminal (Phase 3a)
          </h2>
          <p className="text-xs text-muted-foreground">
            Picks the app launched by the editor / terminal icons on each repo
            card. Detection runs once per app launch; restart to re-scan
            installed apps. Changes persist immediately.
          </p>
        </div>
        <LauncherDefaults
          settings={settings}
          onUpdated={(next) => setSettings(next)}
        />
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4" aria-hidden />
          {saving ? "Saving…" : "Save settings"}
        </Button>
        {savedAt ? (
          <span className="inline-flex items-center gap-1 text-xs text-accent">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Saved
          </span>
        ) : null}
      </div>

      <Separator />

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-mono text-base font-semibold">Scan now</h2>
            <p className="text-xs text-muted-foreground">
              Walk all configured paths, enrich metadata, and update the
              catalog.
            </p>
          </div>
          <Button
            onClick={handleScan}
            disabled={scanning || settings.scanPaths.length === 0}
          >
            <Play className="h-4 w-4" aria-hidden />
            {scanning ? "Scanning…" : "Scan now"}
          </Button>
        </div>
        {scanStats.events > 0 ? (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3 font-mono text-xs">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Found" value={scanStats.discovered} />
              <Stat label="Indexed" value={scanStats.indexed} />
              <Stat
                label="Errors"
                value={scanStats.errors}
                tone={scanStats.errors > 0 ? "destructive" : undefined}
              />
            </div>
            {scanStats.lastMessage ? (
              <p className="flex items-start gap-2 text-muted-foreground">
                {scanStats.done ? (
                  scanStats.success ? (
                    <CheckCircle2
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent"
                      aria-hidden
                    />
                  ) : (
                    <XCircle
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
                      aria-hidden
                    />
                  )
                ) : (
                  <span
                    aria-hidden
                    className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent"
                  />
                )}
                <span className="min-w-0 break-all">
                  {scanStats.lastMessage}
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "destructive";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-lg font-semibold",
          tone === "destructive" ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}
