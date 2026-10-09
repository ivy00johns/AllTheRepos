/**
 * Workstream B E2E — the seven P2 findings (ATR-063…069), on the built app.
 *
 * Two of these live in states the first paint never reaches: the failed read
 * and the read still in flight. Reading the JSX would not show whether they
 * render, so they are forced here — from the main process, because the renderer
 * side is closed to us on purpose.
 *
 * ## Why the failure is injected in main
 *
 * `window.atr` is exposed by `contextBridge`, which freezes it: the object, its
 * namespaces and its methods are all non-writable, and the global property is
 * non-configurable. A spec cannot stub a read from the renderer. What it can do
 * is take the real `ipcMain` handler for one channel out of the registry, hold
 * it, and register a replacement that fails — so the app's own query, retry and
 * error paths all run unchanged, and only the transport between them is
 * replaced. The channel names here are read off `IPC` in `src/shared/ipc.ts`.
 *
 * ## What each test is proving
 *
 *   - ATR-063 — a failed read offers a way out, and taking it recovers.
 *   - ATR-064 — the wait is the catalog's skeleton, not a bare sentence.
 *   - ATR-065 — the range selector answers the keys a radio is expected to.
 *   - ATR-066 — the table row is a container and the project name is the control.
 *   - ATR-067 — kill asks through the shared dialog, and cancelling cancels.
 *   - ATR-068 — the active segment is an accent, and the control is 32px.
 *   - ATR-069 — a graph node can be selected without a pointer.
 *
 * Owner: qe-agent (Workstream B).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

import { TEMPLATE_PROFILE_ENV, launchApp } from "./_launch-app";

/**
 * The read each route depends on, as `ipcMain` registers it. One route, one
 * channel — so breaking one cannot accidentally break another.
 */
const CHANNEL = {
  repo: "catalog:get",
  settings: "settings:get",
  processes: "process:list",
  /** `/processes` also asks for a sweep on mount; both feed the same view. */
  processSweep: "process:refresh",
} as const;

const ERROR_TEXT = "simulated IPC failure";

/**
 * The element every skeleton state wears: an `aria-busy` region holding at
 * least one pulse block. `aria-busy` alone also matches the Refresh button
 * while it sweeps, hence the `:has(...)`.
 */
const SKELETON = '[aria-busy="true"]:has(.animate-pulse)';

// ---------------------------------------------------------------------------
// Injecting a failing read
// ---------------------------------------------------------------------------

/**
 * Hold on to the real handler for each channel.
 *
 * `ipcMain` exposes no public way to read back a registered handler, so the
 * only route to a temporary replacement is the registry itself. The private
 * field is asserted rather than assumed: if a future Electron renames it, this
 * fails as a clear "the helper is stale" instead of a spec that injects nothing
 * and passes.
 */
async function stashHandlers(
  app: ElectronApplication,
  channels: string[],
): Promise<void> {
  const result = await app.evaluate(({ ipcMain }, names) => {
    const registry = (
      ipcMain as unknown as { _invokeHandlers?: Map<string, unknown> }
    )._invokeHandlers;
    if (!(registry instanceof Map)) {
      return { reachable: false, missing: [] as string[] };
    }
    const globals = globalThis as unknown as {
      __atrRealHandlers?: Record<string, unknown>;
      __atrGates?: Record<string, () => void>;
    };
    const stash = (globals.__atrRealHandlers ??= {});
    globals.__atrGates ??= {};
    const missing: string[] = [];
    for (const name of names) {
      const handler = registry.get(name);
      if (handler) stash[name] = handler;
      else missing.push(name);
    }
    return { reachable: true, missing };
  }, channels);

  expect(
    result.reachable,
    "ipcMain's handler registry is not reachable — the swap helper needs rewriting before this spec proves anything",
  ).toBe(true);
  expect(result.missing, "no handler registered for these channels").toEqual([]);
}

/** Make one read fail, in front of its real handler. */
async function failHandler(
  app: ElectronApplication,
  channel: string,
): Promise<void> {
  await app.evaluate(({ ipcMain }, name) => {
    ipcMain.removeHandler(name);
    ipcMain.handle(name, () => {
      throw new Error("simulated IPC failure");
    });
  }, channel);
}

/**
 * Park one read until {@link releaseHandler} is called for the same gate.
 *
 * A *timed* replacement races the boot that precedes the assertion: the app has
 * to launch, paint the catalog and navigate before the read may answer, and
 * under load that race is lost — the read lands first, the loading state is
 * never on screen, and the test fails for a reason that has nothing to do with
 * the code. Holding the read open makes the state stable for as long as the
 * spec needs it, and releasing it is then what proves the page was waiting on
 * that read and not on a timer.
 */
async function holdHandler(
  app: ElectronApplication,
  channel: string,
  gate: string,
): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { name, id }) => {
      const globals = globalThis as unknown as {
        __atrRealHandlers: Record<string, (...args: unknown[]) => unknown>;
        __atrGates: Record<string, () => void>;
      };
      const real = globals.__atrRealHandlers[name];
      ipcMain.removeHandler(name);
      ipcMain.handle(name, async (...args: unknown[]) => {
        await new Promise<void>((resume) => {
          globals.__atrGates[id] = resume;
        });
        return real(...args);
      });
    },
    { name: channel, id: gate },
  );
}

/**
 * Let a parked read through, and put the real handler back so the app's own
 * polling behaves normally afterwards.
 */
async function releaseHandler(
  app: ElectronApplication,
  channel: string,
  gate: string,
): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { name, id }) => {
      const globals = globalThis as unknown as {
        __atrRealHandlers: Record<string, (...args: unknown[]) => unknown>;
        __atrGates: Record<string, () => void>;
      };
      const resume = globals.__atrGates[id];
      delete globals.__atrGates[id];
      ipcMain.removeHandler(name);
      ipcMain.handle(name, globals.__atrRealHandlers[name]);
      resume?.();
    },
    { name: channel, id: gate },
  );
}

/** Put the real handler back, so the retry has something to talk to. */
async function restoreHandler(
  app: ElectronApplication,
  channel: string,
): Promise<void> {
  await app.evaluate(({ ipcMain }, name) => {
    const globals = globalThis as unknown as {
      __atrRealHandlers: Record<string, (...args: unknown[]) => unknown>;
    };
    ipcMain.removeHandler(name);
    ipcMain.handle(name, globals.__atrRealHandlers[name]);
  }, channel);
}

// ---------------------------------------------------------------------------
// Driving the app
// ---------------------------------------------------------------------------

/** The catalog has painted: the shell is up and there is a row to work with. */
async function expectCatalog(win: Page): Promise<void> {
  await expect(win.getByRole("link", { name: /^AllTheRepos$/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(win.locator("[data-repo-slug]").first()).toBeVisible({
    timeout: 20_000,
  });
}

/** Click a top-bar destination the way a person does. */
async function goTo(win: Page, label: RegExp): Promise<void> {
  await win.getByRole("banner").getByRole("link", { name: label }).click();
}

/**
 * Reach `/repos/$slug` through the app's own deep link.
 *
 * The route is a page inside the app rather than an address to type; the
 * detail panel's "open the full page" link only exists once the repo it
 * would open has loaded — which is exactly the state under test; and the tray
 * and Claude tables only link to repos they can match. `alltherepos://repo/<slug>`
 * is the one route onto that page that does not depend on the read, and it is
 * the route the page documents itself as existing for.
 */
async function openRepoPage(
  app: ElectronApplication,
  slug: string,
): Promise<void> {
  await app.evaluate(
    ({ webContents }, payload) => {
      for (const contents of webContents.getAllWebContents()) {
        if (!contents.isDestroyed()) {
          contents.send("protocol:on:deep-link", payload);
        }
      }
    },
    { path: `repo/${slug}`, params: { slug } },
  );
}

/** Every seeded repo's slug, in the order the catalog draws them. */
async function catalogSlugs(win: Page): Promise<string[]> {
  await expectCatalog(win);
  const slugs = await win
    .locator("[data-repo-slug]")
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-repo-slug") ?? ""),
    );
  return slugs.filter(Boolean);
}

// ---------------------------------------------------------------------------
// ATR-063 / ATR-064 — a read that fails, and a read in flight
// ---------------------------------------------------------------------------

test("a repo page shows a skeleton while it reads and a retry when it cannot (ATR-063, ATR-064)", async () => {
  // Two forced reads plus two route loads do not fit the default 60s when the
  // suite is running while the machine is busy.
  test.setTimeout(120_000);
  const { app, close } = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    const [waitingSlug, failingSlug] = await catalogSlugs(win);
    expect(
      waitingSlug && failingSlug,
      "the template profile must carry at least two repos — one read is held, the other failed",
    ).toBeTruthy();

    await stashHandlers(app, [CHANNEL.repo]);

    // --- The wait. This is the state a first paint cannot reach. ---
    await holdHandler(app, CHANNEL.repo, "repo-read");
    await openRepoPage(app, waitingSlug);

    await expect(
      win.locator(SKELETON),
      "the repo page painted no skeleton while its read was in flight",
    ).toBeVisible({ timeout: 15_000 });
    // The announcement stays behind the placeholder blocks.
    await expect(win.getByText("Loading repo…")).toBeAttached();

    // Letting the read through is what proves it was the thing being awaited.
    await releaseHandler(app, CHANNEL.repo, "repo-read");
    await expect(
      win.getByRole("link", { name: /back to catalog/i }),
      "the released read never resolved into the repo page",
    ).toBeVisible({ timeout: 20_000 });

    // --- The failure. A different repo, so its query has never been cached. ---
    await failHandler(app, CHANNEL.repo);
    await openRepoPage(app, failingSlug);

    await expect(
      win.getByText(ERROR_TEXT),
      "a failed catalog read rendered no error at all",
    ).toBeVisible({ timeout: 20_000 });

    const retry = win.getByRole("button", { name: /^try again$/i });
    await expect(
      retry,
      "the failed repo page offered no way out — this is the finding",
    ).toBeVisible();

    // Taking it recovers the page once the transport is healthy again.
    await restoreHandler(app, CHANNEL.repo);
    await retry.click();
    await expect(
      win.getByRole("link", { name: /back to catalog/i }),
      "the retry did not recover the repo page",
    ).toBeVisible({ timeout: 20_000 });
    await expect(win.getByText(ERROR_TEXT)).toBeHidden();
  } finally {
    await close();
  }
});

test("settings shows a skeleton while it reads and a retry when it cannot (ATR-063, ATR-064)", async () => {
  test.setTimeout(120_000);
  const { app, close } = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await expectCatalog(win);

    await stashHandlers(app, [CHANNEL.settings]);

    // Settings is read by the shell at boot, so the cache has to go before a
    // fresh read can be watched. A reload also resets the router to `/`.
    await holdHandler(app, CHANNEL.settings, "settings-read");
    await win.reload();
    await win.waitForLoadState("domcontentloaded");
    await expectCatalog(win);
    await goTo(win, /^settings$/i);

    await expect(
      win.locator(SKELETON),
      "settings showed no skeleton while its read was in flight",
    ).toBeVisible({ timeout: 15_000 });
    await expect(win.getByText("Loading settings…")).toBeAttached();

    await releaseHandler(app, CHANNEL.settings, "settings-read");
    const form = win.getByText("Scan paths");
    await expect(
      form,
      "the released settings read never resolved into the form",
    ).toBeVisible({ timeout: 20_000 });

    // --- The failure. ---
    await failHandler(app, CHANNEL.settings);
    await win.reload();
    await win.waitForLoadState("domcontentloaded");
    await expectCatalog(win);
    await goTo(win, /^settings$/i);

    await expect(win.getByText(ERROR_TEXT)).toBeVisible({ timeout: 20_000 });
    const retry = win.getByRole("button", { name: /^try again$/i });
    await expect(
      retry,
      "failed settings offered no way out — this is the finding",
    ).toBeVisible();
    await expect(form).toBeHidden();

    await restoreHandler(app, CHANNEL.settings);
    await retry.click();
    await expect(
      form,
      "the retry did not recover settings",
    ).toBeVisible({ timeout: 20_000 });
  } finally {
    await close();
  }
});

test("processes shows a skeleton while it reads and a retry when it cannot (ATR-063, ATR-064)", async () => {
  test.setTimeout(120_000);
  const { app, close } = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await expectCatalog(win);

    // The route sweeps on mount as well as reading the snapshot, and the sweep
    // writes what it finds straight into the same cache — so holding the list
    // back alone would still be overtaken by rows.
    await stashHandlers(app, [CHANNEL.processes, CHANNEL.processSweep]);
    await holdHandler(app, CHANNEL.processes, "process-list");
    await holdHandler(app, CHANNEL.processSweep, "process-sweep");

    await win.reload();
    await win.waitForLoadState("domcontentloaded");
    await expectCatalog(win);
    await goTo(win, /^running/i);

    await expect(
      win.locator(SKELETON),
      "processes showed no skeleton while its read was in flight",
    ).toBeVisible({ timeout: 15_000 });
    await expect(win.getByText("Loading processes…")).toBeAttached();

    await releaseHandler(app, CHANNEL.processes, "process-list");
    await releaseHandler(app, CHANNEL.processSweep, "process-sweep");

    // Either outcome of a real sweep is the list landing; what matters here is
    // that it replaced the placeholder.
    await expect(
      win.locator(SKELETON),
      "the released process read never resolved",
    ).toBeHidden({ timeout: 20_000 });

    // --- The failure. ---
    await failHandler(app, CHANNEL.processes);
    await win.reload();
    await win.waitForLoadState("domcontentloaded");
    await expectCatalog(win);
    await goTo(win, /^running/i);

    await expect(
      win.getByText("Failed to read process snapshot"),
    ).toBeVisible({ timeout: 20_000 });
    const retry = win.getByRole("button", { name: /^try again$/i });
    await expect(
      retry,
      "a failed process snapshot offered no way out — this is the finding",
    ).toBeVisible();

    // The 5s heartbeat is a second route back to a healthy view, so recovery is
    // asserted after restoring rather than attributed to the button alone; the
    // settings test above is where the retry is provably the only way out.
    await restoreHandler(app, CHANNEL.processes);
    await retry.click();
    await expect(
      win.getByText("Failed to read process snapshot"),
    ).toBeHidden({ timeout: 20_000 });
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// ATR-065 — the range selector answers the keys a radio is expected to
// ---------------------------------------------------------------------------

test("the Claude range selector is a real radiogroup (ATR-065)", async () => {
  const { app, close } = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await expectCatalog(win);

    await goTo(win, /^claude$/i);
    const group = win.getByRole("radiogroup", { name: "Date range" });
    await expect(group).toBeVisible({ timeout: 20_000 });
    const radios = group.getByRole("radio");
    await expect(radios).toHaveCount(4);

    /** Which radio is the group's single tab stop. */
    const tabbable = await radios.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("tabindex")),
    );
    expect(
      tabbable.filter((value) => value === "0"),
      `a radiogroup is one tab stop, not four — tabindex is ${JSON.stringify(tabbable)}`,
    ).toHaveLength(1);

    // 7d · 30d · 90d · All time, with 30d the default. Indexed rather than
    // filtered: a `{ checked: true }` locator re-resolves as the selection
    // moves, so it cannot be asked what the selection *was*.
    const LABELS = ["7 days", "30 days", "90 days", "All time"];
    const radio = (index: number) => group.getByRole("radio").nth(index);
    const checkedIndex = async (): Promise<number> => {
      const flags = await group.getByRole("radio").evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("aria-checked") === "true"),
      );
      return flags.indexOf(true);
    };
    await expect(radio(1)).toHaveText(LABELS[1]!);
    expect(await checkedIndex()).toBe(1);
    expect(await radio(1).getAttribute("tabindex")).toBe("0");

    await radio(1).focus();

    // ArrowRight moves to the next radio and selects it.
    await win.keyboard.press("ArrowRight");
    expect(await checkedIndex()).toBe(2);
    expect(
      await radio(2).evaluate((node) => node === document.activeElement),
      "ArrowRight selected the next range without focusing it",
    ).toBe(true);
    expect(await radio(2).getAttribute("tabindex")).toBe("0");
    expect(await radio(1).getAttribute("tabindex")).toBe("-1");

    // End and Home jump to the ends; the arrows wrap.
    await win.keyboard.press("End");
    expect(await checkedIndex()).toBe(3);
    await win.keyboard.press("ArrowRight");
    expect(await checkedIndex()).toBe(0);
    await win.keyboard.press("Home");
    expect(await checkedIndex()).toBe(0);
    await win.keyboard.press("ArrowLeft");
    expect(await checkedIndex()).toBe(3);
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// ATR-066 — the row is a container, the name is the control
// ---------------------------------------------------------------------------

test("the table's repo name is the control and the row is not (ATR-066)", async () => {
  const { app, close } = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    const slugs = await catalogSlugs(win);
    const slug = slugs[0]!;

    await win
      .getByRole("group", { name: "View mode" })
      .getByRole("button", { name: "Table" })
      .click();

    const row = win.locator(`tbody tr[data-repo-slug="${slug}"]`);
    await expect(row).toBeVisible({ timeout: 10_000 });

    // The row is furniture: no tab stop, no role claiming to be a control.
    expect(
      await row.getAttribute("tabindex"),
      "the table row is a tab stop again",
    ).toBeNull();
    expect(await row.getAttribute("role")).toBeNull();
    expect(
      await win.locator("tbody tr[tabindex]").count(),
      "rows are still in the tab order",
    ).toBe(0);

    // The name is the control, and it has a name. The star in the same cell
    // carries an `aria-label`; the name button is the one that does not.
    const name = row.locator("td:first-child button:not([aria-label])").first();
    await expect(name).toHaveText(/\S/);
    await name.focus();
    await expect(name).toBeFocused();

    // Space works now — it did nothing on the row, and Enter-only was the old shape.
    await win.keyboard.press("Space");
    await expect(
      row,
      "Space on the repo name did not select the row",
    ).toHaveAttribute("data-selected", "true", { timeout: 10_000 });

    // And tabbing off it never lands on the row itself.
    await name.focus();
    await win.keyboard.press("Tab");
    const nextTag = await win.evaluate(() => document.activeElement?.tagName ?? "");
    expect(
      ["BUTTON", "A", "INPUT", "SELECT"],
      `Tab landed on a <${nextTag}> after the project name`,
    ).toContain(nextTag);
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// ATR-067 — kill asks through the shared dialog
// ---------------------------------------------------------------------------

/** Where `_global-setup.ts` put the seeded repos — one of them hosts the probe. */
function seededRepoDir(name: string): string {
  const template = process.env[TEMPLATE_PROFILE_ENV];
  if (!template) {
    throw new Error(
      `[workstream-b] ${TEMPLATE_PROFILE_ENV} is unset — run this spec through Playwright so _global-setup.ts can build the seeded profile.`,
    );
  }
  const dir = join(dirname(template), "repos", name);
  if (!existsSync(dir)) {
    throw new Error(`[workstream-b] seeded repo not found: ${dir}`);
  }
  return dir;
}

test("killing a process asks through the dialog, and cancelling leaves it running (ATR-067)", async () => {
  test.setTimeout(180_000);

  const { app, close } = await launchApp();
  const repoDir = seededRepoDir("demo-cli");
  let child: ChildProcess | null = null;

  try {
    // A real listener inside a seeded repo: it is the only way to have both a
    // table row and a port chip on a card, which are the finding's two sites.
    child = spawn(
      process.execPath,
      [
        "-e",
        "const s=require('http').createServer((q,r)=>r.end('ok'));s.listen(0,()=>{console.log('PORT='+s.address().port);});",
      ],
      { cwd: repoDir, stdio: ["ignore", "pipe", "ignore"] },
    );

    const port = await new Promise<number>((resolvePort, rejectPort) => {
      const timer = setTimeout(
        () => rejectPort(new Error("http server didn't print PORT in 3s")),
        3_000,
      );
      child!.stdout?.on("data", (buffer: Buffer) => {
        const match = buffer.toString("utf8").match(/PORT=(\d+)/);
        if (match?.[1]) {
          clearTimeout(timer);
          resolvePort(parseInt(match[1], 10));
        }
      });
      child!.once("exit", (code) => {
        clearTimeout(timer);
        rejectPort(new Error(`probe server exited early (code ${code ?? "null"})`));
      });
    });

    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await expectCatalog(win);

    // --- Site one: the process table. ---
    await goTo(win, /^running/i);
    await expect(
      win.getByRole("heading", { name: /^processes$/i }),
    ).toBeVisible({ timeout: 20_000 });

    const refresh = win.getByRole("button", { name: /^refresh$/i });
    await expect(refresh).toBeEnabled({ timeout: 20_000 });
    const row = win
      .locator("tbody tr")
      .filter({ has: win.locator(`span:text-is("${port}")`) })
      .filter({ has: win.locator(`td:text-is("${child.pid}")`) });

    await expect(async () => {
      await refresh.click();
      await expect(row).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    // The row's repo cell is the link the card has to match, so read the slug
    // off it rather than guessing which seeded repo the sweep bound it to.
    const repoLink = row.locator("td:first-child a");
    const href = await repoLink.getAttribute("href");
    const slug = href?.split("/").pop() ?? "";
    expect(slug, `no repo slug on the row's link (href ${href})`).not.toBe("");

    const killButton = row.getByRole("button", {
      name: new RegExp(`^kill pid ${child.pid}$`, "i"),
    });
    await killButton.click();

    const dialog = win.getByRole("alertdialog");
    await expect(
      dialog,
      "killing asked no question at all — or asked it outside the shared dialog",
    ).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByRole("heading")).toHaveText(
      new RegExp(`kill pid ${child.pid}`, "i"),
    );
    await expect(dialog).toContainText("SIGINT");

    // Escape dismisses it, and the process survives — the dialog is a gate, not
    // a notification.
    await win.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await refresh.click();
    await expect(row, "the process died on an Escape").toBeVisible({
      timeout: 20_000,
    });

    // Re-open and take the explicit way out.
    await killButton.click();
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: /^cancel$/i }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    await refresh.click();
    await expect(
      row,
      "the process died on Cancel — the confirmation is not gating anything",
    ).toBeVisible({ timeout: 20_000 });
    expect(child.exitCode, "the probe server was killed despite cancelling").toBeNull();

    // --- Site two: the port chip on the repo card. ---
    await goTo(win, /^AllTheRepos$/i);
    const card = win.locator(`[data-repo-slug="${slug}"]`);
    await expect(card).toBeVisible({ timeout: 20_000 });

    const chip = card.getByRole("button", {
      name: new RegExp(`^port ${port} actions`, "i"),
    });
    await expect(
      chip,
      "no port chip on the card — the second kill site cannot be reached",
    ).toBeVisible({ timeout: 20_000 });
    await chip.click();
    await win.getByRole("menuitem", { name: /kill process/i }).click();

    await expect(
      win.getByRole("alertdialog"),
      "the port chip still asked through a native confirm instead of the dialog",
    ).toBeVisible({ timeout: 10_000 });
    await win
      .getByRole("alertdialog")
      .getByRole("button", { name: /^cancel$/i })
      .click();
    await expect(win.getByRole("alertdialog")).toBeHidden({ timeout: 10_000 });
    expect(child.exitCode, "cancelling from the port chip killed the process").toBeNull();
  } finally {
    child?.kill("SIGKILL");
    await close();
  }
});

// ---------------------------------------------------------------------------
// ATR-068 — the active segment reads as active
// ---------------------------------------------------------------------------

interface SegmentMetrics {
  activeColor: string;
  inactiveColor: string;
  activeBackground: string;
  inactiveBackground: string;
  activeHeight: number;
  accent: string;
}

/** Measure the active/inactive pair inside one segmented control. */
async function segmentMetrics(
  win: Page,
  group: string,
): Promise<SegmentMetrics> {
  /*
   * `.atr-segment` transitions colour over 150ms, and Chromium reports the
   * interpolated colour — so a read taken just after a click, or with the
   * pointer still resting on the control, returns a frame mid-transition and
   * two different states look alike. Park the pointer, then hold the
   * transitions still for the duration of the read.
   */
  await win.mouse.move(0, 0);
  await win.addStyleTag({
    content: "*,*::before,*::after{transition:none !important}",
  });
  return win.evaluate((label) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-accent)";
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();

    const scope = document.querySelector(`[aria-label="${label}"]`);
    const active = scope?.querySelector<HTMLElement>(
      '.atr-segment[data-active="true"]',
    );
    const inactive = scope?.querySelector<HTMLElement>(
      '.atr-segment[data-active="false"]',
    );
    if (!active || !inactive) {
      throw new Error(`no active/inactive .atr-segment pair inside "${label}"`);
    }
    const a = getComputedStyle(active);
    const i = getComputedStyle(inactive);
    return {
      activeColor: a.color,
      inactiveColor: i.color,
      activeBackground: a.backgroundColor,
      inactiveBackground: i.backgroundColor,
      activeHeight: active.getBoundingClientRect().height,
      accent,
    };
  }, group);
}

test("an active segment reads as active on both toolbars (ATR-068)", async () => {
  const { app, close } = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await expectCatalog(win);

    // The catalog's view modes.
    const toolbar = await segmentMetrics(win, "View mode");
    expect(
      toolbar.activeColor,
      `the active view mode is not the accent — ${toolbar.activeColor} against ${toolbar.accent}`,
    ).toBe(toolbar.accent);
    expect(toolbar.activeColor).not.toBe(toolbar.inactiveColor);
    expect(
      toolbar.activeBackground,
      "the active view mode sits on the same background as its neighbours",
    ).not.toBe(toolbar.inactiveBackground);
    expect(
      toolbar.activeHeight,
      "the segmented control is back under the app's control height",
    ).toBeGreaterThanOrEqual(32);

    // The map's signal filters — the class is shared, so it has to move with it.
    await goTo(win, /^map$/i);
    const signalGroup = win.getByRole("group", {
      name: "Relationship signals",
    });
    await expect(signalGroup).toBeVisible({ timeout: 20_000 });
    // Every signal starts switched on, so there is no inactive segment to read
    // against until one is turned off.
    await signalGroup.getByRole("button", { name: /name family/i }).click();

    const signals = await segmentMetrics(win, "Relationship signals");
    expect(signals.activeColor).toBe(signals.accent);
    expect(signals.activeBackground).not.toBe(signals.inactiveBackground);
    expect(signals.activeHeight).toBeGreaterThanOrEqual(32);
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// ATR-069 — a node can be selected without a pointer
// ---------------------------------------------------------------------------

test("a graph node can be reached and selected from the keyboard (ATR-069)", async () => {
  const { app, close } = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await expectCatalog(win);

    await goTo(win, /^map$/i);
    const listbox = win.getByRole("listbox", {
      name: "Repositories on the map",
    });
    await expect(
      listbox,
      "the map offers no keyboard path to a node",
    ).toBeVisible({ timeout: 20_000 });

    const options = listbox.getByRole("option");
    await expect(options).toHaveCount(3, { timeout: 20_000 });

    const stops = await options.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("tabindex")),
    );
    expect(
      stops.filter((value) => value === "0"),
      `the node list is one tab stop, not ${stops.length} — tabindex is ${JSON.stringify(stops)}`,
    ).toHaveLength(1);

    await options.nth(0).focus();
    await win.keyboard.press("ArrowDown");

    const selected = options.nth(1);
    await expect(selected).toHaveAttribute("aria-selected", "true");
    expect(await selected.evaluate((node) => node === document.activeElement)).toBe(true);

    // Selecting drives the same inspector the map does.
    const name = (await selected.innerText()).replace(/\s*\d+$/, "").trim();
    await expect(
      win.getByRole("heading", { name }),
      "the inspector never described the node the list selected",
    ).toBeVisible({ timeout: 10_000 });

    // Home/End reach the ends.
    await win.keyboard.press("End");
    await expect(options.nth(2)).toHaveAttribute("aria-selected", "true");
    await win.keyboard.press("Home");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  } finally {
    await close();
  }
});
