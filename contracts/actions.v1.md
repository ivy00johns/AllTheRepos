# Actions Contract v1 — Phase 2 (frozen)

This document is the authoritative spec for the **Action** type — the
shared descriptor that powers three Phase 2 surfaces:

1. The **native Application menu** (built by main from the registry the
   renderer pushes via `app:registerActions`).
2. The **in-app Cmd-K command palette** (rendered by the renderer with
   `cmdk` over the same registry).
3. The **global Spotlight window** (Cmd-Shift-Space, rendered by the
   renderer with `cmdk` + `uFuzzy` over the same registry plus repos).

A single registry feeds all three. The contract here covers the data
shape, the scope semantics, the shortcut format, the Phase 2 baseline
action list, and the runtime contract between the renderer's
`dispatchAction(id)` function and the main process's menu emitter.

The TypeScript shape lives in `src/shared/types.ts` as `Action` /
`ActionScope` / `NotificationAction`; the Zod schema lives in
`src/shared/schemas.ts` as `ActionSchema` / `ActionIdSchema` /
`ActionScopeSchema` / `AcceleratorSchema`. Consumers MUST import the
TypeScript type and the schema from those modules.

## Action shape

```ts
type ActionScope =
  | "global" // always available (menu + every palette context)
  | "catalog" // catalog (repo list) view
  | "repo-detail" // repo detail view
  | "settings" // settings view
  | "spotlight"; // only inside the global spotlight window

interface Action {
  id: string; // kebab-case, dot-namespaced (matches ActionIdSchema)
  label: string; // human label (menu + palette)
  scope: ActionScope; // when the action applies
  shortcut?: string; // Electron Accelerator string (e.g. "CmdOrCtrl+K")
  icon?: string; // lucide icon name (palette UI only)
  hint?: string; // one-line description for palette
  group?: string; // cmdk group + menu submenu placement
  devOnly?: boolean; // only register in dev builds (default false)
}
```

The **handler is intentionally not part of the contract.** The renderer
owns a `Map<id, () => void>` keyed by `id` and calls it from either:

- (a) The in-app cmdk palette when the user selects an action row.
- (b) The `menu:on:command` push-event handler when main fires it after
  a native menu activation.

This keeps native menu serialization free of function references (only
`id` strings cross the IPC boundary) while still allowing menu items to
execute arbitrary renderer logic.

## ID grammar

`Action.id` MUST match `/^[a-z][a-z0-9.-]*$/` and be ≤ 64 chars.

Convention: `<namespace>.<verb-or-noun-verb>` — kebab-case within each
segment, dots separating segments. Examples:

- `catalog.refresh`
- `catalog.focus-search`
- `app.open-settings`
- `app.open-command-palette`
- `repo.copy-path`

Namespaces should mirror the IPC namespaces where the action's
ultimate side effect lives (e.g. `catalog.*` actions tend to invoke
`catalog:*` channels). This is convention, not a hard rule — `app.*`
in particular is used for window-level actions that don't correspond
to a single IPC channel.

## Scope semantics

Scope tells main (when building the menu) and the renderer (when
filtering the palette) **where the action is applicable**. There is
exactly one scope per action — no multi-scope entries.

| Scope         | Native menu treatment                         | Palette availability                        |
| ------------- | --------------------------------------------- | ------------------------------------------- |
| `global`      | Always present.                               | Always shown in cmdk.                       |
| `catalog`     | Always present; enabled only on catalog view. | Shown when current route ≈ `/`.             |
| `repo-detail` | Always present; enabled on repo-detail view.  | Shown when current route ≈ `/repos/[slug]`. |
| `settings`    | Always present; enabled on settings view.     | Shown when current route ≈ `/settings`.     |
| `spotlight`   | NOT placed in the native menu.                | Shown ONLY in the global spotlight window.  |

"Enabled only" means main builds the menu item with an `enabled`
callback that consults the current focused window's URL. The renderer
is the source of truth for "current route"; the simplest correct
implementation is for the renderer to send a `menu:set-context` event
on route changes (out of scope for this Phase 2 contract — main MAY
choose to enable everything Phase 2 and refine later, or it MAY hard-
code per-window enable rules; both satisfy v1).

`spotlight`-scoped actions exist for affordances that only make sense
inside the spotlight window itself, e.g. "Switch to action-search mode"
(`>` prefix, Raycast pattern). They MUST NOT appear in the native
Application menu and MUST NOT appear in the main-window in-app palette.

## Shortcut format

`Action.shortcut` is an **Electron Accelerator string** as documented at
<https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts>. Examples:

- `CmdOrCtrl+K`
- `CmdOrCtrl+Shift+Space`
- `CmdOrCtrl+Shift+C`
- `Alt+Enter`
- `/` (single printable key — yes, this is legal)

Conventions for Phase 2:

- Prefer `CmdOrCtrl+...` over hard-coded `Cmd+...` so the binding still
  reads ergonomically on the (currently out-of-scope) Linux/Windows
  build. macOS is the only Phase 2 target, but using `CmdOrCtrl` keeps
  the future open at zero cost.
- One shortcut per action. If you need a primary + secondary trigger,
  register two `Action`s with different ids that delegate to the same
  renderer handler.
- The renderer MAY accept human-friendly aliases (`Mod+K`) in its
  authoring layer but MUST translate them to Accelerator strings
  before sending to `app:registerActions`.

The Zod schema (`AcceleratorSchema`) only enforces a printable-ASCII
shape; main rejects unbindable shortcuts at registration time and
reports the count via `RegisterActionsResultSchema.skipped`.

## Registry handshake

The renderer is the source of truth for the action registry. Boot
sequence:

1. Renderer mounts and constructs its registry from the action modules
   it knows about (Phase 2 starts with the baseline list below).
2. Renderer calls `window.atr.app.registerActions({ actions })`. Before
   sending, it filters out `devOnly` actions through one rule,
   `isActionAvailable(action, packaged)`, where `packaged` is the run's own
   `window.atr.build.packaged` — see the amendment below. The same rule gates
   the in-app command palette, so the menu and the palette cannot disagree.
3. Main `.parse()`s the input through `RegisterActionsInputSchema`,
   then rebuilds the Application menu and re-binds accelerators
   wholesale.
4. Main returns `{ accepted, skipped }`. The renderer logs a dev
   warning if `skipped > 0`.

The handshake is **re-callable**: any later call replaces the
previously-registered registry wholesale. This lets the renderer
re-register on hot-reload or after a route change that wants different
scope wiring. Re-registration is cheap (a single full menu rebuild).

## Phase 2 baseline action list

Phase 2 implementers MUST ship at least these eight actions; they cover
menu structure, palette demonstration, and the global hotkey + spotlight
plumbing. Wave-2C MAY add more during palette polish.

| id                         | label                | scope         | shortcut                | group   | devOnly |
| -------------------------- | -------------------- | ------------- | ----------------------- | ------- | ------- |
| `catalog.refresh`          | Refresh Catalog      | `catalog`     | `CmdOrCtrl+R`           | Catalog | no      |
| `catalog.focus-search`     | Focus Search         | `catalog`     | `/`                     | Catalog | no      |
| `catalog.toggle-sidebar`   | Toggle Sidebar       | `catalog`     | `CmdOrCtrl+\\`          | Catalog | no      |
| `app.open-spotlight`       | Open Spotlight       | `global`      | `CmdOrCtrl+Shift+Space` | App     | no      |
| `app.open-command-palette` | Open Command Palette | `global`      | `CmdOrCtrl+K`           | App     | no      |
| `app.open-settings`        | Open Settings        | `global`      | `CmdOrCtrl+,`           | App     | no      |
| `app.toggle-devtools`      | Toggle DevTools      | `global`      | `CmdOrCtrl+Alt+I`       | App     | YES     |
| `repo.copy-path`           | Copy Repo Path       | `repo-detail` | `CmdOrCtrl+Shift+C`     | Repo    | no      |

Behavioural notes per action:

- **`catalog.refresh`** — invokes the same handler the catalog page
  uses for its "Refresh" button (re-fetch repo list). Does NOT trigger
  a full filesystem scan.
- **`catalog.focus-search`** — sets focus on the catalog search input.
  Bound to `/` to match GitHub / VS Code / Linear muscle memory.
- **`catalog.toggle-sidebar`** — toggles the groups sidebar visibility
  (state lives in the renderer; persisted to settings is Wave-2C's
  call, not required by this contract).
- **`app.open-spotlight`** — invokes `app:showSpotlight` over IPC. The
  global hotkey hits this same code path via main, so the in-app menu
  item and the global accelerator dispatch identical behaviour.
- **`app.open-command-palette`** — opens the in-app cmdk palette
  overlay in the current window. NOT the spotlight window.
- **`app.open-settings`** — navigates the main window to `/settings`.
- **`app.toggle-devtools`** — `devOnly: true`. The renderer MUST omit
  this action from the array passed to `app:registerActions` in a run that
  is packaged (see the amendment below). Main MUST NOT bind a
  default DevTools accelerator from its own side; the renderer-pushed
  registry is the only source.
- **`repo.copy-path`** — copies the absolute filesystem path of the
  current repo to the clipboard via `clipboard.writeText` (renderer
  side; the renderer reads `fullPath` from the cached `RepoDetail`).

### Amendment (2026-10-08) — what "dev-only" is decided by

The first version of this contract said "in production", and named
`import.meta.env.PROD` as the mechanism. That is a *build mode*, and it answers
the wrong question: `electron-vite build` produces a bundle that is unpackaged
(the E2E suite, `electron-vite preview`), so a dev-only action disappeared from
runs where the developer had no other way to reach it — while the palette,
which filtered nothing, offered it in a release that the native menu had already
stripped it from.

A `devOnly` action is offered when the run is **not packaged**. The renderer
learns that from `window.atr.build.packaged`: main states `app.isPackaged` once
per window as `webPreferences.additionalArguments`, and the preload parses it off
`process.argv` (see `src/shared/build-info.ts`), synchronously — the value has to
be there at first paint, because it decides whether an action is offered at all.
Absent reads as not packaged, which is what a harness without the flag is.
`ATR_FORCE_PACKAGED=1` overrides main's answer so the packaged branch is
exercised by the E2E suite rather than first seen by whoever installs the DMG.

Additional actions any Phase 2 implementer MAY add (not required by
this contract):

- `repo.open-in-finder` — `shell.showItemInFolder(fullPath)`.
- `repo.open-in-editor` — invokes `git:openInEditor`. The user-facing
  shortcut for this varies; defer to settings.
- `app.toggle-theme` — cycles the renderer's theme store.

## Validation responsibilities

| Side     | What it validates                                                                  |
| -------- | ---------------------------------------------------------------------------------- |
| Renderer | `ActionSchema.parse(action)` for each entry in its registry BEFORE sending IPC.    |
| Main     | `RegisterActionsInputSchema.parse(input)` on receipt (catches schema drift).       |
| Main     | Per-action: `globalShortcut.isRegistered(s)` and Accelerator parse via try/catch.  |
| Renderer | On `menu:on:command`: `MenuCommandPayloadSchema.parse(e)`; unknown ids → dev warn. |

## File map

| File                       | Owner            | Purpose                                                |
| -------------------------- | ---------------- | ------------------------------------------------------ |
| `src/shared/types.ts`      | contract-author  | `Action`, `ActionScope`, `NotificationAction`.         |
| `src/shared/schemas.ts`    | contract-author  | `ActionSchema`, `ActionIdSchema`, `ActionScopeSchema`, |
|                            |                  | `AcceleratorSchema`, `NotificationActionSchema`.       |
| `contracts/actions.v1.md`  | contract-author  | This document.                                         |
| `src/renderer/actions/...` | frontend-palette | Action registry, dispatch table, cmdk palette UI.      |
| `src/main/menu/...`        | backend-system   | `Menu.buildFromTemplate(...)` over the registry.       |

The right-hand `src/renderer/...` and `src/main/...` files are NOT
part of the contract-author deliverable — they're the consumers of
this contract, authored in Wave 2.
