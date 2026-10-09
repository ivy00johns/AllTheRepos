/**
 * What main tells each window about the build it is running in.
 *
 * One fact, stated in one place, consumed by every `BrowserWindow` this process
 * creates — see `@shared/build-info` for why it travels through the argv rather
 * than over IPC. `app.isPackaged` is the truth, with one deliberate override.
 */

import { app } from "electron";

import { encodePackagedFlag } from "@shared/build-info";

/**
 * `app.isPackaged` — whether this process is running from a signed/notarized
 * bundle rather than from `out/` on a disk.
 *
 * `ATR_FORCE_PACKAGED=1` overrides it, and exists for one reason: the packaged
 * branch of every dev-only decision (the top bar's affordance, the palette's
 * `devOnly` actions) is otherwise only reachable by building and signing a DMG,
 * so it would never be exercised until a release. The E2E suite sets it on a
 * normal unpackaged launch and checks the app behaves like a release; nothing
 * else in main reads it, so `app.isPackaged` stays the truth for everything
 * that is not about what the renderer offers.
 */
export function packagedForRenderer(): boolean {
  if (process.env.ATR_FORCE_PACKAGED === "1") return true;
  return app.isPackaged;
}

/**
 * The `webPreferences.additionalArguments` value for a window.
 *
 * The `status` argument is what Playwright appends to a launch without changing
 * anything the app does; ours is additive and read only by the preload.
 */
export function rendererAdditionalArguments(): string[] {
  return [encodePackagedFlag(packagedForRenderer())];
}
