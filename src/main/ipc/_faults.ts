/**
 * Fault injection for the IPC layer — test-only, inert without its switches.
 *
 * Two states a screen can be in are not reachable on a healthy machine: a read
 * that fails, and a read that is still in flight. Both have UI — the error state
 * with its retry (ATR-063) and the skeleton that stands in for content that has
 * not arrived (ATR-064) — and neither can be checked in a real window unless a
 * real call is made to fail or to be slow. Asserting them from the markup alone
 * would be asserting that the branch exists, not that it is reachable.
 *
 * So the single choke point is wrapped once, before any handler is registered,
 * and the switches name what to spoil:
 *
 *   ATR_FAIL_IPC="settings:get"     these channels fail
 *   ATR_DELAY_IPC="catalog:get"     these channels wait before answering
 *   ATR_DELAY_IPC_MS="3000"         …for this long
 *   ATR_FAULT_UNTIL="/tmp/atr-out"  …while this file exists
 *
 * **One flag file gates both, and that is the point.** A failure has to outlive
 * the query layer's own retry — the renderer retries a failed query once, so a
 * single spoiled call would be retried into success and the error screen would
 * never appear. A delay has the mirror-image problem: a *one-shot* delay goes to
 * whoever asks first, and on this app that is rarely the screen under test (the
 * top bar reads the process snapshot and the settings before any panel does),
 * which made "is the skeleton on screen" a question about mount order rather
 * than about the placeholder. Gating both on the file means the named channel
 * behaves that way *until the test lifts the outage*, whoever is calling: the
 * call in flight when the file goes is answered within a poll interval, so
 * lifting it is what makes the answer arrive and the user's *Try again* is an
 * ordinary call again.
 *
 * The app never sets any of these, and the injection is a no-op without them —
 * the same bargain `scripts/refuse-github.cjs` strikes for the updater, which is
 * why the E2E suite has a way to make a refusal happen rather than waiting for
 * one.
 */

import { existsSync } from "node:fs";

import { ipcMain } from "electron";

/**
 * How often a delayed call re-checks whether the outage is still on. Small
 * enough that lifting the flag releases a pending read faster than a person can
 * notice, large enough not to spin.
 */
const DELAY_POLL_MS = 100;

/** What to spoil, parsed from the environment. */
export interface FaultPlan {
  /** Channels that fail while {@link faultUntil} exists. */
  failChannels: readonly string[];
  /** Channels that wait {@link delayMs} while {@link faultUntil} exists. */
  delayChannels: readonly string[];
  /** How long that wait is, in milliseconds. */
  delayMs: number;
  /**
   * The flag file whose existence holds the outage open. Without it a failure
   * would be permanent and a delay would never end, so a plan that names
   * channels needs one.
   */
  faultUntil: string;
}

function channelList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Read the switches. Pure, so the parsing is testable without an app.
 *
 * A delay needs a positive, finite duration as well as a channel: a delay of
 * zero or NaN is not a delay, and defaulting to "some" delay would make the
 * switch mean something other than what it says. Either way, a plan without its
 * flag file is no plan at all — that is the difference between an arrangement a
 * test can end and an app that can never recover.
 */
export function planFaults(
  env: Record<string, string | undefined> = process.env,
): FaultPlan | null {
  const faultUntil = env.ATR_FAULT_UNTIL?.trim();
  if (!faultUntil) return null;

  const failChannels = channelList(env.ATR_FAIL_IPC);
  const delayMs = Number(env.ATR_DELAY_IPC_MS ?? 0);
  const wantsDelay = channelList(env.ATR_DELAY_IPC).length > 0;
  const delays = wantsDelay && Number.isFinite(delayMs) && delayMs > 0;
  const delayChannels = delays ? channelList(env.ATR_DELAY_IPC) : [];

  if (failChannels.length === 0 && delayChannels.length === 0) return null;
  return {
    failChannels,
    delayChannels,
    delayMs: delays ? delayMs : 0,
    faultUntil,
  };
}

/** The delay, injectable so a test does not have to wait for it. */
export type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait out a delayed call, giving up as soon as the outage is lifted.
 *
 * Bounded by `ms` in both directions: a flag that never goes away still lets
 * the call through at the end of the delay, so a test that forgets to clean up
 * slows the app down rather than hanging it.
 */
async function delayWhileFaulted(
  ms: number,
  flag: string,
  deps: { sleep: Sleep; exists: (path: string) => boolean },
): Promise<void> {
  let waited = 0;
  while (waited < ms) {
    if (!deps.exists(flag)) return;
    const step = Math.min(DELAY_POLL_MS, ms - waited);
    await deps.sleep(step);
    waited += step;
  }
}

/**
 * Wrap one listener so the named channels fail, and the named channels are slow,
 * while the flag file exists.
 *
 * Exported and pure over its `sleep`/`exists` so the behaviour is pinned by a
 * unit test rather than only observed through a multi-second app launch.
 */
export function spoiledListener<E, A extends unknown[], R>(
  channel: string,
  listener: (event: E, ...args: A) => R,
  plan: FaultPlan,
  deps: { sleep?: Sleep; exists?: (path: string) => boolean } = {},
): (event: E, ...args: A) => Promise<R> {
  const sleep = deps.sleep ?? realSleep;
  const exists = deps.exists ?? existsSync;

  return async (event, ...args) => {
    if (plan.failChannels.includes(channel) && exists(plan.faultUntil)) {
      throw new Error(
        `[ipc-faults] ${channel} is failing on purpose while ${plan.faultUntil} exists`,
      );
    }
    if (plan.delayChannels.includes(channel) && exists(plan.faultUntil)) {
      await delayWhileFaulted(plan.delayMs, plan.faultUntil, { sleep, exists });
    }
    return listener(event, ...args);
  };
}

/**
 * Install the switches on `ipcMain`, if any were asked for.
 *
 * Called from `registerIpcHandlers()` before the first domain module registers
 * anything, so every handler is wrapped by construction rather than by being
 * remembered individually.
 */
export function installIpcFaults({
  env = process.env,
  ipc = ipcMain,
  sleep = realSleep,
  exists = existsSync,
  log = console.log,
}: {
  env?: Record<string, string | undefined>;
  ipc?: typeof ipcMain;
  sleep?: Sleep;
  exists?: (path: string) => boolean;
  log?: (message: string) => void;
} = {}): void {
  const plan = planFaults(env);
  if (!plan) return;

  const parts: string[] = [];
  if (plan.failChannels.length > 0) {
    parts.push(`${plan.failChannels.join(", ")} will fail`);
  }
  if (plan.delayChannels.length > 0) {
    parts.push(
      `${plan.delayChannels.join(", ")} will be delayed by ${plan.delayMs}ms`,
    );
  }
  log(
    `[ipc-faults] enabled while ${plan.faultUntil} exists: ${parts.join("; ")}`,
  );

  const handle = ipc.handle.bind(ipc);
  ipc.handle = ((channel: string, listener: (...args: never[]) => unknown) =>
    handle(
      channel,
      spoiledListener(
        channel,
        listener as (event: unknown, ...args: unknown[]) => unknown,
        plan,
        { sleep, exists },
      ),
    )) as typeof ipc.handle;
}
