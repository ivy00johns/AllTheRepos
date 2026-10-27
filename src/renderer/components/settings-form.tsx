/**
 * Settings — the handoff's block layout, not a stack of cards.
 *
 * Each block is a wrapping flex row on a hairline: the label column states
 * what the setting is and why it exists, the control column holds the
 * controls. That is what makes Settings read as one page of decisions rather
 * than six panels, and it is why the old `rounded-lg border bg-card p-5`
 * sections are gone — six boxes inside a centred 1024px column read as a form
 * somebody dropped on the window.
 *
 * Behaviour is unchanged: every control writes through the same hook it did,
 * the scan-path add still goes through `settings:addScanPath` so typed and
 * picked folders obey one set of rules, and the one explicit save that remains
 * is the embeddings/identity snapshot (the editor and terminal persist on
 * change). The save is a quiet footer, not a primary action, because the
 * handoff's Settings has no save button at all and the honest version of that
 * is to make the app save as you go — a later pass, once the fields debounce.
 */

import * as React from "react";
import {
  ArrowDownToLine,
  CheckCircle2,
  Play,
  RotateCw,
  Save,
  RefreshCw,
} from "lucide-react";

import type {
  Settings,
  UpdateStatus,
  TestEmbeddingResult,
} from "@shared/types";

import { requireAtr } from "@renderer/lib/atr";
import { LauncherDefaults } from "@renderer/components/launcher/launcher-defaults";
import { cn } from "@renderer/lib/cn";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { useScan } from "@renderer/hooks/use-scan";
import { useAllRepos } from "@renderer/hooks/use-repos";
import { useAddScanPath } from "@renderer/hooks/use-scan-roots";
import { useUpdateSettings } from "@renderer/hooks/use-settings";
import { useUpdate } from "@renderer/hooks/use-update";

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
 * One clause explaining why this build cannot install its own update.
 *
 * The signature is read off the bundle main-side, so this only has to
 * phrase it: "ad-hoc" and "unsigned" are both "macOS won't run an update",
 * but they are not the same problem and the user deserves to know which.
 */
const INSTALL_REFUSAL: Record<UpdateStatus["signature"], string> = {
  "developer-id":
    "This build is Developer-ID signed but not notarised, so Gatekeeper would refuse the update",
  "ad-hoc":
    "This build is ad-hoc signed, so macOS will not let it update itself",
  unsigned:
    "This build is not code-signed, so macOS will not let it update itself",
  unknown: "This build is not signed in a way macOS will accept for an update",
};

/** One settings block: the label column and the controls beside it. */
function Block({
  title,
  description,
  children,
}: {
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-wrap gap-x-12 gap-y-4 border-b border-border px-6 py-6">
      <div className="flex max-w-[420px] flex-[1_1_240px] flex-col gap-1.5">
        <h2 className="text-name font-semibold text-foreground">{title}</h2>
        <p className="text-body leading-normal text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="flex min-w-0 flex-[2_1_420px] flex-col gap-3">
        {children}
      </div>
    </section>
  );
}

/** A 12px field label, sentence case — never an eyebrow. */
function Field({
  htmlFor,
  label,
  children,
  className,
}: {
  htmlFor?: string;
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-[1_1_200px] flex-col gap-1.5",
        className,
      )}
    >
      <label
        htmlFor={htmlFor}
        className="text-label font-medium text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

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
  const [error, setError] = React.useState<string | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [connection, setConnection] =
    React.useState<TestEmbeddingResult | null>(null);
  const testConnection = async () => {
    setTesting(true);
    setConnection(null);
    try {
      setConnection(
        await requireAtr().settings.testEmbedding({
          baseUrl: settings.ollamaBaseUrl,
          model: settings.ollamaEmbedModel,
        }),
      );
    } catch (error) {
      setConnection({
        ok: false,
        dimensions: 0,
        durationMs: 0,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTesting(false);
    }
  };
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [newPath, setNewPath] = React.useState("");
  const [newIdentity, setNewIdentity] = React.useState("");
  const update = useUpdate();
  const [scanStats, setScanStats] = React.useState<ScanStats>(EMPTY_STATS);

  const identities = settings.identities ?? [];

  /*
   * How many catalogued repos each scan root holds. The handoff's row reads
   * `12 repos · 4 min ago`; the catalog knows the count, and no per-root scan
   * timestamp exists in the settings contract, so the honest half is the one
   * shown rather than inventing the other.
   */
  const catalogQuery = useAllRepos();
  const repoCountByPath = React.useMemo(() => {
    const counts = new Map<string, number>();
    const roots = [...settings.scanPaths].sort((a, b) => b.length - a.length);
    for (const repo of catalogQuery.data?.items ?? []) {
      const owner = roots.find(
        (root) =>
          repo.fullPath === root || repo.fullPath.startsWith(`${root}/`),
      );
      if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    return counts;
  }, [catalogQuery.data, settings.scanPaths]);

  /** Add a handle, ignoring blanks and case-insensitive duplicates. */
  const addIdentity = React.useCallback(() => {
    const value = newIdentity.trim().replace(/^@/, "");
    if (!value) return;
    setSettings((prev) => {
      const existing = prev.identities ?? [];
      if (existing.some((i) => i.toLowerCase() === value.toLowerCase())) {
        return prev;
      }
      return { ...prev, identities: [...existing, value] };
    });
    setNewIdentity("");
  }, [newIdentity]);

  const { mutateAsync: updateSettings } = useUpdateSettings();
  const { mutateAsync: addScanPath } = useAddScanPath();
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

  /**
   * Add a typed path through the same call the rail uses.
   *
   * Writing the array straight into `settings:update` made this a second door
   * into the scan list with no rules behind it: a relative path, a folder
   * already covered by a root, or a folder that is not there all went in and
   * drew an empty row. `settings:addScanPath` resolves the path, refuses what
   * the scanner cannot use, and starts the scan — so both doors now do the same
   * thing and say so in the same words.
   */
  const handleAddPath = async () => {
    const p = newPath.trim();
    if (!p) return;
    try {
      setError(null);
      const result = await addScanPath(p);
      if (!result.added) {
        setError(result.reason ?? "That folder could not be added.");
        return;
      }
      setSettings((current) => ({
        ...current,
        scanPaths: result.settings.scanPaths,
      }));
      setNewPath("");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRemovePath = async (p: string) => {
    const nextPaths = settings.scanPaths.filter((x) => x !== p);
    try {
      setError(null);
      const next = await updateSettings({ scanPaths: nextPaths });
      setSettings((current) => ({ ...current, scanPaths: next.scanPaths }));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      // `defaultEditor` / `defaultTerminal` are deliberately absent: the
      // editor & terminal section persists each change as it is made, so
      // re-sending a snapshot from here could only overwrite a newer value
      // with a stale one.
      const next = await updateSettings({
        identities: settings.identities,
        ollamaBaseUrl: settings.ollamaBaseUrl,
        ollamaEmbedModel: settings.ollamaEmbedModel,
        openaiEmbedModel: settings.openaiEmbedModel,
      });
      setSettings(next);
      setSavedAt(Date.now());
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
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
    <div className="flex flex-col pb-12">
      {error ? (
        <p
          role="alert"
          className="border-b border-border px-6 py-3 text-body text-destructive"
        >
          {error}
        </p>
      ) : null}

      <Block
        title="Scan paths"
        description="Folders AllTheRepos indexes. Nested repositories are found automatically."
      >
        <div className="flex flex-col">
          {settings.scanPaths.length === 0 ? (
            <p className="border-t border-border py-2 text-body text-muted-foreground">
              No paths configured yet.
            </p>
          ) : null}
          {settings.scanPaths.map((p) => (
            <div
              key={p}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border py-2 last:border-b"
            >
              <span
                className="min-w-0 flex-1 truncate font-mono text-body text-foreground"
                title={p}
              >
                {p}
              </span>
              <span className="atr-meta tabular-nums">
                {repoCountByPath.get(p) ?? 0} repos
              </span>
              <button
                type="button"
                onClick={() => void handleRemovePath(p)}
                aria-label={`Remove scan path ${p}`}
                className="cursor-pointer text-label font-medium text-muted-foreground transition-colors duration-150 hover:text-destructive"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAddPath();
              }
            }}
            placeholder="Add a folder, e.g. ~/Work"
            aria-label="New scan path"
            className="h-8 min-w-0 flex-1 font-mono text-body"
          />
          <Button
            variant="bordered"
            className="h-8 text-label"
            onClick={() => void handleAddPath()}
            disabled={!newPath.trim()}
          >
            Add folder
          </Button>
        </div>
      </Block>

      <Block
        title="Embeddings"
        description="Turns on semantic search, so a query can match what a repo does, not only its name. Runs locally with Ollama, or through OpenAI."
      >
        <div className="flex flex-wrap gap-3">
          <Field htmlFor="ollama-url" label="Host">
            <Input
              id="ollama-url"
              value={settings.ollamaBaseUrl}
              onChange={(e) =>
                setSettings({ ...settings, ollamaBaseUrl: e.target.value })
              }
              placeholder="http://localhost:11434"
              className="h-8 font-mono text-meta"
            />
          </Field>
          <Field htmlFor="ollama-model" label="Model">
            <Input
              id="ollama-model"
              value={settings.ollamaEmbedModel}
              onChange={(e) =>
                setSettings({ ...settings, ollamaEmbedModel: e.target.value })
              }
              placeholder="nomic-embed-text"
              className="h-8 font-mono text-meta"
            />
          </Field>
          <Field htmlFor="openai-model" label="OpenAI model (fallback)">
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
              className="h-8 font-mono text-meta"
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="bordered"
            className="h-8 text-label"
            disabled={testing}
            onClick={() => void testConnection()}
          >
            {testing ? "Testing…" : "Test Ollama connection"}
          </Button>
          {connection ? (
            <span
              role="status"
              className={cn(
                "flex items-center gap-1.5 text-label",
                connection.ok ? "text-status-live" : "text-warning",
              )}
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-current"
              />
              {connection.message}
              {connection.durationMs > 0 ? ` · ${connection.durationMs}ms` : ""}
            </span>
          ) : null}
        </div>

        <p className="text-label text-muted-foreground">
          Changes save as you type.
        </p>
      </Block>

      <Block
        title="Editor and terminal"
        description="What Open and Terminal launch from the detail panel, palette and spotlight."
      >
        {/*
          The selects belong to LauncherDefaults, which persists on change.
          The overrides here are the block's: 32px controls and 12px field
          labels, so the two selects sit in the same rhythm as every other
          control on the page.
        */}
        <div className="[&_label]:text-label [&_label]:font-medium [&_label]:normal-case [&_label]:tracking-normal [&_label]:text-muted-foreground [&_select]:h-8 [&_select]:rounded [&_select]:text-body">
          <LauncherDefaults
            settings={settings}
            onUpdated={(next) =>
              setSettings((current) => ({
                ...current,
                defaultEditor: next.defaultEditor,
                defaultTerminal: next.defaultTerminal,
              }))
            }
          />
        </div>
        <p className="text-label text-muted-foreground">
          Changes save as you type.
        </p>
      </Block>

      <Block
        title="Updates"
        description={
          update.status.canInstall
            ? "Checks GitHub for a newer release on launch, and installs it when you ask."
            : `Checks GitHub for a newer release on launch. ${INSTALL_REFUSAL[update.status.signature]}, so Get opens the release page.`
        }
      >
        <div className="flex flex-wrap items-center gap-4">
          <span className="atr-meta">
            Version {update.status.currentVersion || "—"}
          </span>
          <Button
            variant="bordered"
            className="h-8 text-label"
            onClick={update.check}
            disabled={update.checking || update.installing}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", update.checking && "animate-spin")}
              aria-hidden
            />
            {update.checking ? "Checking…" : "Check for updates"}
          </Button>
          {update.status.state === "ready" ? (
            <Button
              className="h-8 text-label"
              onClick={update.install}
              disabled={update.installing}
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
              Restart to install
            </Button>
          ) : null}
          {update.status.state === "available" ? (
            update.status.canInstall ? (
              <Button
                className="h-8 text-label"
                onClick={update.install}
                disabled={update.installing}
              >
                <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden />
                Install {update.status.newVersion}
              </Button>
            ) : (
              <Button className="h-8 text-label" onClick={update.openRelease}>
                Get {update.status.newVersion}
              </Button>
            )
          ) : null}
        </div>
        {update.status.state === "downloading" ? (
          <div className="flex flex-col gap-1.5">
            <p className="atr-meta">
              Downloading version {update.status.newVersion}
              {update.status.progress !== null
                ? ` — ${Math.round(update.status.progress)}%`
                : "…"}
            </p>
            <div className="h-1 w-48 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-foreground transition-all duration-300"
                style={{ width: `${update.status.progress ?? 0}%` }}
              />
            </div>
          </div>
        ) : null}
        {update.status.state === "ready" ? (
          <p className="text-label text-muted-foreground">
            Version {update.status.newVersion} is downloaded — restarting
            installs it.
          </p>
        ) : null}
        {update.status.state === "current" ? (
          <p className="text-label text-muted-foreground">
            You&apos;re on the latest release.
          </p>
        ) : null}
        {update.status.message ? (
          <p className="text-label text-muted-foreground">
            {update.status.message}
          </p>
        ) : null}
      </Block>

      <Block
        title="Identities"
        description="Git handles that count as you. Repos with commits from these are marked Mine; everything else with a remote is Cloned."
      >
        <div className="flex flex-col">
          {identities.length === 0 ? (
            <p className="border-t border-border py-2 text-body italic text-muted-foreground">
              None set — inferring from your remotes.
            </p>
          ) : null}
          {identities.map((identity) => (
            <div
              key={identity}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-border py-2 last:border-b"
            >
              <span className="text-body text-foreground">{identity}</span>
              <button
                type="button"
                aria-label={`Remove identity ${identity}`}
                onClick={() =>
                  setSettings((prev) => ({
                    ...prev,
                    identities: prev.identities.filter(
                      (value) => value !== identity,
                    ),
                  }))
                }
                className="cursor-pointer text-label font-medium text-muted-foreground transition-colors duration-150 hover:text-destructive"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <label htmlFor="identity-input" className="sr-only">
            Add a git handle
          </label>
          <Input
            id="identity-input"
            value={newIdentity}
            placeholder="github-handle"
            spellCheck={false}
            onChange={(event) => setNewIdentity(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addIdentity();
              }
            }}
            className="h-8 min-w-0 max-w-xs flex-1"
          />
          <Button
            variant="bordered"
            className="h-8 text-label"
            onClick={addIdentity}
          >
            Add identity
          </Button>
        </div>
      </Block>

      <Block
        title="Scan now"
        description="Scans run on launch and when a folder changes. Run one by hand after moving things around."
      >
        <div className="flex flex-wrap items-center gap-4">
          <Button
            className="h-8 text-label"
            onClick={() => void handleScan()}
            disabled={scanning || settings.scanPaths.length === 0}
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            {scanning ? "Scanning…" : "Scan now"}
          </Button>
          {scanStats.events > 0 ? (
            <span className="atr-meta tabular-nums">
              {scanStats.discovered} found · {scanStats.indexed} indexed
              {scanStats.errors > 0 ? ` · ${scanStats.errors} errors` : ""}
            </span>
          ) : null}
        </div>
        {scanStats.lastMessage ? (
          <p
            className={cn(
              "flex items-start gap-2 text-label",
              scanStats.done && scanStats.success === false
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {scanStats.done ? (
              scanStats.success ? (
                <CheckCircle2
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-live"
                  aria-hidden
                />
              ) : null
            ) : (
              <span
                aria-hidden
                className="mt-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-status-live"
              />
            )}
            <span className="min-w-0 break-all">{scanStats.lastMessage}</span>
          </p>
        ) : null}
      </Block>

      <div className="flex items-center gap-3 px-6 py-4">
        <Button
          variant="bordered"
          className="h-8 text-label"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          <Save className="h-3.5 w-3.5" aria-hidden />
          {saving ? "Saving…" : "Save settings"}
        </Button>
        {savedAt ? (
          <span className="atr-meta text-status-live">Saved</span>
        ) : null}
      </div>
    </div>
  );
}
