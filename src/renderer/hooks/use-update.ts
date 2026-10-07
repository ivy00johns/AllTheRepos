/**
 * Update status for the renderer.
 *
 * Reads the last known status on mount (cheap, no network) and then
 * follows the push stream, so the indicator is correct immediately
 * rather than blank until the first check lands.
 *
 * The hook does not decide whether installing is possible — `status`
 * carries `canInstall` and `signature` from main, which is the only place
 * that can read the running bundle's signature. Callers branch on those
 * rather than on the state alone, because `available` means "a release
 * exists", not "this build can take it".
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
  canInstall: false,
  signature: "unknown",
  progress: null,
};

export interface UpdateState {
  status: UpdateStatus;
  /** Trigger a check now. */
  check: () => void;
  /** Open the release page for the pending update. */
  openRelease: () => void;
  /**
   * Download and apply the pending update, then relaunch.
   *
   * A no-op on a build that cannot install; the reason for that is already
   * in `status.signature`, which is what the UI should be showing.
   */
  install: () => void;
  checking: boolean;
  /** A download is in flight, or finished and waiting for a restart. */
  installing: boolean;
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

  const install = React.useCallback(() => {
    void requireAtr()
      .update.install({})
      // A refusal is an answer, not a failure — main's `reason` is already
      // reflected in `status.signature`, so there is nothing to surface
      // here that the button's own copy is not already saying.
      .catch(() => {});
  }, []);

  return {
    status,
    check,
    openRelease,
    install,
    checking: status.state === "checking",
    installing: status.state === "downloading" || status.state === "ready",
  };
}
