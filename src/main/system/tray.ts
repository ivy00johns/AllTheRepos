/**
 * macOS menu-bar (tray) integration.
 *
 * Loads a black-on-transparent template PNG from
 * `resources/tray/tray-Template.png` and installs a `Tray` instance with:
 *
 *   - LEFT-CLICK: ask the (backend-windows-owned) tray-popover to show
 *     next to the tray icon's bounds. The popover is the real UI — this
 *     module only orchestrates positioning.
 *   - RIGHT-CLICK: a small fallback `Menu` (Open Spotlight, Settings,
 *     Quit) for the case where the popover BrowserWindow isn't available
 *     yet (e.g. parallel-agent integration ordering at boot).
 *
 * The tray instance is module-scoped to avoid GC; macOS silently
 * destroys an unreferenced Tray after the function returns.
 */

import {
  Menu,
  Tray,
  app,
  ipcMain,
  nativeImage,
  webContents as electronWebContents,
  type IpcMainEvent,
  type MenuItemConstructorOptions,
} from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { IPC } from "@shared/ipc";
import { TrayOpenRepoPayloadSchema } from "@shared/schemas";
import type { TrayOpenRepoPayload } from "@shared/types";

import { getSqlite } from "@main/db/client";

import { showSpotlight } from "./hotkey";
import { showTrayPopover } from "./tray-popover-bridge";

/**
 * Renderer → main request channel for "open this repo in the main window".
 *
 * The spotlight + tray-popover windows are SEPARATE renderer processes;
 * they can't fire the main-window-bound `tray:on:open-repo` push event
 * themselves. Instead they `send` the picked slug on this channel and
 * main re-broadcasts it via `broadcastTrayOpenRepo()` — the cross-window
 * forward the renderer can't do directly (see ATR-006).
 *
 * This is a renderer→main ONE-WAY channel (ipcMain.on, not handle): the
 * sender doesn't await a response, it just hands main the slug. It is
 * intentionally NOT in the shared `IPC` request/response registry —
 * that union only covers `invoke` round-trips. Kept as a local const so
 * the preload sender + this listener share one literal.
 */
export const TRAY_OPEN_REPO_REQUEST_CHANNEL = "tray:request-open-repo" as const;

/** How many recent repos to surface in the tray right-click menu. */
const RECENT_REPO_MENU_LIMIT = 5;

// Module-scoped reference — keeps the Tray alive (macOS GC behaviour).
let tray: Tray | null = null;

/** Guards against double-registering the ipcMain forwarder on hot-reload. */
let forwarderWired = false;

/**
 * Resolve the tray template asset path.
 *
 * A packaged app carries the asset under its own `resources/`, and
 * `app.getAppPath()` finds it there. That is *not* true of the two layouts this
 * app is otherwise run in, and the difference matters: `app.getAppPath()` answers
 * with the directory holding the entry point, so an `out/` build (`electron-vite
 * preview`, and the whole Electron E2E suite, which launches `out/main/index.js`)
 * looks for `out/main/resources/tray/…`, which is not a place anything ever puts
 * an asset. The tray then took its documented hard-failure path — a loud warning
 * and no tray icon at all — which is how the popover came to have no reachable
 * door from the suite.
 *
 * So: the app path first, and for an un-packaged run the repository's copy, which
 * is where the asset lives for dev, preview and the E2E alike.
 *
 * `tray-Template.png` is the @1x asset; macOS automatically picks up
 * `tray-Template@2x.png` on Retina displays via the `@2x` suffix
 * convention (see `resources/tray/tray-README.md`).
 */
function resolveTrayIconPath(): string {
  const fromAppPath = join(
    app.getAppPath(),
    "resources",
    "tray",
    "tray-Template.png",
  );
  if (existsSync(fromAppPath)) return fromAppPath;

  // `out/main/index.js` → the repository root.
  const fromRepo = join(
    __dirname,
    "..",
    "..",
    "resources",
    "tray",
    "tray-Template.png",
  );
  return existsSync(fromRepo) ? fromRepo : fromAppPath;
}

/**
 * Read the most-recently-opened repos straight from SQLite for the
 * tray right-click menu. Synchronous (better-sqlite3) so the menu can
 * be built inline in the click handler.
 *
 * Defensive: any failure (db not yet migrated, table missing during a
 * cold boot) yields an empty list rather than throwing — the menu just
 * shows the disabled "Recent repos" header in that case.
 */
function loadRecentRepos(): Array<{ slug: string; name: string }> {
  try {
    const sqlite = getSqlite();
    const rows = sqlite
      .prepare(
        `SELECT slug, name FROM repos
         ORDER BY COALESCE(last_opened_at, last_commit_date, updated_at) DESC
         LIMIT ?`,
      )
      .all(RECENT_REPO_MENU_LIMIT) as Array<{ slug: string; name: string }>;
    return rows.filter((r) => typeof r.slug === "string" && r.slug.length > 0);
  } catch (err) {
    console.warn("[tray] failed to load recent repos for menu", err);
    return [];
  }
}

/**
 * Build the right-click fallback menu. The popover BrowserWindow owned
 * by `src/main/window/tray-popover.ts` is the primary tray UX, but the
 * native menu is the always-available path: its recent-repo items are
 * real and fire `tray:on:open-repo` via `broadcastTrayOpenRepo()` so
 * the main window navigates even when the popover isn't shipped/visible.
 */
function buildContextMenu(): Menu {
  const recent = loadRecentRepos();
  const recentItems: MenuItemConstructorOptions[] =
    recent.length === 0
      ? [{ label: "Recent repos", enabled: false }]
      : [
          { label: "Recent repos", enabled: false },
          ...recent.map(
            (repo): MenuItemConstructorOptions => ({
              label: repo.name || repo.slug,
              click: () => {
                broadcastTrayOpenRepo({ slug: repo.slug });
              },
            }),
          ),
        ];

  const template: MenuItemConstructorOptions[] = [
    ...recentItems,
    { type: "separator" },
    {
      label: "Open Spotlight…",
      accelerator: "CmdOrCtrl+Shift+Space",
      click: () => {
        showSpotlight();
      },
    },
    {
      label: "Settings…",
      accelerator: "CmdOrCtrl+,",
      click: () => {
        // Settings opening goes through the renderer dispatch table via a
        // menu-command event; here we just signal the global hotkey path
        // (renderer subscribes via `app.onMenuCommand`).
        emitMenuCommand("app.open-settings");
      },
    },
    { type: "separator" },
    {
      label: "Quit AllTheRepos",
      accelerator: "CmdOrCtrl+Q",
      click: () => {
        app.quit();
      },
    },
  ];
  return Menu.buildFromTemplate(template);
}

/**
 * Fire a `menu:on:command` event at the focused (or main) window. Used
 * by the right-click fallback menu so the renderer's dispatch table
 * can run the bound handler exactly as if the user had clicked the
 * native menu item.
 */
function emitMenuCommand(commandId: string): void {
  // Local import to avoid an init-order cycle with `./menu.ts` — which is the
  // reason for the suppression rather than a static import that would read
  // better: at module scope this one is genuinely circular.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the cycle a static import would create
  const { broadcastMenuCommand } = require("./menu") as typeof import("./menu");
  broadcastMenuCommand({ commandId });
}

/**
 * Create the tray icon. Idempotent — calling twice destroys the first
 * instance and reinstalls the second.
 */
export function createTray(): Tray | null {
  if (tray) {
    try {
      tray.destroy();
    } catch {
      // tray may already be disposed; ignore.
    }
    tray = null;
  }

  // Make `broadcastTrayOpenRepo()` reachable from the spotlight /
  // tray-popover renderers (ATR-006). Idempotent across hot-reload.
  wireOpenRepoForwarder();

  const iconPath = resolveTrayIconPath();
  const image = nativeImage.createFromPath(iconPath);

  // If the asset is genuinely missing/undecodable, `isEmpty()` is true.
  // The tray icon is a hard requirement for a usable menu-bar app, so a
  // missing asset is a real failure — log loudly and skip tray creation
  // (returning null is correct here; the previous comment claimed we
  // "don't return" but the code did, and the 1×1 placeholder it referred
  // to is gone now that resources/tray/tray-Template.png is a real
  // 22×22 template image).
  if (image.isEmpty()) {
    console.warn(
      `[tray] tray icon at ${iconPath} is empty/missing — tray disabled. ` +
        `Restore the 22×22 black-on-transparent template PNG ` +
        `(see resources/tray/tray-README.md).`,
    );
    return null;
  }

  // macOS template image: a black-on-transparent glyph that the OS
  // auto-inverts for light/dark menu bars and selection highlight. The
  // @2x asset (resources/tray/tray-Template@2x.png) is picked up
  // automatically by `createFromPath` via the `@2x` filename suffix.
  image.setTemplateImage(true);

  tray = new Tray(image);
  tray.setToolTip("AllTheRepos");

  /**
   * The tray's left-click path: the popover next to the icon, or the fallback
   * menu when the popover is unavailable.
   *
   * Named rather than inlined because the E2E suite needs to reach exactly this
   * path — see the `ATR_E2E` block below.
   */
  const openTrayPopover = (): void => {
    if (!tray) return;
    const bounds = tray.getBounds();
    try {
      showTrayPopover(bounds);
    } catch (err) {
      // backend-windows hasn't shipped the popover yet — fall back to
      // the right-click menu so the user isn't stranded.
      console.warn(
        "[tray] tray-popover unavailable, opening context menu",
        err,
      );
      if (tray) tray.popUpContextMenu(buildContextMenu());
    }
  };

  tray.on("click", openTrayPopover);

  //
  // Under E2E (`ATR_E2E=1`, set by playwright.electron.config.ts, the same
  // variable that hides the dock icon and shows the window inactive) publish
  // that handler on `globalThis`. The popover is the one screen of this app with
  // no door from a renderer — the spotlight is opened by an action and every
  // route by the top bar — so a spec that wants to look at it can only reach it
  // from the main process. This hands over the real path (the icon's own
  // bounds), rather than a second factory that would drift from this one.
  //
  if (process.env.ATR_E2E === "1") {
    (
      globalThis as { __atrE2EOpenTrayPopover?: () => void }
    ).__atrE2EOpenTrayPopover = openTrayPopover;
  }

  tray.on("right-click", () => {
    if (!tray) return;
    tray.popUpContextMenu(buildContextMenu());
  });

  return tray;
}

/** Test/teardown hook — destroys the tray and clears the module ref. */
export function destroyTray(): void {
  if (tray) {
    try {
      tray.destroy();
    } catch {
      // ignore
    }
    tray = null;
  }
  if (forwarderWired) {
    try {
      ipcMain.removeListener(
        TRAY_OPEN_REPO_REQUEST_CHANNEL,
        handleOpenRepoRequest,
      );
    } catch {
      // ignore
    }
    forwarderWired = false;
  }
}

/**
 * ipcMain handler for the renderer→main "open repo" request. Validates
 * the payload with `safeParse` (so untrusted renderer input can't crash
 * main) and re-broadcasts it as `tray:on:open-repo`. A malformed payload
 * is logged and dropped rather than forwarded.
 */
function handleOpenRepoRequest(_event: IpcMainEvent, raw: unknown): void {
  const parsed = TrayOpenRepoPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[tray] dropped malformed open-repo request", parsed.error);
    return;
  }
  broadcastTrayOpenRepo(parsed.data);
}

/**
 * Register the renderer→main open-repo forwarder (ATR-006). The
 * spotlight + tray-popover renderers `send` the picked slug on
 * `TRAY_OPEN_REPO_REQUEST_CHANNEL`; main re-broadcasts it to the
 * main-window renderer via `broadcastTrayOpenRepo()`. Idempotent.
 *
 * Called from `createTray()` so the listener exists for the lifetime of
 * the tray; `destroyTray()` tears it down for test isolation.
 */
export function wireOpenRepoForwarder(): void {
  if (forwarderWired) return;
  forwarderWired = true;
  ipcMain.on(TRAY_OPEN_REPO_REQUEST_CHANNEL, handleOpenRepoRequest);
}

/**
 * Broadcast a `tray:on:open-repo` event to every renderer window.
 * Fired when the user picks a recent repo — from the tray native menu,
 * the tray popover, or the spotlight (the latter two route through
 * `wireOpenRepoForwarder()` since they're separate renderer processes).
 * The main-window renderer subscribes via `window.atr.tray.onOpenRepo`
 * / `app.onTrayOpenRepo` (see `useTrayOpenRepoBus`) and navigates to the
 * slug.
 */
export function broadcastTrayOpenRepo(payload: TrayOpenRepoPayload): void {
  const parsed = TrayOpenRepoPayloadSchema.parse(payload);
  for (const wc of electronWebContents.getAllWebContents()) {
    if (!wc.isDestroyed()) {
      wc.send(IPC.TRAY.ON_OPEN_REPO, parsed);
    }
  }
}
