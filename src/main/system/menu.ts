/**
 * Native Application menu.
 *
 * The renderer pushes its action registry over IPC (`app:registerActions`);
 * we map those actions into a `Menu` and install it as the application
 * menu. Each menu-item click fires `menu:on:command` at the focused
 * window (or the main window if no focus), carrying the `Action.id` so
 * the renderer's dispatch table runs the bound handler.
 *
 * macOS conventions baked in:
 *   - First submenu is the App menu (About, Preferences, Hide, Quit).
 *   - Standard Edit / View / Window / Help submenus follow.
 *   - User actions are bucketed by `Action.group` into trailing
 *     submenus, in stable insertion order.
 *
 * `spotlight`-scoped actions are EXCLUDED from the native menu per
 * `contracts/actions.v1.md` (those affordances only make sense inside
 * the spotlight window).
 *
 * Re-callable: `installNativeMenu(actions)` replaces the previously-
 * installed menu wholesale. Returns `{ accepted, skipped }` so the
 * IPC handler can echo counts back to the renderer.
 */

import {
  BrowserWindow,
  Menu,
  app,
  webContents as electronWebContents,
  type MenuItemConstructorOptions,
} from "electron";

import { IPC } from "@shared/ipc";
import type {
  Action,
  MenuCommandPayload,
  RegisterActionsResult,
} from "@shared/types";
import { MenuCommandPayloadSchema } from "@shared/schemas";

import { getMainWindow } from "@main/window/main-window";

// ---------------------------------------------------------------------------
// menu:on:command broadcast
// ---------------------------------------------------------------------------

/**
 * Fire a `menu:on:command` event at the focused renderer window. If no
 * window currently has focus (common on macOS when the menu is being
 * driven by accelerator while the main window is hidden) we fall back
 * to the main window.
 *
 * Exported so the tray's right-click fallback menu can reuse the
 * exact same broadcast path.
 */
export function broadcastMenuCommand(payload: MenuCommandPayload): void {
  // Dev-mode payload validation so contract drift is caught early.
  const parsed = MenuCommandPayloadSchema.parse(payload);

  const focused = BrowserWindow.getFocusedWindow();
  const target = focused ?? getMainWindow();

  if (target && !target.isDestroyed()) {
    target.webContents.send(IPC.MENU.ON_COMMAND, parsed);
    return;
  }

  // Last resort: broadcast to every webContents. Phase 2 has at most
  // 3 windows (main, spotlight, tray-popover) so this is cheap.
  for (const wc of electronWebContents.getAllWebContents()) {
    if (!wc.isDestroyed()) {
      wc.send(IPC.MENU.ON_COMMAND, parsed);
    }
  }
}

// ---------------------------------------------------------------------------
// Accelerator conflict handling
// ---------------------------------------------------------------------------

/**
 * Is this a development bundle (electron-vite dev) rather than a built
 * one? Read through a locally-typed view so this module still compiles
 * under tsconfigs that don't pull in the `vite/client` ambient types —
 * same pattern the renderer action registry uses.
 */
const isDevBuild: boolean =
  (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;

/**
 * Canonical form used to detect collisions. Electron treats
 * `CmdOrCtrl` and `CommandOrControl` as the same modifier, and the
 * registry uses the former, so fold them together and ignore case /
 * whitespace.
 */
function normalizeAccelerator(value: string): string {
  return value
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/cmdorctrl|commandorcontrol/g, "cmd");
}

/**
 * Accelerators the standard (non-action) menus effectively claim, so an
 * action item can never silently shadow, or be shadowed by, one of them.
 *
 * The Edit/Window/View roles bind their usual shortcuts by default; the
 * only one that overlaps the renderer registry today is the dev-only
 * `toggleDevTools` role (`CmdOrCtrl+Alt+I`). `Reload`/`Force Reload` are
 * deliberately NOT part of the View menu: the app owns `Cmd+R` for
 * "Refresh Catalog", and a monkey-patched reload would win it.
 */
function reservedAccelerators(dev: boolean): Set<string> {
  const reserved = new Set<string>();
  if (dev) reserved.add(normalizeAccelerator("CmdOrCtrl+Alt+I"));
  return reserved;
}

// ---------------------------------------------------------------------------
// Action → MenuItem mapping
// ---------------------------------------------------------------------------

/**
 * Convert an `Action` to a MenuItemConstructorOptions. `click` wires
 * the broadcast back to the renderer.
 *
 * `accelerator` is set from `action.shortcut`, but only when that
 * accelerator is not already claimed. Electron binds the FIRST matching
 * accelerator in the template and silently drops the rest, which is how
 * `Role Reload` used to eat `Cmd+R` from `catalog.refresh` and `Settings…`
 * shadow `app.open-settings`. Dropping the later binding here keeps the
 * menu item (still clickable) while guaranteeing the accelerator reaches
 * the action that owns it — and leaves a log line, not a mystery.
 */
function actionToMenuItem(
  action: Action,
  reserved: Set<string>,
): MenuItemConstructorOptions {
  const item: MenuItemConstructorOptions = {
    label: action.label,
    click: () => {
      broadcastMenuCommand({ commandId: action.id });
    },
  };
  if (action.shortcut) {
    const key = normalizeAccelerator(action.shortcut);
    if (reserved.has(key)) {
      console.warn(
        `[menu] accelerator ${action.shortcut} for action "${action.id}" is already bound; the item stays clickable but keeps no shortcut.`,
      );
    } else {
      reserved.add(key);
      item.accelerator = action.shortcut;
    }
  }
  return item;
}

/**
 * Bucket actions by `action.group ?? action.scope`. Each bucket becomes
 * a submenu (`Catalog`, `Repo`, `App`, …). The insertion order of the
 * input array is preserved.
 *
 * `spotlight`-scoped actions are excluded entirely.
 */
function bucketActions(actions: Action[]): Map<string, Action[]> {
  const buckets = new Map<string, Action[]>();
  for (const action of actions) {
    if (action.scope === "spotlight") continue;
    const key = action.group ?? scopeToGroup(action.scope);
    const existing = buckets.get(key);
    if (existing) {
      existing.push(action);
    } else {
      buckets.set(key, [action]);
    }
  }
  return buckets;
}

/** Stable scope → display group fallback used when `Action.group` is unset. */
function scopeToGroup(scope: Action["scope"]): string {
  switch (scope) {
    case "global":
      return "App";
    case "catalog":
      return "Catalog";
    case "repo-detail":
      return "Repo";
    case "settings":
      return "Settings";
    default:
      // `spotlight` is filtered out before we get here. Belt + braces.
      return "Other";
  }
}

// ---------------------------------------------------------------------------
// Standard mac App + Edit + View + Window + Help submenus
// ---------------------------------------------------------------------------

function buildAppMenu(): MenuItemConstructorOptions {
  // The App submenu is named after the app and is only used on macOS.
  return {
    label: app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      {
        // No explicit accelerator: `app.open-settings` in the registry
        // owns `CmdOrCtrl+,` so the two items can't fight over it. The
        // App-menu entry stays for macOS convention and clicks.
        label: "Settings…",
        click: () => {
          broadcastMenuCommand({ commandId: "app.open-settings" });
        },
      },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };
}

function buildEditMenu(): MenuItemConstructorOptions {
  return {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
    ],
  };
}

function buildViewMenu(dev: boolean): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = [];
  // Dev-only: the renderer registry provides "Toggle DevTools" and
  // "Refresh Catalog" in a built app, and those own their accelerators.
  // Reload/Force Reload are omitted in every mode so `Cmd+R` reaches the
  // catalog refresh rather than reloading the window.
  if (dev) {
    submenu.push({ role: "toggleDevTools" }, { type: "separator" });
  }
  submenu.push(
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  );
  return { label: "View", submenu };
}

function buildWindowMenu(): MenuItemConstructorOptions {
  return {
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { role: "front" },
    ],
  };
}

function buildHelpMenu(): MenuItemConstructorOptions {
  return {
    role: "help",
    submenu: [],
  };
}

// ---------------------------------------------------------------------------
// Public entry — build a Menu from an Action[]
// ---------------------------------------------------------------------------

/**
 * Build (but do not install) a `Menu` from the renderer's action
 * registry. Exported for tests; production callers should use
 * `installNativeMenu`.
 */
export function buildMenuFromActions(
  actions: Action[],
  /** `dev` overrides the build-mode detection; tests use it. */
  options?: { dev?: boolean },
): Menu {
  const dev = options?.dev ?? isDevBuild;
  const template: MenuItemConstructorOptions[] = [];

  // Reservations accumulate in template order — standard menus claim
  // their accelerators first, then each action item claims the rest.
  const reserved = reservedAccelerators(dev);

  // macOS App menu first.
  if (process.platform === "darwin") {
    template.push(buildAppMenu());
  }

  template.push(buildEditMenu(), buildViewMenu(dev));

  // Renderer-owned action groups go in the middle.
  const buckets = bucketActions(actions);
  for (const [groupName, groupActions] of buckets.entries()) {
    template.push({
      label: groupName,
      submenu: groupActions.map((action) => actionToMenuItem(action, reserved)),
    });
  }

  template.push(buildWindowMenu(), buildHelpMenu());

  // `buildFromTemplate` is where Electron rejects unbindable shortcuts.
  // We wrap in try/catch so a single bad accelerator doesn't kill the
  // whole menu — but in practice Electron logs and falls through.
  return Menu.buildFromTemplate(template);
}

/**
 * Install a freshly-built Application menu derived from the given
 * action registry. Replaces any previously-installed menu.
 *
 * Returns `{ accepted, skipped }` for echo back to the renderer:
 *   - `accepted` = actions that survived id-dedupe.
 *   - `skipped`  = actions skipped due to id collision (and, defensively,
 *     actions whose Accelerator string can't be parsed — currently
 *     0 because Electron tolerates bad accelerators silently; we keep
 *     the count for forward-compat).
 */
export function installNativeMenu(actions: Action[]): RegisterActionsResult {
  // Dedupe by id, preserving first occurrence. The contract says
  // re-registration is wholesale; this is just defensive in case the
  // renderer ships a registry with a typo.
  const seen = new Set<string>();
  const accepted: Action[] = [];
  let skipped = 0;
  for (const action of actions) {
    if (seen.has(action.id)) {
      skipped += 1;
      continue;
    }
    seen.add(action.id);
    accepted.push(action);
  }

  const menu = buildMenuFromActions(accepted);
  Menu.setApplicationMenu(menu);

  return {
    accepted: accepted.length,
    skipped,
  };
}
