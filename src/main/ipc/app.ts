/**
 * IPC handlers — `app:*` namespace (Phase 2).
 *
 * Five invoke-style channels:
 *   - `app:setDockBadge`    → set/clear macOS dock badge.
 *   - `app:notify`          → show a native notification.
 *   - `app:showSpotlight`   → open the global spotlight window.
 *   - `app:hideSpotlight`   → close the global spotlight window.
 *   - `app:registerActions` → renderer pushes its action registry;
 *                             main rebuilds the Application menu.
 *
 * Hard rules (per NEW-PLAN.md §3.4):
 *   - Every handler validates input AND output with Zod.
 *   - Every handler asserts the request came from our renderer frame.
 *
 * Side-effect modules live under `@main/system/*`; this file is a thin
 * Zod-validated façade.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { IPC } from "@shared/ipc";
import {
  HideSpotlightInputSchema,
  HideSpotlightResultSchema,
  NotifyInputSchema,
  NotifyResultSchema,
  RegisterActionsInputSchema,
  RegisterActionsResultSchema,
  SetDockBadgeInputSchema,
  SetDockBadgeResultSchema,
  ShowSpotlightInputSchema,
  ShowSpotlightResultSchema,
} from "@shared/schemas";
import type {
  HideSpotlightResult,
  NotifyResult,
  RegisterActionsResult,
  SetDockBadgeResult,
  ShowSpotlightResult,
} from "@shared/types";

import { setDockBadge } from "@main/system/dock-badge";
import { hideSpotlight, showSpotlight } from "@main/system/hotkey";
import { installNativeMenu } from "@main/system/menu";
import { handleNotify } from "@main/system/notification";

import { assertRendererFrame } from "./_frame";

// ---------------------------------------------------------------------------
// Pure handler bodies — Electron-agnostic, exported for QE.
// ---------------------------------------------------------------------------

export async function handleSetDockBadge(
  raw: unknown,
): Promise<SetDockBadgeResult> {
  const input = SetDockBadgeInputSchema.parse(raw);
  const badge = setDockBadge(input.count);
  return SetDockBadgeResultSchema.parse({ badge });
}

export async function handleAppNotify(raw: unknown): Promise<NotifyResult> {
  // `handleNotify` already parses through `NotifyInputSchema`, but we
  // run it again here for the contract pattern (cheap; consistent).
  const input = NotifyInputSchema.parse(raw);
  const result = handleNotify(input);
  return NotifyResultSchema.parse(result);
}

export async function handleShowSpotlight(
  raw: unknown,
): Promise<ShowSpotlightResult> {
  ShowSpotlightInputSchema.parse(raw);
  showSpotlight();
  return ShowSpotlightResultSchema.parse({ visible: true });
}

export async function handleHideSpotlight(
  raw: unknown,
): Promise<HideSpotlightResult> {
  HideSpotlightInputSchema.parse(raw);
  hideSpotlight();
  return HideSpotlightResultSchema.parse({ visible: false });
}

export async function handleRegisterActions(
  raw: unknown,
): Promise<RegisterActionsResult> {
  const input = RegisterActionsInputSchema.parse(raw);
  const result = installNativeMenu(input.actions);
  return RegisterActionsResultSchema.parse(result);
}

// ---------------------------------------------------------------------------
// ipcMain registration
// ---------------------------------------------------------------------------

/** Register every `app:*` handler. Idempotent. */
export function registerAppHandlers(): void {
  const channels = [
    IPC.APP.SET_DOCK_BADGE,
    IPC.APP.NOTIFY,
    IPC.APP.SHOW_SPOTLIGHT,
    IPC.APP.HIDE_SPOTLIGHT,
    IPC.APP.REGISTER_ACTIONS,
  ] as const;
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(
    IPC.APP.SET_DOCK_BADGE,
    async (event: IpcMainInvokeEvent, raw): Promise<SetDockBadgeResult> => {
      assertRendererFrame(event);
      return handleSetDockBadge(raw);
    },
  );

  ipcMain.handle(
    IPC.APP.NOTIFY,
    async (event: IpcMainInvokeEvent, raw): Promise<NotifyResult> => {
      assertRendererFrame(event);
      return handleAppNotify(raw);
    },
  );

  ipcMain.handle(
    IPC.APP.SHOW_SPOTLIGHT,
    async (event: IpcMainInvokeEvent, raw): Promise<ShowSpotlightResult> => {
      assertRendererFrame(event);
      return handleShowSpotlight(raw);
    },
  );

  ipcMain.handle(
    IPC.APP.HIDE_SPOTLIGHT,
    async (event: IpcMainInvokeEvent, raw): Promise<HideSpotlightResult> => {
      assertRendererFrame(event);
      return handleHideSpotlight(raw);
    },
  );

  ipcMain.handle(
    IPC.APP.REGISTER_ACTIONS,
    async (event: IpcMainInvokeEvent, raw): Promise<RegisterActionsResult> => {
      assertRendererFrame(event);
      return handleRegisterActions(raw);
    },
  );
}
