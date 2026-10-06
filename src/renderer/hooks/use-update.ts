/**
 * Update status for the renderer.
 *
 * Reads the last known status on mount (cheap, no network) and then
 * follows the push stream, so the indicator is correct immediately
 * rather than blank until the first check lands.
 */

import * as React from "react";

import type { UpdateStatus } from "@shared/types";

import { getAtr, requireAtr } from "@renderer/lib/atr";

const IDLE: UpdateStatus = {
  state: "idle",
  currentVersion: "",
  newVersion: null,
  releaseUrl: null,
  message: null,
  checkedAt: null,
};

export interface UpdateState {
  status: UpdateStatus;
  /** Trigger a check now. */
  check: () => void;
  /** Open the release page for the pending update. */
  openRelease: () => void;
  checking: boolean;
}

export function useUpdate(): UpdateState {
  const [status, setStatus] = React.useState<UpdateStatus>(IDLE);

  React.useEffect(() => {
    const atr = getAtr();
    if (!atr) return;
    // Seed from the current state, then follow the stream. Without the
    // seed a window opened after the startup check would show nothing.
    void atr.update
      .status({})
      .then(setStatus)
      .catch(() => {});
    return atr.update.onStatus(setStatus);
  }, []);

  const check = React.useCallback(() => {
    const atr = getAtr();
    if (!atr) return;
    void atr.update
      .check({})
      .then(setStatus)
      .catch(() => {});
  }, []);

  const openRelease = React.useCallback(() => {
    void requireAtr()
      .update.openRelease({})
      .catch(() => {});
  }, []);

  return { status, check, openRelease, checking: status.state === "checking" };
}
