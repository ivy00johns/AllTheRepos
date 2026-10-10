/**
 * The IPC fault injector (test-only; see `src/main/ipc/_faults.ts`).
 *
 * Two properties matter here, and both are about *when* the spoiling stops. A
 * failure has to outlive the query layer's own retry — the renderer retries a
 * failed query once, so a single spoiled call would be retried into success and
 * the error screen would never appear. A delay has to reach the screen under
 * test even though the top bar reads the same snapshots first, and it has to end
 * when the test says so rather than when a mount order happens to allow it. Both
 * are therefore held open by one flag file, and lifting that file is what turns
 * the next call — or the one already waiting — into an ordinary one.
 *
 * The waiting is done through an injected sleep, so no test here spends a
 * millisecond on the thing it is measuring.
 */

import { describe, expect, test } from "vitest";

import {
  installIpcFaults,
  planFaults,
  spoiledListener,
  type FaultPlan,
} from "@main/ipc/_faults";

const FLAG = "/tmp/atr-fault-flag";

const plan = (over: Partial<FaultPlan> = {}): FaultPlan => ({
  failChannels: [],
  delayChannels: [],
  delayMs: 0,
  faultUntil: FLAG,
  ...over,
});

describe("planFaults", () => {
  test("is null — and therefore inert — when no switch is set", () => {
    expect(planFaults({})).toBeNull();
    expect(planFaults({ ATR_FAIL_IPC: "  " })).toBeNull();
    expect(planFaults({ ATR_DELAY_IPC: "process:list" })).toBeNull();
  });

  test("a switch without its flag file does nothing", () => {
    // Channels with no flag would mean an app that can never recover, which is
    // not a state a test wants to arrange by accident.
    expect(planFaults({ ATR_FAIL_IPC: "settings:get" })).toBeNull();
    expect(
      planFaults({ ATR_DELAY_IPC: "settings:get", ATR_DELAY_IPC_MS: "3000" }),
    ).toBeNull();
    expect(planFaults({ ATR_FAULT_UNTIL: FLAG })).toBeNull();
  });

  test("a failure needs its channels as well as the flag", () => {
    const planned = planFaults({
      ATR_FAIL_IPC: "settings:get, process:list ,",
      ATR_FAULT_UNTIL: FLAG,
    });
    expect(planned?.failChannels).toEqual(["settings:get", "process:list"]);
    expect(planned?.faultUntil).toBe(FLAG);
    expect(planned?.delayChannels).toEqual([]);
  });

  test("a delay needs a channel and a positive duration, not just the flag", () => {
    const expected = {
      ATR_DELAY_IPC: "catalog:get",
      ATR_FAULT_UNTIL: FLAG,
    };
    // No duration: not a delay, and not silently "some" delay either.
    expect(planFaults(expected)).toBeNull();
    expect(planFaults({ ...expected, ATR_DELAY_IPC_MS: "0" })).toBeNull();
    expect(planFaults({ ...expected, ATR_DELAY_IPC_MS: "nope" })).toBeNull();

    const planned = planFaults({ ...expected, ATR_DELAY_IPC_MS: "3000" });
    expect(planned?.delayChannels).toEqual(["catalog:get"]);
    expect(planned?.delayMs).toBe(3000);
    expect(planned?.failChannels).toEqual([]);
  });
});

describe("spoiledListener", () => {
  test("fails every call while the flag exists, and answers once it is gone", async () => {
    const failing = plan({ failChannels: ["settings:get"] });
    let flag = true;
    const listener = spoiledListener(
      "settings:get",
      () => "the real answer",
      failing,
      { exists: () => flag },
    );

    // Twice, because the renderer's own retry is the second call: one spoiled
    // call would be retried into success and the error screen would never show.
    await expect(listener(undefined)).rejects.toThrow(/on purpose/);
    await expect(listener(undefined)).rejects.toThrow(/on purpose/);

    // The test lifts the outage; the user's next attempt is what succeeds.
    flag = false;
    await expect(listener(undefined)).resolves.toBe("the real answer");
  });

  test("leaves every other channel alone, flag or no flag", async () => {
    const listener = spoiledListener(
      "catalog:list",
      () => "untouched",
      plan({ failChannels: ["settings:get"] }),
      { exists: () => true },
    );
    await expect(listener(undefined)).resolves.toBe("untouched");
  });

  test("delays every call to a named channel while the flag exists, and passes arguments through", async () => {
    const slept: number[] = [];
    const listener = spoiledListener(
      "catalog:get",
      (_event: unknown, input: { slug: string }) => input.slug,
      plan({ delayChannels: ["catalog:get"], delayMs: 3000 }),
      {
        exists: () => true,
        sleep: async (ms) => {
          slept.push(ms);
        },
      },
    );

    await expect(listener(undefined, { slug: "one" })).resolves.toBe("one");
    await expect(listener(undefined, { slug: "two" })).resolves.toBe("two");

    // Not once, and not "until the flag goes away": the wait is bounded by the
    // duration, so a test that forgets to clean up is slow rather than hung.
    expect(slept.reduce((total, ms) => total + ms, 0)).toBe(6000);
  });

  test("releases a call that is already waiting when the flag is lifted", async () => {
    let flag = true;
    let checks = 0;
    const slept: number[] = [];
    const listener = spoiledListener(
      "settings:get",
      () => "the real answer",
      plan({ delayChannels: ["settings:get"], delayMs: 10_000 }),
      {
        // The file disappears on the third look, as it would when a test ends
        // the outage while a read is in flight.
        exists: () => {
          checks += 1;
          if (checks > 3) flag = false;
          return flag;
        },
        sleep: async (ms) => {
          slept.push(ms);
        },
      },
    );

    await expect(listener(undefined)).resolves.toBe("the real answer");
    // Two whole poll intervals and the one that noticed: nowhere near the ten
    // seconds the plan asked for, because the outage ended first.
    expect(slept.reduce((total, ms) => total + ms, 0)).toBeLessThan(1_000);
  });

  test("no waiting at all once the flag is gone", async () => {
    const slept: number[] = [];
    const listener = spoiledListener(
      "catalog:get",
      () => "the real answer",
      plan({ delayChannels: ["catalog:get"], delayMs: 3000 }),
      {
        exists: () => false,
        sleep: async (ms) => {
          slept.push(ms);
        },
      },
    );

    await expect(listener(undefined)).resolves.toBe("the real answer");
    expect(slept).toEqual([]);
  });
});

describe("installIpcFaults", () => {
  test("no switches, no wrapper: registrations go straight through", () => {
    const registered: Array<{ channel: string; listener: (...a: unknown[]) => unknown }> = [];
    const fake = {
      handle(channel: string, listener: (...a: unknown[]) => unknown) {
        registered.push({ channel, listener });
      },
    };

    installIpcFaults({
      env: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a stub for ipcMain
      ipc: fake as any,
      log: () => {},
    });

    fake.handle("catalog:list", () => "plain");
    expect(registered[0].listener()).toBe("plain");
  });

  test("a switch wraps every later registration, and says so", async () => {
    const logs: string[] = [];
    const registered: Array<{ channel: string; listener: (...a: unknown[]) => unknown }> = [];
    const fake = {
      handle(channel: string, listener: (...a: unknown[]) => unknown) {
        registered.push({ channel, listener });
      },
    };

    installIpcFaults({
      env: {
        ATR_FAIL_IPC: "process:list",
        ATR_DELAY_IPC: "catalog:get",
        ATR_DELAY_IPC_MS: "1500",
        ATR_FAULT_UNTIL: FLAG,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a stub for ipcMain
      ipc: fake as any,
      exists: () => true,
      sleep: async () => {},
      log: (message) => logs.push(message),
    });

    fake.handle("process:list", () => "rows");
    fake.handle("catalog:list", () => "repos");

    await expect(registered[0].listener()).rejects.toThrow(/on purpose/);
    await expect(registered[1].listener()).resolves.toBe("repos");

    // The one line an app under test prints, so a run that was meant to be
    // spoiled and was not is visible rather than silent.
    expect(logs.join("\n")).toContain("process:list");
    expect(logs.join("\n")).toContain("catalog:get");
    expect(logs.join("\n")).toContain(FLAG);
  });
});
