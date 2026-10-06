/**
 * Launcher service — installed editor / terminal detection + "open in X"
 * dispatch.
 *
 * Phase 3a contract (`contracts/ipc.v3.md` "Launcher namespace"):
 *   - `boot()` runs detection ONCE (probing `/Applications/<Name>.app` +
 *     `~/Applications/<Name>.app` + interactive-shell PATH probe via
 *     `/bin/zsh -ilc 'command -v <cli>'`). Result cached for the app
 *     lifetime.
 *   - `detect()` returns the cached `DetectLauncherResult`.
 *   - `openInEditor / openInTerminal` build URL schemes or spawn detached
 *     CLI children. All schemes funnel through `openExternalAllowlisted`.
 *   - `openInFinder` uses `shell.showItemInFolder`.
 *   - `openRemote` reads `git remote get-url origin` via simple-git,
 *     normalizes SSH -> HTTPS, dispatches through the allowlist.
 *   - `copyPath` uses Electron's clipboard module.
 *
 * Security:
 *   - NEVER pass user-controlled strings into a shell via string
 *     concatenation. Use `execFile` / `spawn` with argv arrays. The one
 *     exception is osascript bridge code, which receives a literal
 *     script via `-e` with defensively quoted path / command tokens.
 *   - All `openExternal` calls go through `openExternalAllowlisted` from
 *     `@main/security/allowlist`.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { clipboard, shell } from "electron";
import simpleGit from "simple-git";

import type {
  DetectedEditorZ as DetectedEditor,
  DetectedTerminalZ as DetectedTerminal,
} from "@shared/schemas";
import type {
  DetectLauncherResult,
  EditorId,
  LauncherResult,
  OpenInEditorPhase3Input,
  OpenInTerminalInput,
  OpenSlugInput,
  TerminalId,
} from "@shared/types";

import { getSqlite } from "@main/db/client";
import { markRepoOpened } from "@main/db/queries";
import { openExternalAllowlisted } from "@main/security/allowlist";
import { getSettings } from "@main/services/settings";

// ---------------------------------------------------------------------------
// Repo-path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve absolute path on disk for a repo slug. Mirrors the helper in
 * `@main/services/git.ts` - both modules do the same SQLite lookup. Kept
 * inline here so this service has no inbound coupling beyond `getSqlite`
 * + `getSettings`.
 */
function repoPathBySlug(slug: string): string | null {
  const sqlite = getSqlite();
  const row = sqlite
    .prepare("SELECT full_path FROM repos WHERE slug = ?")
    .get(slug) as { full_path: string } | undefined;
  return row?.full_path ?? null;
}

// ---------------------------------------------------------------------------
// Detection tables
// ---------------------------------------------------------------------------

interface EditorEntry {
  id: EditorId;
  name: string;
  /** Bundle names to probe in `/Applications` AND `~/Applications`. */
  appNames: ReadonlyArray<string>;
  /** URL scheme (without the `://`) - null when the editor only ships a CLI. */
  scheme: string | null;
  /** Name of the CLI binary to probe via the user's interactive shell. */
  cliName: string | null;
}

interface TerminalEntry {
  id: TerminalId;
  name: string;
  appNames: ReadonlyArray<string>;
  /** Some terminals ship a usable CLI we can fall back to. */
  cliName: string | null;
}

const EDITOR_TABLE: ReadonlyArray<EditorEntry> = [
  {
    id: "vscode",
    name: "Visual Studio Code",
    appNames: ["Visual Studio Code.app"],
    scheme: "vscode",
    cliName: "code",
  },
  {
    id: "cursor",
    name: "Cursor",
    appNames: ["Cursor.app"],
    scheme: "cursor",
    cliName: "cursor",
  },
  {
    id: "zed",
    name: "Zed",
    appNames: ["Zed.app"],
    scheme: "zed",
    cliName: "zed",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    appNames: ["Windsurf.app"],
    scheme: "windsurf",
    cliName: "windsurf",
  },
  {
    // Devin is a Windsurf fork and registers BOTH `devin:` and `windsurf:`.
    // It is listed separately so the UI names the app you actually have —
    // on a machine without Windsurf.app installed, the Windsurf entry was
    // silently launching Devin under the wrong label.
    id: "devin",
    name: "Devin",
    appNames: ["Devin.app"],
    scheme: "devin",
    cliName: "devin",
  },
  {
    id: "sublime",
    name: "Sublime Text",
    appNames: ["Sublime Text.app"],
    scheme: "subl",
    cliName: "subl",
  },
  {
    id: "xcode",
    name: "Xcode",
    appNames: ["Xcode.app"],
    scheme: null,
    cliName: "xed",
  },
  {
    id: "idea",
    name: "IntelliJ IDEA",
    appNames: ["IntelliJ IDEA.app", "IntelliJ IDEA CE.app"],
    scheme: "idea",
    cliName: "idea",
  },
  {
    id: "webstorm",
    name: "WebStorm",
    appNames: ["WebStorm.app"],
    scheme: "webstorm",
    cliName: "webstorm",
  },
  {
    id: "pycharm",
    name: "PyCharm",
    appNames: ["PyCharm.app", "PyCharm CE.app"],
    scheme: "pycharm",
    cliName: "pycharm",
  },
  {
    id: "rider",
    name: "Rider",
    appNames: ["Rider.app"],
    scheme: "rider",
    cliName: "rider",
  },
  {
    id: "goland",
    name: "GoLand",
    appNames: ["GoLand.app"],
    scheme: "goland",
    cliName: "goland",
  },
  {
    id: "clion",
    name: "CLion",
    appNames: ["CLion.app"],
    scheme: "clion",
    cliName: "clion",
  },
  {
    id: "rubymine",
    name: "RubyMine",
    appNames: ["RubyMine.app"],
    scheme: "rubymine",
    cliName: "mine",
  },
];

const TERMINAL_TABLE: ReadonlyArray<TerminalEntry> = [
  {
    id: "terminal",
    name: "Terminal",
    appNames: ["Terminal.app"],
    cliName: null,
  },
  {
    id: "iterm2",
    name: "iTerm",
    appNames: ["iTerm.app"],
    cliName: null,
  },
  {
    id: "warp",
    name: "Warp",
    appNames: ["Warp.app"],
    cliName: null,
  },
  {
    id: "ghostty",
    name: "Ghostty",
    appNames: ["Ghostty.app"],
    cliName: "ghostty",
  },
  {
    id: "alacritty",
    name: "Alacritty",
    appNames: ["Alacritty.app"],
    cliName: "alacritty",
  },
  {
    id: "kitty",
    name: "kitty",
    appNames: ["kitty.app"],
    cliName: "kitty",
  },
  {
    id: "hyper",
    name: "Hyper",
    appNames: ["Hyper.app"],
    cliName: null,
  },
];

// Terminal.app lives in /System/Applications on modern macOS.
const SYSTEM_APPLICATIONS = "/System/Applications";

// ---------------------------------------------------------------------------
// Filesystem + CLI probes
// ---------------------------------------------------------------------------

function applicationsDirs(): ReadonlyArray<string> {
  return [
    "/Applications",
    path.join(os.homedir(), "Applications"),
    SYSTEM_APPLICATIONS,
  ];
}

function findAppPath(appNames: ReadonlyArray<string>): string | null {
  for (const dir of applicationsDirs()) {
    for (const name of appNames) {
      const full = path.join(dir, name);
      try {
        if (fs.existsSync(full)) return full;
      } catch {
        // ignore - permission errors should not crash detection
      }
    }
  }
  return null;
}

/**
 * Run `/bin/zsh -ilc "command -v <cliName>"` to probe the user's
 * interactive-login PATH. Returns the absolute path string when found,
 * null otherwise.
 *
 * `cliName` comes from a hardcoded enum (no quotes / shell metachars).
 * The script template is constant; cliName is interpolated only at this
 * single, fully-controlled site. We still pass the script via `-c` with
 * `/bin/zsh` and `spawn` (argv array, not a single shell string) so
 * Node never invokes its own shell here.
 */
function probeCliPath(cliName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const script = `command -v ${cliName}`;
    const child = spawn("/bin/zsh", ["-ilc", script], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });

    let stdout = "";
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), 1500);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const trimmed = stdout.trim().split("\n")[0]?.trim() ?? "";
      if (!trimmed) {
        finish(null);
        return;
      }
      try {
        if (fs.existsSync(trimmed)) {
          finish(trimmed);
          return;
        }
      } catch {
        // fall through
      }
      finish(null);
    });
  });
}

// ---------------------------------------------------------------------------
// LauncherService
// ---------------------------------------------------------------------------

class LauncherService {
  private cache: DetectLauncherResult | null = null;
  private booted = false;

  /**
   * Run editor + terminal detection. Idempotent - repeat calls are
   * no-ops after the first successful detection. Detection must
   * complete in well under 500ms on a typical machine; CLI probes run
   * in parallel.
   */
  async boot(): Promise<void> {
    if (this.booted) return;
    this.booted = true;
    this.cache = await this.runDetection();
  }

  /** Returns the cached detection result. */
  detect(): DetectLauncherResult {
    if (!this.cache) {
      // Defensive fallback: boot() should have populated the cache.
      return {
        editors: EDITOR_TABLE.map((e) => ({
          id: e.id,
          name: e.name,
          available: false,
          scheme: e.scheme,
          appPath: null,
          cliPath: null,
        })),
        terminals: TERMINAL_TABLE.map((t) => ({
          id: t.id,
          name: t.name,
          available: false,
          appPath: null,
        })),
        defaults: { editor: null, terminal: null },
      };
    }
    return this.cache;
  }

  private async runDetection(): Promise<DetectLauncherResult> {
    const editorProbes = EDITOR_TABLE.map(async (entry) => {
      const appPath = findAppPath(entry.appNames);
      const cliPath = entry.cliName ? await probeCliPath(entry.cliName) : null;
      const detected: DetectedEditor = {
        id: entry.id,
        name: entry.name,
        available: appPath !== null || cliPath !== null,
        scheme: entry.scheme,
        appPath,
        cliPath,
      };
      return detected;
    });

    const terminalProbes = TERMINAL_TABLE.map(async (entry) => {
      const appPath = findAppPath(entry.appNames);
      // The DetectedTerminal shape doesn't carry cliPath, but a CLI
      // presence still flips `available` to true (Alacritty / Kitty
      // sometimes install without a .app bundle).
      const cliPath = entry.cliName ? await probeCliPath(entry.cliName) : null;
      const detected: DetectedTerminal = {
        id: entry.id,
        name: entry.name,
        available: appPath !== null || cliPath !== null,
        appPath,
      };
      return detected;
    });

    const [editors, terminals] = await Promise.all([
      Promise.all(editorProbes),
      Promise.all(terminalProbes),
    ]);

    return {
      editors,
      terminals,
      defaults: this.resolveDefaults(editors, terminals),
    };
  }

  /**
   * Resolve user-preferred defaults. Reads `Settings.defaultEditor` — when
   * the persisted choice names an editor that is actually installed we
   * honour it, whatever it is (every id in `EDITOR_TABLE` is fair game now,
   * not just `vscode` / `cursor`). An uninstalled or unset preference falls
   * back to the first available editor in table order.
   *
   * `Settings.defaultTerminal` is read the same way; it resolves to the
   * first available terminal when absent.
   */
  private resolveDefaults(
    editors: DetectedEditor[],
    terminals: DetectedTerminal[],
  ): DetectLauncherResult["defaults"] {
    const settings = getSettings();

    let editor: EditorId | null = null;
    const settingsEditor = settings.defaultEditor;
    if (
      settingsEditor !== "none" &&
      isEditorId(settingsEditor) &&
      editors.find((e) => e.id === settingsEditor && e.available)
    ) {
      editor = settingsEditor;
    }
    if (!editor) {
      editor = editors.find((e) => e.available)?.id ?? null;
    }

    let terminal: TerminalId | null = null;
    const settingsTerminal = settings.defaultTerminal;
    if (
      typeof settingsTerminal === "string" &&
      isTerminalId(settingsTerminal) &&
      terminals.find((t) => t.id === settingsTerminal && t.available)
    ) {
      terminal = settingsTerminal;
    }
    if (!terminal) {
      terminal = terminals.find((t) => t.available)?.id ?? null;
    }

    return { editor, terminal };
  }

  /**
   * ATR-030: every successful open stamps `repos.last_opened_at` so
   * "recently opened" (tray, `sort:lastOpened`) reflects reality, whichever
   * surface drove the open (card buttons, Cmd-K, native menu, tray). A stamp
   * failure must never turn a successful open into an error.
   */
  private async stampIfOk(
    slug: string,
    open: Promise<LauncherResult>,
  ): Promise<LauncherResult> {
    const result = await open;
    if (result.ok) {
      try {
        await markRepoOpened(slug);
      } catch (err) {
        console.error("[launcher] failed to stamp last_opened_at", err);
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // openInEditor
  // -------------------------------------------------------------------------

  async openInEditor(input: OpenInEditorPhase3Input): Promise<LauncherResult> {
    return this.stampIfOk(input.slug, this.openInEditorImpl(input));
  }

  private async openInEditorImpl(
    input: OpenInEditorPhase3Input,
  ): Promise<LauncherResult> {
    const repoPath = repoPathBySlug(input.slug);
    if (!repoPath) {
      return { ok: false, reason: "repo not found" };
    }

    const detection = this.detect();
    const editorId = this.resolveEditorChoice(input.editorId, detection);
    if (!editorId) {
      return { ok: false, reason: "no editor installed" };
    }

    const entry = EDITOR_TABLE.find((e) => e.id === editorId);
    const detected = detection.editors.find((e) => e.id === editorId);
    if (!entry || !detected) {
      return { ok: false, reason: "editor unknown" };
    }

    // 1. URL-scheme dispatch when supported.
    if (entry.scheme) {
      const url = buildEditorUrl(entry.scheme, repoPath);
      if (url) {
        const launch = await openExternalAllowlisted(url);
        if (launch.ok) return { ok: true };
        // Fall through to CLI fallback if the allowlist rejected or
        // shell.openExternal failed.
      }
    }

    // 2. Xcode: scheme=null. Use `open -a Xcode <path>`.
    if (entry.id === "xcode") {
      try {
        await spawnDetached("open", ["-a", "Xcode", repoPath]);
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: errToReason(err) };
      }
    }

    // 3. CLI fallback for everything else.
    if (detected.cliPath) {
      try {
        await spawnDetached(detected.cliPath, [repoPath]);
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: errToReason(err) };
      }
    }

    return { ok: false, reason: "editor dispatch failed" };
  }

  private resolveEditorChoice(
    explicit: EditorId | undefined,
    detection: DetectLauncherResult,
  ): EditorId | null {
    if (explicit) {
      const candidate = detection.editors.find((e) => e.id === explicit);
      if (candidate?.available) return explicit;
      // Caller asked for an editor that isn't installed - fall through.
    }
    if (detection.defaults.editor) {
      const fallback = detection.defaults.editor;
      const candidate = detection.editors.find(
        (e) => e.id === fallback && e.available,
      );
      if (candidate) return candidate.id;
    }
    const first = detection.editors.find((e) => e.available);
    return first?.id ?? null;
  }

  // -------------------------------------------------------------------------
  // openInTerminal
  // -------------------------------------------------------------------------

  async openInTerminal(input: OpenInTerminalInput): Promise<LauncherResult> {
    return this.stampIfOk(input.slug, this.openInTerminalImpl(input));
  }

  private async openInTerminalImpl(
    input: OpenInTerminalInput,
  ): Promise<LauncherResult> {
    const repoPath = repoPathBySlug(input.slug);
    if (!repoPath) {
      return { ok: false, reason: "repo not found" };
    }

    const detection = this.detect();
    const terminalId = this.resolveTerminalChoice(input.terminalId, detection);
    if (!terminalId) {
      return { ok: false, reason: "no terminal installed" };
    }

    try {
      switch (terminalId) {
        case "terminal":
          return await openInAppleTerminal(repoPath, input.command);
        case "iterm2":
          return await openInIterm2(repoPath, input.command);
        case "warp":
          return await openInWarp(repoPath, input.command);
        case "ghostty":
          // Ghostty has no documented inject-on-open API in 2026 -
          // `command` is best-effort and currently ignored.
          await spawnDetached("open", ["-a", "Ghostty", repoPath]);
          return { ok: true };
        case "alacritty": {
          const detected = detection.terminals.find(
            (t) => t.id === "alacritty",
          );
          const bin = resolveAlacrittyBinary(detected?.appPath ?? null);
          await spawnDetached(bin, ["--working-directory", repoPath]);
          return { ok: true };
        }
        case "kitty": {
          const detected = detection.terminals.find((t) => t.id === "kitty");
          const bin = resolveKittyBinary(detected?.appPath ?? null);
          await spawnDetached(bin, ["--directory", repoPath]);
          return { ok: true };
        }
        case "hyper":
          // Hyper has no inject-on-open API; `command` is ignored.
          await spawnDetached("open", ["-a", "Hyper", repoPath]);
          return { ok: true };
        default: {
          const _exhaustive: never = terminalId;
          return {
            ok: false,
            reason: `unknown terminal: ${String(_exhaustive)}`,
          };
        }
      }
    } catch (err) {
      return { ok: false, reason: errToReason(err) };
    }
  }

  private resolveTerminalChoice(
    explicit: TerminalId | undefined,
    detection: DetectLauncherResult,
  ): TerminalId | null {
    if (explicit) {
      const candidate = detection.terminals.find((t) => t.id === explicit);
      if (candidate?.available) return explicit;
    }
    if (detection.defaults.terminal) {
      const fallback = detection.defaults.terminal;
      const candidate = detection.terminals.find(
        (t) => t.id === fallback && t.available,
      );
      if (candidate) return candidate.id;
    }
    const first = detection.terminals.find((t) => t.available);
    return first?.id ?? null;
  }

  // -------------------------------------------------------------------------
  // openInFinder
  // -------------------------------------------------------------------------

  async openInFinder(input: OpenSlugInput): Promise<LauncherResult> {
    return this.stampIfOk(input.slug, this.openInFinderImpl(input));
  }

  private async openInFinderImpl(
    input: OpenSlugInput,
  ): Promise<LauncherResult> {
    const repoPath = repoPathBySlug(input.slug);
    if (!repoPath) {
      return { ok: false, reason: "repo not found" };
    }
    shell.showItemInFolder(repoPath);
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // openRemote
  // -------------------------------------------------------------------------

  async openRemote(input: OpenSlugInput): Promise<LauncherResult> {
    return this.stampIfOk(input.slug, this.openRemoteImpl(input));
  }

  private async openRemoteImpl(input: OpenSlugInput): Promise<LauncherResult> {
    const repoPath = repoPathBySlug(input.slug);
    if (!repoPath) {
      return { ok: false, reason: "repo not found" };
    }
    let originUrl: string;
    try {
      const git = simpleGit({ baseDir: repoPath });
      const raw = await git.remote(["get-url", "origin"]);
      const trimmed = typeof raw === "string" ? raw.trim() : "";
      if (!trimmed) {
        return { ok: false, reason: "no origin remote" };
      }
      originUrl = trimmed;
    } catch {
      return { ok: false, reason: "no origin remote" };
    }

    const normalized = normalizeRemoteUrl(originUrl);
    if (!normalized) {
      return { ok: false, reason: "unsupported remote url" };
    }

    const launch = await openExternalAllowlisted(normalized);
    if (!launch.ok) {
      return { ok: false, reason: launch.reason ?? "open failed" };
    }
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // copyPath
  // -------------------------------------------------------------------------

  async copyPath(input: OpenSlugInput): Promise<LauncherResult> {
    const repoPath = repoPathBySlug(input.slug);
    if (!repoPath) {
      return { ok: false, reason: "repo not found" };
    }
    clipboard.writeText(repoPath);
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EDITOR_ID_SET = new Set<string>(EDITOR_TABLE.map((e) => e.id));
const TERMINAL_ID_SET = new Set<string>(TERMINAL_TABLE.map((t) => t.id));

function isEditorId(s: string): s is EditorId {
  return EDITOR_ID_SET.has(s);
}

function isTerminalId(s: string): s is TerminalId {
  return TERMINAL_ID_SET.has(s);
}

/**
 * The URL scheme an editor id registers, or `null` when that editor has no
 * scheme (Xcode) or the id is unknown.
 *
 * Exported so callers that need to build a URI themselves — `git:openInEditor`
 * does — share one mapping with the dispatcher instead of growing a second
 * editor switch that drifts out of sync the next time an editor is added.
 */
export function editorScheme(id: EditorId): string | null {
  return EDITOR_TABLE.find((e) => e.id === id)?.scheme ?? null;
}

/**
 * Build the editor URL for a given scheme. We intentionally use plain
 * `encodeURI` for the path segment (which leaves `/` intact) and
 * `encodeURIComponent` for query values, so a repo path containing
 * `?` or `#` cannot leak into the URL's query/fragment.
 */
export function buildEditorUrl(
  scheme: string,
  absolutePath: string,
): string | null {
  const encodedPath = encodeURI(absolutePath);
  const encodedFileParam = encodeURIComponent(absolutePath);
  const ensureLeadingSlash = (s: string): string =>
    s.startsWith("/") ? s : `/${s}`;
  switch (scheme) {
    case "vscode":
    case "cursor":
    case "zed":
    case "windsurf":
    case "devin":
      return `${scheme}://file${ensureLeadingSlash(encodedPath)}`;
    case "subl":
      return `subl://open?url=file://${encodedFileParam}`;
    case "idea":
    case "webstorm":
    case "pycharm":
    case "rider":
    case "goland":
    case "clion":
    case "rubymine":
      return `${scheme}://open?file=${encodedFileParam}`;
    default:
      return null;
  }
}

/**
 * Normalize a git remote URL into an HTTPS form suitable for
 * `shell.openExternal`. Returns null if the URL isn't recognizable as
 * an SCP-style SSH URL, an `ssh://` URL, or an http(s) URL.
 *
 * Examples:
 *   git@github.com:owner/repo.git  -> https://github.com/owner/repo
 *   git@gitlab.com:owner/repo.git  -> https://gitlab.com/owner/repo
 *   https://github.com/o/r.git     -> https://github.com/o/r
 *   ssh://git@github.com/o/r.git   -> https://github.com/o/r
 */
export function normalizeRemoteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const stripDotGit = (s: string): string =>
    s.endsWith(".git") ? s.slice(0, -4) : s;

  // SCP-style: git@host:owner/repo[.git]
  const scpMatch = trimmed.match(/^([^@\s]+)@([^:\s]+):(.+)$/);
  if (scpMatch) {
    const host = scpMatch[2];
    const tail = stripDotGit(scpMatch[3]).replace(/^\/+/, "");
    return `https://${host}/${tail}`;
  }

  // ssh:// style
  if (trimmed.startsWith("ssh://")) {
    try {
      const u = new URL(trimmed);
      const host = u.hostname;
      const tail = stripDotGit(u.pathname.replace(/^\/+/, ""));
      if (host && tail) return `https://${host}/${tail}`;
    } catch {
      return null;
    }
  }

  // http / https
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const u = new URL(trimmed);
      const host = u.hostname;
      const tail = stripDotGit(u.pathname.replace(/^\/+/, ""));
      if (host && tail) return `https://${host}/${tail}`;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Defensively quote a string for embedding inside an AppleScript
 * double-quoted string literal. Escapes `\` and `"`.
 */
function escapeForAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function openInAppleTerminal(
  repoPath: string,
  command: string | undefined,
): Promise<LauncherResult> {
  if (command && command.length > 0) {
    const script = `tell application "Terminal" to do script "cd \\"${escapeForAppleScript(repoPath)}\\" && ${escapeForAppleScript(command)}"`;
    await spawnDetached("osascript", ["-e", script]);
    await spawnDetached("osascript", [
      "-e",
      `tell application "Terminal" to activate`,
    ]);
    return { ok: true };
  }
  await spawnDetached("open", ["-a", "Terminal", repoPath]);
  return { ok: true };
}

async function openInIterm2(
  repoPath: string,
  command: string | undefined,
): Promise<LauncherResult> {
  const cdLine = `write text "cd \\"${escapeForAppleScript(repoPath)}\\""`;
  const cdAndRunLine =
    command && command.length > 0
      ? `write text "cd \\"${escapeForAppleScript(repoPath)}\\" && ${escapeForAppleScript(command)}"`
      : cdLine;
  const script = [
    `tell application "iTerm"`,
    `  activate`,
    `  if (count of windows) = 0 then`,
    `    create window with default profile`,
    `  end if`,
    `  tell current session of current window`,
    `    ${cdAndRunLine}`,
    `  end tell`,
    `end tell`,
  ].join("\n");
  await spawnDetached("osascript", ["-e", script]);
  return { ok: true };
}

async function openInWarp(
  repoPath: string,
  command: string | undefined,
): Promise<LauncherResult> {
  // warp://action/open_path?path=<encoded>[&command=<encoded>]
  // The `command` param is undocumented but harmless when ignored.
  const params = new URLSearchParams();
  params.set("path", repoPath);
  if (command && command.length > 0) {
    params.set("command", command);
  }
  const url = `warp://action/open_path?${params.toString()}`;
  const launch = await openExternalAllowlisted(url);
  if (!launch.ok) {
    return { ok: false, reason: launch.reason ?? "warp open failed" };
  }
  return { ok: true };
}

function resolveAlacrittyBinary(appPath: string | null): string {
  if (appPath) {
    return path.join(appPath, "Contents", "MacOS", "alacritty");
  }
  return "/Applications/Alacritty.app/Contents/MacOS/alacritty";
}

function resolveKittyBinary(appPath: string | null): string {
  if (appPath) {
    return path.join(appPath, "Contents", "MacOS", "kitty");
  }
  return "/Applications/kitty.app/Contents/MacOS/kitty";
}

/**
 * Spawn a detached child with stdio ignored and unref it so the Electron
 * main process won't keep the child alive (and the child won't block
 * our exit). `args` MUST be a string[] - never a single shell string.
 */
function spawnDetached(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(bin, args, {
        detached: true,
        stdio: "ignore",
      });
      let settled = false;
      child.once("error", (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
      setImmediate(() => {
        if (settled) return;
        settled = true;
        try {
          child.unref();
        } catch {
          // ignore
        }
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

function errToReason(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const launcherService: LauncherService = new LauncherService();

// Test-only helpers (used by unit specs).
export {
  EDITOR_TABLE as __launcher_editor_table,
  TERMINAL_TABLE as __launcher_terminal_table,
};
