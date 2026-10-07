# IPC Contract v3 — Phase 3a (process detection + launcher)

This addendum extends the frozen `ipc.v1.md` (Phase 0 + 1 + 2) with the
Phase 3a namespaces from `NEW-PLAN.md §5.2-5.3`:

- `process:*` — lsof-based listening-port poller, per-repo binding,
  graceful kill flow, push-event snapshot stream.
- `launcher:*` — installed editor / terminal detection, "open in X"
  dispatch via URL schemes or CLI fallback.

The v1 conventions (frame-origin check on every handler, Zod-validated
input/output, `IPC.<NAMESPACE>.<ACTION>` constants, no inline channel
strings) apply unchanged. Allowlisted external opens still funnel
through `openExternalAllowlisted` from `src/main/security/allowlist.ts`.

## File map (Phase 3a additions)

| Concern                | File                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Channel constants      | `src/shared/ipc.ts` (`IPC.PROCESS`, `IPC.LAUNCHER`)                                |
| Zod schemas            | `src/shared/schemas.ts` (Phase 3a section, line ~577+)                             |
| Shared types           | `src/shared/types.ts` (Phase 3a section)                                           |
| Main: process service  | `src/main/services/process.ts`                                                     |
| Main: launcher service | `src/main/services/launcher.ts`                                                    |
| Main: process IPC      | `src/main/ipc/process.ts`                                                          |
| Main: launcher IPC     | `src/main/ipc/launcher.ts`                                                         |
| Preload: bridge        | `src/preload/api.ts` (`process`, `launcher` namespaces)                            |
| Renderer hooks         | `src/renderer/hooks/use-processes.ts`, `use-launcher.ts`                           |
| Renderer UI            | `src/renderer/components/process/*`, `launcher/*`                                  |
| Renderer route         | `src/renderer/routes/processes.tsx`                                                |
| Tests                  | `tests/unit/process.test.ts`, `launcher.test.ts`, `tests/e2e/process-flow.spec.ts` |

## Process namespace

### `process:list`

- **Direction:** invoke (renderer → main)
- **Input schema:** `ListProcessesInputSchema` (empty object)
- **Output schema:** `ListProcessesResultSchema`
- **Behavior:** returns the current in-memory snapshot from
  `ProcessService`. If no sweep has run yet, triggers one and waits for
  it — three subprocess rounds (~0.5s typical on a developer Mac, each
  round carrying its own timeout); a sweep that fails still resolves
  with the last good snapshot and logs.

### `process:listForRepo`

- **Input:** `ListProcessesForRepoInputSchema` — `{ slug: string }`
- **Output:** `ListProcessesResultSchema` (snapshot filtered to the
  repo)
- **Behavior:** filters `process:list`'s snapshot to rows whose
  `repoSlug` matches. Returns empty list (NOT 404) when no matches —
  "no dev server running for this repo" is the common case.

### `process:refresh` (added after the Phase 3a freeze)

- **Input:** `ListProcessesInputSchema` (empty object)
- **Output:** `ListProcessesResultSchema`
- **Behavior:** sweeps the host now instead of waiting for the poll
  interval, then resolves with the snapshot that sweep produced. The
  process panel calls it when it mounts and when Refresh is pressed,
  because reading the cached snapshot cannot show a server that started
  after the last tick — up to 15s away while the app is blurred. A
  sweep already in flight is joined, not doubled.

### `process:kill`

- **Input:** `KillProcessInputSchema` — `{ pid: number, escalateMs?: number }`
- **Output:** `KillProcessResultSchema`
- **Behavior:**
  1. SIGINT
  2. wait `escalateMs` (default 3000ms), poll listening status
  3. if still listening → SIGTERM
  4. wait `escalateMs` again
  5. if still listening → SIGKILL
  6. resolve when PID is gone OR the final SIGKILL was sent
- **Error envelope:** if PID isn't ours / doesn't exist, return
  `{ pid, finalSignal: 'noop', stopped: true, durationMs: <small> }`
  with `ok: true`. Throw only when escalating fails for an unexpected
  reason (EACCES, etc.).

### `process:on:update` (event stream — main → renderer)

- **Direction:** push (main → renderer via `webContents.send`)
- **Payload schema:** `ProcessUpdateEventSchema` (full snapshot, not a diff)
- **Cadence:** emitted only when the snapshot changes (PID set added /
  removed / repoSlug rebinding). The poller itself ticks at:
  - 2-3s when the BrowserWindow that subscribed is focused
  - 15s when blurred but at least one renderer is subscribed
  - paused when there are zero subscribers

## Launcher namespace

### `launcher:detect`

- **Input:** `DetectLauncherInputSchema` (empty)
- **Output:** `DetectLauncherResultSchema`
- **Behavior:** scans `/Applications/*.app` for known editor + terminal
  bundle identifiers, then probes the PATH for CLI fallbacks (`code`,
  `cursor`, `zed`, etc.). Detection runs ONCE per app launch and is
  cached in `LauncherService`. Restart to re-detect (Phase 5 polish:
  add a manual "refresh detections" affordance).
- **Defaults:** reads `Settings.defaultEditor` / `Settings.defaultTerminal`
  (Phase 3a adds these keys — Settings schema is extended additively).

### `launcher:openInEditor`

- **Input:** `OpenInEditorPhase3InputSchema` — `{ slug: string, editorId?: EditorId }`
- **Output:** `LauncherResultSchema`
- **Behavior:**
  1. Resolve repo path by slug (existing `repoPathBySlug` helper).
  2. Resolve editor: explicit `editorId` if available; else
     `defaults.editor` from Settings; else first installed editor in
     enum order.
  3. Build URL scheme (`vscode://file/<absolute path>`, etc.) or fall
     back to CLI binary if scheme unsupported.
  4. Dispatch via `openExternalAllowlisted` for schemes, or
     a spawned detached child for CLI fallback (stdio ignored).
- **Result:** `{ ok: true }` on dispatch; `{ ok: false, reason }` when
  no editor is available.

### `launcher:openInTerminal`

- **Input:** `OpenInTerminalInputSchema` — `{ slug, terminalId?, command? }`
- **Output:** `LauncherResultSchema`
- **Behavior:** dispatches to the resolved terminal's "open at path"
  affordance. iTerm2 uses an osascript bridge for `cd <repoPath>`
  (and runs `command` if provided). Terminal.app: open via macOS LS
  - osascript for cd. Warp: `warp://action/open_path?path=<repo>`.
    Ghostty/Alacritty/Kitty: CLI invocations with `--working-directory`
    or equivalent.
- **`command` safety:** trusted-caller input. The launcher does
  string-quote `repoPath` and `command` for the bridge but does NOT
  validate semantics. Renderer code that passes `command` is
  responsible for sanitization.

### `launcher:openInFinder`

- **Input:** `OpenSlugInputSchema` — `{ slug }`
- **Behavior:** `shell.showItemInFolder(repoPath)`. Always returns
  `{ ok: true }` — Electron's API has no failure signal.

### `launcher:openRemote`

- **Input:** `OpenSlugInputSchema`
- **Behavior:** read `git remote get-url origin` via `simpleGit`.
  Normalize SSH → HTTPS form. Dispatch via `openExternalAllowlisted`
  (existing http(s) allowlist).
- **Result:** `{ ok: false, reason: "no origin remote" }` when the
  repo has no `origin`.

### `launcher:copyPath`

- **Input:** `OpenSlugInputSchema`
- **Behavior:** `clipboard.writeText(repoPath)`. Always `{ ok: true }`.

## Settings additions (Phase 3a)

`Settings` schema gains two optional keys (legacy data is forward-
compatible — both default to `null`):

```ts
defaultEditor: EditorId | null;
defaultTerminal: TerminalId | null;
```

These are read by the renderer at boot to seed the launcher dropdowns
and by `LauncherService` to resolve "no editorId provided" cases. The
Settings IPC channels (`settings:get` / `settings:update`) need no
schema-version bump — Zod accepts the extra keys via optional fields.

## Channel ↔ schema ↔ constant cross-reference

| Channel string            | Constant                        | Input schema                      | Output schema                      |
| ------------------------- | ------------------------------- | --------------------------------- | ---------------------------------- |
| `process:list`            | `IPC.PROCESS.LIST`              | `ListProcessesInputSchema`        | `ListProcessesResultSchema`        |
| `process:listForRepo`     | `IPC.PROCESS.LIST_FOR_REPO`     | `ListProcessesForRepoInputSchema` | `ListProcessesForRepoResultSchema` |
| `process:refresh`         | `IPC.PROCESS.REFRESH`           | `ListProcessesInputSchema`        | `ListProcessesResultSchema`        |
| `process:kill`            | `IPC.PROCESS.KILL`              | `KillProcessInputSchema`          | `KillProcessResultSchema`          |
| `process:on:update`       | `IPC.PROCESS.ON_UPDATE`         | —                                 | `ProcessUpdateEventSchema`         |
| `launcher:detect`         | `IPC.LAUNCHER.DETECT`           | `DetectLauncherInputSchema`       | `DetectLauncherResultSchema`       |
| `launcher:openInEditor`   | `IPC.LAUNCHER.OPEN_IN_EDITOR`   | `OpenInEditorPhase3InputSchema`   | `LauncherResultSchema`             |
| `launcher:openInTerminal` | `IPC.LAUNCHER.OPEN_IN_TERMINAL` | `OpenInTerminalInputSchema`       | `LauncherResultSchema`             |
| `launcher:openInFinder`   | `IPC.LAUNCHER.OPEN_IN_FINDER`   | `OpenSlugInputSchema`             | `LauncherResultSchema`             |
| `launcher:openRemote`     | `IPC.LAUNCHER.OPEN_REMOTE`      | `OpenSlugInputSchema`             | `LauncherResultSchema`             |
| `launcher:copyPath`       | `IPC.LAUNCHER.COPY_PATH`        | `OpenSlugInputSchema`             | `LauncherResultSchema`             |

## Domain rules

- **lsof poller life-cycle:** `ProcessService.boot()` is idempotent.
  `start()` is called from the first subscriber (renderer mounts
  `useProcesses`); `pause()` when subscriber count drops to 0.
  `app.on('browser-window-blur')` switches to 15s cadence;
  `'browser-window-focus'` returns to fast cadence.
- **Repo binding:** walk the catalog repo paths once at boot into a
  prefix trie keyed by absolute path. For each PID, look up `cwd`
  via `lsof -p <pid> -F n -d cwd`. If trie hit → bind. If not, walk
  parent chain via `ppid` (cap at 10 hops) — handles `pnpm dev` →
  node subprocesses whose own cwd is `/private/tmp` or similar.
- **Snapshot equality:** the poller compares the new snapshot against
  the cached one by `(pid, port, repoSlug)` triples. Same triples →
  no event emitted. Any difference → emit + cache.
- **Editor detection table:** stable list of bundle id → app path
  mapping. Each entry has scheme + cli probe order. Detection mode
  is `or` — present in `/Applications` OR on PATH counts as
  `available`.
- **CLI fallback PATH:** Electron's spawned shells don't inherit the
  user's interactive shell PATH. `LauncherService` runs an interactive
  shell probe (`/bin/zsh -ilc 'command -v code'`) ONCE per detection
  cycle and caches the absolute path. Subsequent invocations use the
  absolute path directly. NEVER pass user-controlled strings into
  the shell probe argv.

## Definition of done (Phase 3a)

- [ ] `pnpm typecheck` clean (no new errors)
- [ ] `pnpm test` — new unit specs pass for: lsof parser, cwd-to-repo
      trie, kill state machine, launcher URL builders, launcher
      detection (mocked /Applications scan).
- [ ] `pnpm test:e2e:electron` — `process-flow.spec.ts` passes:
      launches Electron, spawns a known listening process (a small
      Node http server in a temp dir), confirms it surfaces in the
      Processes view, kill button stops it.
- [ ] `qa-report.json` updated with Phase 3a gate decision and prior
      gate chain preserved.

## Out of scope (Phase 3a)

- Linux / Windows fallbacks (`ss -tlnpH`, `Get-NetTCPConnection`) —
  deferred to Phase 6 cross-platform.
- Launch Configurations (the named multi-step "open these 3 apps in
  this layout" macro from §5.3 prior art) — Phase 5 polish.
- Per-repo terminal override — Settings stores a global default in
  3a; per-repo override in Phase 3b alongside the Claude tab.
