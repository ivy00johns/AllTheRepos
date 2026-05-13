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
  nativeImage,
  webContents as electronWebContents,
  type MenuItemConstructorOptions,
} from "electron";
import { join } from "node:path";

import { IPC } from "@shared/ipc";
import { TrayOpenRepoPayloadSchema } from "@shared/schemas";
import type { TrayOpenRepoPayload } from "@shared/types";

import { showSpotlight } from "./hotkey";
import { showTrayPopover } from "./tray-popover-bridge";

// Module-scoped reference — keeps the Tray alive (macOS GC behaviour).
let tray: Tray | null = null;

/**
 * Resolve the tray template asset path. In the bundled build the asset
 * lives under the app's `resources/` directory; in dev it lives at the
 * repo root. We resolve relative to `app.getAppPath()` which is correct
 * for both.
 *
 * `tray-Template.png` is the @1x asset; macOS automatically picks up
 * `tray-Template@2x.png` on Retina displays via the `@2x` suffix
 * convention (see `resources/tray/tray-README.md`).
 */
function resolveTrayIconPath(): string {
  return join(app.getAppPath(), "resources", "tray", "tray-Template.png");
}

/**
 * Build the right-click fallback menu. Kept intentionally small — the
 * primary tray UX is the popover BrowserWindow owned by
 * `src/main/window/tray-popover.ts`.
 */
function buildContextMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Recent repos",
      enabled: false,
    },
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
  // Local import to avoid an init-order cycle with `./menu.ts`.
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

  const iconPath = resolveTrayIconPath();
  const image = nativeImage.createFromPath(iconPath);

  // If the asset is missing (e.g. fresh checkout without the placeholder)
  // we still want the app to boot — log loudly and skip tray creation.
  if (image.isEmpty()) {
    console.warn(
      `[tray] tray icon at ${iconPath} is empty/missing — tray disabled. ` +
        `Add a 22×22 black-on-transparent PNG (see resources/tray/tray-README.md).`,
    );
    // Don't return — we still want to install a 1×1 transparent so the
    // OS shows a click-through slot in dev. The placeholder is a 1×1
    // transparent PNG which `isEmpty()` returns false for, but be safe.
    return null;
  }

  // `template: true` tells macOS to auto-invert in dark mode.
  image.setTemplateImage(true);

  tray = new Tray(image);
  tray.setToolTip("AllTheRepos");

  tray.on("click", () => {
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
  });

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
}

/**
 * Broadcast a `tray:on:open-repo` event to every renderer window.
 * The tray-popover (owned by backend-windows) calls this when the user
 * clicks a recent-repo row. The renderer subscribes via
 * `window.atr.app.onTrayOpenRepo(...)` and navigates to the slug.
 */
export function broadcastTrayOpenRepo(payload: TrayOpenRepoPayload): void {
  const parsed = TrayOpenRepoPayloadSchema.parse(payload);
  for (const wc of electronWebContents.getAllWebContents()) {
    if (!wc.isDestroyed()) {
      wc.send(IPC.TRAY.ON_OPEN_REPO, parsed);
    }
  }
}
