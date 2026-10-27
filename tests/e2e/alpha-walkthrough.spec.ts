/**
 * Alpha walkthrough — one deliberate pass over every desktop screen, clicking
 * each control once and recording what happened.
 *
 * Why this is a spec and not a script: the app boots through the same global
 * setup the rest of the suite uses (`_global-setup.ts` builds the seeded
 * profile and rebuilds `out/`), so a walkthrough run and a real E2E run start
 * from the same machine state. It is the LAST spec in this repo that reads the
 * running app rather than the source.
 *
 * Safety seams. Two families of controls launch things outside the app, and the
 * committed `launcher-flow.spec.ts` deliberately never clicks them:
 *
 *   1. `shell.openExternal` / `shell.showItemInFolder` / `clipboard.writeText`
 *      are replaced in the MAIN process right after launch. "Open in editor",
 *      "Reveal in Finder" and "Open remote" then record their intent instead of
 *      opening an editor / a Finder window / a browser tab.
 *   2. `PATH` is prefixed with a stub bin holding no-op `open` and `osascript`,
 *      so the terminal and Xcode dispatch paths (`spawn("open", …)`) resolve to
 *      a no-op rather than opening Terminal.app.
 *
 * The native folder picker (`settings:pickScanPath`) is likewise stubbed to
 * return a fixture directory instead of blocking on a modal sheet.
 *
 * Deferred on purpose, per the request: `/graph`, `/claude` and the repo
 * detail panel's Claude tab are never visited, and nothing mobile is touched.
 *
 * Output: `docs/audits/alpha-walkthrough/report.json`, a sibling `report.md`,
 * and numbered screenshots under `docs/audits/alpha-walkthrough/shots/`.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { test, type ConsoleMessage, type Page } from "@playwright/test";

import { launchApp } from "./_launch-app";

const REPO_ROOT = resolve(__dirname, "..", "..");
const OUT_DIR = join(REPO_ROOT, "docs", "audits", "alpha-walkthrough");
const SHOTS_DIR = join(OUT_DIR, "shots");

type Status = "ok" | "skipped" | "failed";

interface StepResult {
  index: number;
  id: string;
  label: string;
  status: Status;
  detail?: string;
  at: number;
}

interface ConsoleIssue {
  kind: "console" | "pageerror";
  text: string;
  step: string;
}

interface ScreenInventory {
  screen: string;
  buttons: number;
  links: number;
  inputs: number;
  selects: number;
  tabs: number;
  names: string[];
}

const steps: StepResult[] = [];
const issues: ConsoleIssue[] = [];
const inventories: ScreenInventory[] = [];
const shots: string[] = [];

let shotCounter = 0;
let currentStep = "boot";

function record(
  id: string,
  label: string,
  status: Status,
  detail?: string,
): void {
  steps.push({
    index: steps.length + 1,
    id,
    label,
    status,
    detail,
    at: Date.now(),
  });
}

/** Run one walkthrough step; never throw — record what happened instead. */
async function step(
  id: string,
  label: string,
  fn: () => Promise<string | void>,
): Promise<void> {
  currentStep = id;
  try {
    const detail = await fn();
    record(id, label, "ok", typeof detail === "string" ? detail : undefined);
  } catch (error) {
    record(id, label, "failed", error instanceof Error ? error.message : String(error));
  }
}

function skip(id: string, label: string, reason: string): void {
  record(id, label, "skipped", reason);
}

async function shot(win: Page, name: string): Promise<string> {
  const file = `${String(++shotCounter).padStart(3, "0")}-${name}.png`;
  await win.screenshot({ path: join(SHOTS_DIR, file) });
  shots.push(file);
  return file;
}

/**
 * A shallow map of everything interactive on the current screen — the evidence
 * behind "every button", captured on the rendered result, not the source.
 */
async function inventory(win: Page, screen: string): Promise<ScreenInventory> {
  const data = await win.evaluate(() => {
    const describe = (el: Element): string => {
      const aria = el.getAttribute("aria-label");
      if (aria) return aria;
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) return text.slice(0, 60);
      const ph = el.getAttribute("placeholder");
      if (ph) return `placeholder:${ph}`;
      return `<${el.tagName.toLowerCase()}>`;
    };
    const q = (sel: string) => Array.from(document.querySelectorAll(sel));
    const buttons = q("button:not([disabled])");
    const links = q("a[href]");
    const inputs = q("input, textarea");
    const selects = q("select");
    const tabs = q("[role=tab]");
    return {
      buttons: buttons.length,
      links: links.length,
      inputs: inputs.length,
      selects: selects.length,
      tabs: tabs.length,
      names: [...tabs, ...buttons, ...links]
        .map(describe)
        .filter(Boolean)
        .slice(0, 120),
    };
  });
  const inv: ScreenInventory = { screen, ...data };
  inventories.push(inv);
  return inv;
}

/**
 * Neutralise the main-process seams. Called immediately after launch so every
 * later click is safe. `shell` and `clipboard` are the same objects the bundled
 * services import, so replacing the methods reaches every call site.
 */
async function neutraliseSeams(
  app: import("@playwright/test").ElectronApplication,
): Promise<boolean> {
  await app.evaluate(({ shell, clipboard, dialog }, dir) => {
    const g = globalThis as unknown as { __atrWalkthrough?: Record<string, unknown[]> };
    const log = (g.__atrWalkthrough ??= { openExternal: [], showItemInFolder: [], clipboard: [] });
    shell.openExternal = (async (url: string) => {
      log.openExternal.push(url);
    }) as typeof shell.openExternal;
    shell.showItemInFolder = ((fullPath: string) => {
      log.showItemInFolder.push(fullPath);
      return true;
    }) as typeof shell.showItemInFolder;
    clipboard.writeText = ((text: string) => {
      log.clipboard.push(text);
    }) as typeof clipboard.writeText;
    // The native folder picker is modal and would block the run; answer it with
    // the fixture directory instead.
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [dir],
    })) as unknown as typeof dialog.showOpenDialog;
  }, FIXTURE_SCAN_DIR);
  // Verify the patch actually took: if the seam is not in place, clicking the
  // launcher icons would open real apps, so the caller must know.
  return app.evaluate(({ shell }) => /log\.openExternal|__atrWalkthrough/.test(String(shell.openExternal)));
}

let FIXTURE_SCAN_DIR = "";
let WORK_DIR = "";
let STUB_BIN = "";

/** A tiny git repo with something to run, so the TaskRunner has tasks. */
function makeRepoWithTasks(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name,
        version: "1.0.0",
        private: true,
        scripts: {
          dev: "node -e \"console.log('dev up')\"",
          build: "node -e \"console.log('built')\"",
          test: "node -e \"console.log('ok')\"",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(dir, "README.md"), `# ${name}\n\nSeeded for the walkthrough.\n`);
  spawnSync("git", ["add", "-A"], { cwd: dir });
  spawnSync(
    "git",
    [
      "-c",
      "user.email=walkthrough@example.com",
      "-c",
      "user.name=Walkthrough",
      "commit",
      "-q",
      "-m",
      "seed",
    ],
    { cwd: dir },
  );
}

test.describe("alpha walkthrough", () => {
  test.beforeAll(() => {
    mkdirSync(SHOTS_DIR, { recursive: true });
    WORK_DIR = mkdtempSync(join(tmpdir(), "atr-walkthrough-"));
    STUB_BIN = join(WORK_DIR, "stub-bin");
    mkdirSync(STUB_BIN, { recursive: true });
    for (const name of ["open", "osascript", "code", "cursor", "zed", "subl", "xed", "idea"]) {
      const file = join(STUB_BIN, name);
      writeFileSync(file, `#!/bin/sh\necho "[stub] ${name} $*" >> "${STUB_BIN}/calls.log"\nexit 0\n`);
      chmodSync(file, 0o755);
    }
    FIXTURE_SCAN_DIR = join(WORK_DIR, "scan-root");
    makeRepoWithTasks(join(FIXTURE_SCAN_DIR, "Fixture Alpha"), "fixture-alpha");
    makeRepoWithTasks(join(FIXTURE_SCAN_DIR, "Fixture Beta"), "fixture-beta");
  });

  test("clicks every desktop control once and records the result", async () => {
    const pathWithStubs = `${STUB_BIN}:${process.env.PATH ?? ""}`;
    const { app, close } = await launchApp({ env: { PATH: pathWithStubs } });

    const win = await app.firstWindow();
    const consoleErrors: string[] = [];
    const attachConsole = (page: Page): void => {
      page.on("console", (msg: ConsoleMessage) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (/Download the React DevTools|Electron Security Warning|Autofill\.enable/i.test(text)) {
          return;
        }
        consoleErrors.push(text);
        issues.push({ kind: "console", text, step: currentStep });
      });
      page.on("pageerror", (err) => {
        issues.push({ kind: "pageerror", text: err.message, step: currentStep });
      });
    };
    attachConsole(win);

    try {
      // ---------------------------------------------------------------- boot
      await step("boot", "App launches and paints the catalog", async () => {
        await win.waitForLoadState("domcontentloaded");
        await win.getByRole("link", { name: /^AllTheRepos$/i }).waitFor({ timeout: 45_000 });
        await win.waitForTimeout(1500);
        await shot(win, "catalog");
        await inventory(win, "catalog /");
      });
      const seamsOk = await neutraliseSeams(app);
      await step("seams", "Neutralise OS-launch seams (shell, clipboard, folder picker)", async () => {
        if (!seamsOk) throw new Error("main-process shell patch did not take — launcher clicks would open real apps");
        return "shell.openExternal / showItemInFolder / clipboard.writeText replaced in main; PATH prefixed with stub open/osascript";
      });

      // Seed the three template repos with a package.json so the detail panel's
      // Tasks section has something to render, then commit so they stay clean.
      await step("seed-tasks", "Give the seeded repos a package.json (so Tasks renders)", async () => {
        const repos = await win.evaluate(async () => {
          const atr = (window as unknown as { atr?: { catalog: { list: (i: unknown) => Promise<{ items: Array<{ slug: string; fullPath: string }> }> } } }).atr;
          if (!atr) return [];
          const res = await atr.catalog.list({ limit: 200 });
          return res.items.map((r) => ({ slug: r.slug, fullPath: r.fullPath }));
        });
        for (const repo of repos) {
          const pkg = join(repo.fullPath, "package.json");
          if (existsSync(pkg)) continue;
          writeFileSync(
            pkg,
            `${JSON.stringify({ name: repo.slug, version: "1.0.0", private: true, scripts: { dev: "node -e \"console.log('dev ready')\"", build: "node -e \"console.log('build ok')\"", test: "node -e \"console.log('tests pass')\"" } }, null, 2)}\n`,
          );
          spawnSync("git", ["add", "-A"], { cwd: repo.fullPath });
          spawnSync(
            "git",
            ["-c", "user.email=e2e@example.com", "-c", "user.name=E2E", "commit", "-q", "-m", "walkthrough tasks"],
            { cwd: repo.fullPath },
          );
        }
        return `${repos.length} repo(s) prepared`;
      });

      // ------------------------------------------------------- global chrome
      await step("chrome.sidebar", "Top bar: sidebar toggle (both ways)", async () => {
        const btn = win.getByRole("banner").getByRole("button", { name: /toggle sidebar/i });
        await btn.click();
        await win.waitForTimeout(400);
        await shot(win, "sidebar-collapsed");
        await btn.click();
        await win.waitForTimeout(400);
      });

      await step("chrome.home", "Top bar: AllTheRepos home link", async () => {
        await win.getByRole("banner").getByRole("link", { name: /^AllTheRepos$/i }).click();
        await win.waitForTimeout(600);
      });

      await step("chrome.search", "Top bar: search input — type, settle, clear", async () => {
        const input = win.getByRole("searchbox", { name: /search repos/i }).first();
        await input.click();
        await input.fill("demo");
        await win.waitForTimeout(900);
        await shot(win, "search-demo");
        const clear = win.getByRole("button", { name: /clear search/i });
        if (await clear.count()) {
          await clear.first().click();
        } else {
          await input.fill("");
        }
        await win.waitForTimeout(900);
        await input.press("Escape");
        await win.waitForTimeout(400);
      });

      await step("chrome.search-slash", "Keyboard: `/` focuses search", async () => {
        await win.keyboard.press("/");
        await win.waitForTimeout(300);
        const focused = await win.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
        if (!/search repos/i.test(focused)) throw new Error(`focus went to "${focused}"`);
      });

      await step("chrome.nav-running", "Top bar nav: Running → /processes", async () => {
        await win.getByRole("banner").getByRole("link", { name: /^running/i }).click();
        await win.getByRole("heading", { name: /^Running$/i }).waitFor({ timeout: 15_000 });
        await shot(win, "processes-empty-or-list");
        await inventory(win, "processes /processes");
      });

      await step("chrome.nav-settings", "Top bar nav: Settings → /settings", async () => {
        await win.getByRole("banner").getByRole("link", { name: /^settings$/i }).click();
        await win.getByRole("heading", { name: /^Settings$/i }).waitFor({ timeout: 15_000 });
        await win.waitForTimeout(1000);
        await shot(win, "settings");
        await inventory(win, "settings /settings");
      });

      await step("chrome.nav-debug", "Top bar dev door: Debug → /debug (unpackaged only)", async () => {
        const debug = win.getByRole("banner").getByRole("link", { name: /debug/i });
        if (!(await debug.count())) {
          skip("chrome.nav-debug", "Debug link", "no Debug affordance (packaged build)");
          return;
        }
        await debug.first().click();
        await win.getByRole("heading", { name: /^Debug$/i }).waitFor({ timeout: 15_000 });
        await win.getByText("system.ping", { exact: true }).first().waitFor({ timeout: 15_000 });
        await win.waitForTimeout(800);
        await shot(win, "debug");
        await inventory(win, "debug /debug");
      });

      await step("debug.ping", "/debug: Ping again", async () => {
        const ping = win.getByRole("button", { name: /ping again/i });
        if (!(await ping.count())) throw new Error("no Ping again button");
        await ping.first().click();
        await win.waitForTimeout(800);
        const text = await win.locator("body").innerText();
        if (!/pong/i.test(text)) throw new Error("no pong in the rendered response");
        await shot(win, "debug-ping");
      });

      await step("chrome.return-home", "Return to the catalog", async () => {
        await win.getByRole("banner").getByRole("link", { name: /^AllTheRepos$/i }).click();
        await win.waitForTimeout(800);
      });

      // -------------------------------------------------------- catalog views
      await step("toolbar.views", "Catalog toolbar: Index / Posters / Table view modes", async () => {
        const group = win.getByRole("group", { name: "View mode" });
        for (const label of ["Index", "Posters", "Table"]) {
          await group.getByRole("button", { name: new RegExp(`^${label}$`, "i") }).click();
          await win.waitForTimeout(500);
          await shot(win, `view-${label.toLowerCase()}`);
        }
        // leave on the index for the rest of the pass
        await group.getByRole("button", { name: /^Index$/i }).click();
        await win.waitForTimeout(400);
      });

      await step("toolbar.group", "Catalog toolbar: every Group option", async () => {
        const select = win.getByLabel(/^group$/i);
        for (const value of ["folder", "ownership", "activity", "language", "none"]) {
          await select.selectOption(value);
          await win.waitForTimeout(350);
        }
        await select.selectOption("folder");
        await win.waitForTimeout(300);
      });

      await step("toolbar.sort", "Catalog toolbar: every Sort option + reverse", async () => {
        const select = win.getByLabel(/^sort$/i);
        for (const value of ["name", "size", "language", "folder", "owner", "touched"]) {
          await select.selectOption(value);
          await win.waitForTimeout(300);
        }
        const reverse = win.getByRole("button", { name: /click to reverse/i });
        await reverse.click();
        await win.waitForTimeout(300);
        await reverse.click();
        await win.waitForTimeout(300);
      });

      await step("toolbar.archived", "Catalog toolbar: Archived toggle (if offered)", async () => {
        const archived = win.getByRole("button", { name: /^archived/i });
        if (!(await archived.count())) {
          skip("toolbar.archived", "Archived toggle", "no archived repos in the seeded catalog");
          return;
        }
        await archived.first().click();
        await win.waitForTimeout(400);
        await archived.first().click();
        await win.waitForTimeout(400);
      });

      await step("toolbar.fetch", "Catalog toolbar: Fetch", async () => {
        await win.locator('button[title^="Fetch remote refs"]').first().click();
        await win.waitForTimeout(2500);
        const status = win.getByRole("status").first();
        const text = (await status.count()) ? await status.innerText() : "(no status strip)";
        await shot(win, "fetch-result");
        return text.replace(/\s+/g, " ").slice(0, 160);
      });

      await step("toolbar.pull", "Catalog toolbar: Pull", async () => {
        await win.locator('button[title^="Fast-forward these repos"]').first().click();
        await win.waitForTimeout(2500);
        const status = win.getByRole("status").first();
        const text = (await status.count()) ? await status.innerText() : "(no status strip)";
        await shot(win, "pull-result");
        return text.replace(/\s+/g, " ").slice(0, 160);
      });

      await step("toolbar.dismiss-notice", "Catalog: dismiss a transient notice, if any", async () => {
        const dismiss = win.getByRole("button", { name: /^Dismiss$/i });
        const n = await dismiss.count();
        if (!n) {
          skip("toolbar.dismiss-notice", "Dismiss notice", "no notice strip visible");
          return;
        }
        for (let i = 0; i < n; i++) {
          await dismiss.first().click();
          await win.waitForTimeout(200);
        }
      });

      // ------------------------------------------------------------- rail
      await step("rail.views", "Rail: All repos / Favourites / Mine / Local only / Cloned", async () => {
        const rail = win.getByRole("navigation", { name: /catalog filters and folders/i });
        for (const name of [/^All repos/i, /^Favourites/i, /^Mine/i, /^Local only/i, /^Cloned/i]) {
          const btn = rail.getByRole("button", { name });
          if (await btn.count()) {
            await btn.first().click();
            await win.waitForTimeout(300);
          }
        }
        const uncommitted = rail.getByRole("button", { name: /^Uncommitted/i });
        if (await uncommitted.count()) {
          await uncommitted.first().click();
          await win.waitForTimeout(300);
        }
        await shot(win, "rail-filters");
        await rail.getByRole("button", { name: /^All repos/i }).first().click();
        await win.waitForTimeout(300);
      });

      await step("rail.add-folder", "Rail: Add folder to scan (picker stubbed to the fixture)", async () => {
        const add = win.getByRole("button", { name: /add folder to scan/i });
        if (!(await add.count())) throw new Error("no Add folder to scan button");
        await add.first().click();
        await win.waitForTimeout(6000);
        const text = await win.locator("body").innerText();
        if (!/Fixture Alpha|Fixture Beta/i.test(text)) throw new Error("fixture repos did not appear after the scan");
        await shot(win, "rail-after-add-folder");
        return "fixture scan root added and scanned";
      });

      await step("rail.scan-root-menu", "Rail: scan-root menu — Scan now", async () => {
        const rail = win.getByRole("navigation", { name: /catalog filters and folders/i });
        const trigger = rail.getByRole("button", { name: /actions for scan folder/i }).first();
        if (!(await trigger.count())) throw new Error("no scan-root menu trigger");
        await trigger.click();
        await win.waitForTimeout(400);
        await shot(win, "rail-scan-menu");
        await win.getByRole("menuitem", { name: /scan now/i }).click();
        await win.waitForTimeout(3000);
      });

      await step("rail.stop-scanning-dialog", "Rail: Stop scanning dialog — both radio options, then Cancel", async () => {
        const trigger = win
          .getByRole("navigation", { name: /catalog filters and folders/i })
          .getByRole("button", { name: /actions for scan folder/i })
          .first();
        await trigger.click();
        await win.waitForTimeout(300);
        await win.getByRole("menuitem", { name: /stop scanning/i }).click();
        await win.waitForTimeout(500);
        await shot(win, "stop-scanning-dialog");
        const radios = win.getByRole("radio");
        const n = await radios.count();
        for (let i = 0; i < n; i++) {
          await radios.nth(i).click();
          await win.waitForTimeout(150);
        }
        await win.getByRole("button", { name: /^Cancel$/i }).click();
        await win.waitForTimeout(400);
      });

      await step("rail.directly-in-folder", "Rail: 'directly in this folder' row (if present)", async () => {
        const row = win.getByRole("button", { name: /directly in this folder/i });
        if (!(await row.count())) {
          skip("rail.directly-in-folder", "directly in this folder", "not offered for this root");
          return;
        }
        await row.first().click();
        await win.waitForTimeout(400);
        await shot(win, "rail-directly-in-folder");
        await win.getByRole("navigation", { name: /catalog filters and folders/i })
          .getByRole("button", { name: /^All repos/i })
          .first()
          .click();
        await win.waitForTimeout(300);
      });

      // -------------------------------------------------------- repo cards
      await step("card.select-each", "Catalog: select every repo card (opens the detail panel)", async () => {
        const cards = win.locator("[data-repo-slug]");
        const total = await cards.count();
        if (total === 0) throw new Error("no repo cards rendered");
        for (let i = 0; i < Math.min(total, 8); i++) {
          const card = cards.nth(i);
          await card.scrollIntoViewIfNeeded();
          await card.click();
          await win.waitForTimeout(700);
        }
        await shot(win, "card-selected");
        await inventory(win, "catalog with detail panel");
        return `${total} cards rendered, clicked through`;
      });

      await step("panel.close", "Detail panel: close button", async () => {
        const close = win.getByRole("button", { name: /close detail panel/i });
        if (!(await close.count())) throw new Error("no close button");
        await close.first().click();
        await win.waitForTimeout(500);
      });

      await step("card.favorite", "Repo card: favourite star on / off", async () => {
        await win.locator("[data-repo-slug]").first().click();
        await win.waitForTimeout(500);
        const star = win.getByRole("button", { name: /^(pin|unpin) /i }).first();
        if (!(await star.count())) throw new Error("no favourite star");
        await star.click();
        await win.waitForTimeout(600);
        await star.click();
        await win.waitForTimeout(600);
      });

      await step("card.launcher-buttons", "Repo card: every launcher icon", async () => {
        if (!seamsOk) {
          skip("card.launcher-buttons", "launcher icons", "seams not neutralised — skipped to avoid opening real apps");
          return;
        }
        const card = win.locator("[data-repo-slug]").first();
        const labels: Array<[RegExp, string]> = [
          [/^open in editor$/i, "editor"],
          [/^open in terminal$/i, "terminal"],
          [/^reveal in finder$/i, "finder"],
          [/^open remote/i, "remote"],
          [/^copy path$/i, "copy"],
        ];
        const seen: string[] = [];
        for (const [re, name] of labels) {
          const btn = card.getByRole("button", { name: re });
          if (!(await btn.count())) {
            seen.push(`${name}:missing`);
            continue;
          }
          await btn.first().click();
          await win.waitForTimeout(700);
          seen.push(name);
        }
        await shot(win, "card-launcher");
        return seen.join(", ");
      });

      await step("card.multi-select", "Repo card: cmd-click multi-select, then Clear selection", async () => {
        const cards = win.locator("[data-repo-slug]");
        if ((await cards.count()) < 2) throw new Error("need two cards");
        await cards.nth(0).click({ modifiers: ["Meta"] });
        await win.waitForTimeout(300);
        await cards.nth(1).click({ modifiers: ["Meta"] });
        await win.waitForTimeout(400);
        const clear = win.getByRole("button", { name: /clear selection/i });
        if (!(await clear.count())) throw new Error("no Clear selection control after multi-select");
        await shot(win, "multi-select");
        await clear.first().click();
        await win.waitForTimeout(300);
      });

      await step("table.interactions", "Table view: column sort + row select + star", async () => {
        await win.getByRole("group", { name: "View mode" }).getByRole("button", { name: /^Table$/i }).click();
        await win.waitForTimeout(500);
        for (const col of [/^Project$/i, /^Owner$/i, /^Language$/i, /^Size$/i, /^Touched$/i]) {
          const h = win.getByRole("button", { name: col });
          if (await h.count()) {
            await h.first().click();
            await win.waitForTimeout(250);
          }
        }
        const name = win.locator("table tbody tr button").first();
        await name.click();
        await win.waitForTimeout(500);
        await shot(win, "table-selected");
        const star = win.locator("table tbody tr").first().getByRole("button", { name: /^(pin|unpin) /i });
        if (await star.count()) {
          await star.first().click();
          await win.waitForTimeout(300);
          await star.first().click();
          await win.waitForTimeout(300);
        }
        await win.getByRole("group", { name: "View mode" }).getByRole("button", { name: /^Grid$/i }).click();
        await win.waitForTimeout(400);
      });

      // ------------------------------------------------------- detail panel
      await step("panel.tabs", "Detail panel: Details tab (Claude tab deferred)", async () => {
        await win.locator("[data-repo-slug]").first().click();
        await win.waitForTimeout(600);
        const tabs = win.getByRole("tab");
        const n = await tabs.count();
        const details = win.getByRole("tab", { name: /^Details$/i });
        if (await details.count()) await details.first().click();
        await win.waitForTimeout(300);
        await shot(win, "panel-details");
        return `${n} tab(s) present; Claude tab left alone on purpose`;
      });

      await step("panel.tags", "Detail panel: add a tag, then remove it", async () => {
        // The tag composer is behind the Tags header's "Add" now.
        const panel = win.getByRole("complementary", { name: /repo detail/i });
        const reveal = panel.getByRole("button", { name: "Add", exact: true });
        if (await reveal.count()) await reveal.first().click();
        const input = win.getByRole("textbox", { name: /new tag/i });
        if (!(await input.count())) throw new Error("no New tag input");
        await input.first().fill("walkthrough-tag");
        await win.getByRole("button", { name: /^Add tag$/i }).first().click();
        await win.waitForTimeout(900);
        const remove = win.getByRole("button", { name: /remove tag walkthrough-tag/i });
        if (!(await remove.count())) throw new Error("tag did not appear");
        await shot(win, "panel-tag-added");
        await remove.first().click();
        await win.waitForTimeout(900);
      });

      await step("panel.related-assert", "Detail panel: Related → Add → assert a link", async () => {
        const add = win.getByRole("button", { name: /assert a relationship/i });
        if (!(await add.count())) throw new Error("no Related 'Add' button");
        await add.first().click();
        await win.waitForTimeout(600);
        const search = win.getByRole("textbox", { name: /which repository/i });
        await search.fill("Fixture");
        await win.waitForTimeout(1200);
        await shot(win, "curate-link-dialog");
        const hit = win.locator("[role=dialog] button", { hasText: /Fixture/i }).first();
        if (!(await hit.count())) throw new Error("no target repo in the picker");
        await hit.click();
        await win.waitForTimeout(300);
        const why = win.getByRole("textbox", { name: /^why$/i });
        await why.fill("walkthrough assertion");
        await win.waitForTimeout(300);
        await win.getByRole("button", { name: /assert link/i }).click();
        await win.waitForTimeout(1500);
        const text = await win.locator("aside, [role=dialog]").first().innerText();
        if (!/walkthrough assertion|Fixture/i.test(text)) throw new Error("asserted link not visible");
        await shot(win, "related-asserted");
      });

      await step("panel.related-remove", "Detail panel: remove the curated link", async () => {
        const remove = win.getByRole("button", { name: /^Remove link/i });
        if (!(await remove.count())) {
          skip("panel.related-remove", "Remove link", "the asserted link was not listed");
          return;
        }
        await remove.first().click();
        await win.waitForTimeout(1200);
      });

      await step("panel.tasks", "Detail panel: Tasks — expand, run, stop, clear output", async () => {
        const toggle = win.getByRole("button", { name: /^Tasks/i });
        if (!(await toggle.count())) {
          skip("panel.tasks", "Task runner", "no tasks declared for this repo");
          return;
        }
        await toggle.first().click();
        await win.waitForTimeout(600);
        await shot(win, "panel-tasks-open");
        const run = win.getByRole("button", { name: /^Run dev$/i });
        if (!(await run.count())) throw new Error("no Run dev button");
        await run.first().click();
        await win.waitForTimeout(2500);
        await shot(win, "panel-task-running");
        const stop = win.getByRole("button", { name: /^Stop dev$/i });
        if (await stop.count()) {
          await stop.first().click();
          await win.waitForTimeout(1200);
        }
        const clear = win.getByRole("button", { name: /clear output/i });
        if (await clear.count()) {
          await clear.first().click();
          await win.waitForTimeout(400);
        }
      });

      await step("panel.footer", "Detail panel: Open in editor + open full detail page", async () => {
        const open = win.getByRole("button", { name: /with the default editor/i });
        if (await open.count()) {
          await open.first().click();
          await win.waitForTimeout(800);
        }
        const full = win.getByRole("link", { name: /open full detail page/i });
        if (!(await full.count())) throw new Error("no open-full-detail-page link");
        await full.first().click();
        await win.url().includes("/repos/");
        await win.waitForTimeout(1200);
        await shot(win, "repo-detail-page");
        await inventory(win, "repo detail /repos/:slug");
        const back = win.getByRole("link", { name: /back to catalog/i });
        await back.first().click();
        await win.waitForTimeout(800);
      });

      // ----------------------------------------------------------- processes
      let serverPid: number | null = null;
      await step("processes.start-server", "Processes: start a dev server so a row exists", async () => {
        const repoDir = await win.evaluate(async () => {
          const atr = (window as unknown as { atr?: { catalog: { list: (i: unknown) => Promise<{ items: Array<{ fullPath: string }> }> } } }).atr;
          if (!atr) return null;
          const res = await atr.catalog.list({ limit: 200 });
          return res.items[0]?.fullPath ?? null;
        });
        if (!repoDir) throw new Error("could not resolve a repo dir");
        const hasPython = spawnSync("python3", ["--version"]).status === 0;
        if (!hasPython) {
          skip("processes.start-server", "dev server", "python3 not available");
          return;
        }
        const child = spawn("python3", ["-m", "http.server", "8791"], {
          cwd: repoDir,
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        serverPid = child.pid ?? null;
        await win.waitForTimeout(2000);
        return `server pid ${serverPid} in ${repoDir}`;
      });

      await step("processes.refresh", "Processes: Refresh + copy URL + Kill (confirm dialog)", async () => {
        await win.getByRole("banner").getByRole("link", { name: /^running/i }).click();
        await win.getByRole("heading", { name: /^Running$/i }).waitFor({ timeout: 15_000 });
        await win.waitForTimeout(2000);
        const refresh = win.getByRole("button", { name: /^Refresh$/i });
        if (await refresh.count()) {
          await refresh.first().click();
          await win.waitForTimeout(3000);
        }
        await shot(win, "processes-with-row");
        const copy = win.getByRole("button", { name: /copy url for port/i });
        if (await copy.count()) {
          await copy.first().click();
          await win.waitForTimeout(400);
        }
        const kill = win.getByRole("button", { name: /^Kill PID/i });
        if (await kill.count()) {
          await kill.first().click();
          await win.waitForTimeout(500);
          await shot(win, "process-kill-confirm");
          const confirm = win.getByRole("button", { name: /^Kill process$/i });
          if (await confirm.count()) {
            await confirm.click();
            await win.waitForTimeout(2000);
          }
        } else {
          throw new Error("no process row appeared for the started server");
        }
        if (serverPid) {
          try {
            process.kill(serverPid, "SIGKILL");
          } catch {
            /* already gone */
          }
        }
      });

      // ------------------------------------------------------------ settings
      await step("settings.scan-paths", "Settings: add a scan path, then remove it", async () => {
        await win.getByRole("banner").getByRole("link", { name: /^settings$/i }).click();
        await win.getByRole("heading", { name: /^Settings$/i }).waitFor({ timeout: 15_000 });
        await win.waitForTimeout(800);
        const input = win.getByRole("textbox", { name: /new scan path/i });
        await input.fill("/tmp/atr-walkthrough-settings-demo");
        await win.getByRole("button", { name: /^Add path$/i }).click();
        await win.waitForTimeout(1200);
        const remove = win.getByRole("button", { name: /^Remove scan path \/tmp\/atr-walkthrough-settings-demo$/i });
        if (!(await remove.count())) throw new Error("added path did not render its remove control");
        await shot(win, "settings-scan-path-added");
        await remove.first().click();
        await win.waitForTimeout(1200);
      });

      await step("settings.embeddings", "Settings: embeddings inputs", async () => {
        await win.getByLabel(/ollama base url/i).fill("http://localhost:11434");
        await win.getByLabel(/ollama model/i).fill("nomic-embed-text");
        await win.getByLabel(/openai model/i).fill("");
        await win.waitForTimeout(300);
      });

      await step("settings.launcher-defaults", "Settings: default editor + terminal selects", async () => {
        const editor = win.getByLabel(/default editor/i);
        const editorValues = await editor.locator("option").evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
        const pickEditor = editorValues.find((v) => v !== "none") ?? "none";
        await editor.selectOption(pickEditor);
        await win.waitForTimeout(900);
        const terminal = win.getByLabel(/default terminal/i);
        const terminalValues = await terminal.locator("option").evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
        const pickTerminal = terminalValues.find((v) => v !== "") ?? "";
        await terminal.selectOption(pickTerminal);
        await win.waitForTimeout(900);
        await shot(win, "settings-launcher");
        return `editor=${pickEditor}, terminal=${pickTerminal || "(auto)"}`;
      });

      await step("settings.identities", "Settings: add an identity, then remove it", async () => {
        const input = win.getByRole("textbox", { name: /add a git handle/i });
        await input.fill("walkthrough-handle");
        await win.getByRole("button", { name: /^Add$/i }).first().click();
        await win.waitForTimeout(700);
        const remove = win.getByRole("button", { name: /remove identity walkthrough-handle/i });
        if (!(await remove.count())) throw new Error("identity chip did not render");
        await remove.first().click();
        await win.waitForTimeout(700);
      });

      await step("settings.check-updates", "Settings: Check for updates", async () => {
        const check = win.getByRole("button", { name: /check for updates/i });
        if (!(await check.count())) throw new Error("no Check for updates button");
        await check.first().click();
        await win.waitForTimeout(4000);
        await shot(win, "settings-updates");
        const text = await win.locator("body").innerText();
        const line = text.split("\n").find((l) => /latest release|Version /i.test(l)) ?? "";
        return line.slice(0, 120);
      });

      await step("settings.save", "Settings: Save settings", async () => {
        await win.getByRole("button", { name: /save settings/i }).click();
        await win.waitForTimeout(1500);
        await shot(win, "settings-saved");
      });

      await step("settings.scan-now", "Settings: Scan now", async () => {
        const scan = win.getByRole("button", { name: /^Scan now$/i });
        if (await scan.isDisabled()) {
          skip("settings.scan-now", "Scan now", "no scan paths configured");
          return;
        }
        await scan.click();
        await win.waitForTimeout(8000);
        await shot(win, "settings-scan-done");
        const text = await win.locator("body").innerText();
        const line = text.split("\n").find((l) => /Completed|Scanning|failed/i.test(l)) ?? "";
        return line.slice(0, 160);
      });

      // ------------------------------------------------- from the keyboard
      await step("keys.jk-enter-esc", "Keyboard: j / k navigate, Enter opens, Esc closes", async () => {
        await win.getByRole("banner").getByRole("link", { name: /^AllTheRepos$/i }).click();
        await win.waitForTimeout(700);
        await win.locator("body").click({ position: { x: 600, y: 400 } });
        await win.keyboard.press("j");
        await win.waitForTimeout(400);
        await win.keyboard.press("j");
        await win.waitForTimeout(400);
        await win.keyboard.press("k");
        await win.waitForTimeout(400);
        await win.keyboard.press("Escape");
        await win.waitForTimeout(400);
        await shot(win, "keyboard-nav");
      });

      await step("keys.chord-gs", "Keyboard: g s chord → Settings", async () => {
        await win.getByRole("banner").getByRole("link", { name: /^AllTheRepos$/i }).click();
        await win.waitForTimeout(700);
        await win.locator("body").click({ position: { x: 600, y: 400 } });
        await win.keyboard.press("g");
        await win.keyboard.press("s");
        await win.waitForTimeout(900);
        const hash = await win.evaluate(() => window.location.hash);
        if (!hash.includes("/settings")) throw new Error(`chord did not reach settings (hash ${hash})`);
        await win.getByRole("banner").getByRole("link", { name: /^AllTheRepos$/i }).click();
        await win.waitForTimeout(700);
      });

      // ------------------------------------------------------ command palette
      await step("palette.open", "Command palette: Cmd+K opens it", async () => {
        await win.keyboard.press("Meta+k");
        await win.waitForTimeout(800);
        const dialog = win.getByRole("dialog", { name: /command palette/i });
        if (!(await dialog.count())) throw new Error("palette did not open");
        await shot(win, "command-palette");
        await inventory(win, "command palette");
        const items = await win.locator("[cmdk-item]").evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()));
        return items.slice(0, 20).join(" | ");
      });

      for (const [id, label] of [
        ["palette.open-settings", "Open Settings"],
        ["palette.refresh", "Refresh Catalog"],
        ["palette.focus-search", "Focus Search"],
        ["palette.toggle-sidebar", "Toggle Sidebar"],
        ["palette.open-debug", "Open Debug Page"],
        ["palette.open-spotlight", "Open Spotlight"],
        ["palette.toggle-devtools", "Toggle DevTools"],
      ] as Array<[string, string]>) {
        await step(id, `Command palette: run "${label}"`, async () => {
          await win.getByRole("banner").getByRole("link", { name: /^AllTheRepos$/i }).click().catch(() => undefined);
          await win.waitForTimeout(400);
          await win.keyboard.press("Meta+k");
          await win.waitForTimeout(600);
          const item = win.locator("[cmdk-item]", { hasText: label }).first();
          if (!(await item.count())) throw new Error(`palette item "${label}" not offered`);
          await item.click();
          await win.waitForTimeout(1500);
          // A few actions open a second window (Spotlight) or a devtools pane.
          const pages = app.windows();
          if (pages.length > 1) {
            const extra = pages.find((p) => p !== win);
            if (extra) {
              await shot(extra, `palette-${id}-window`);
              await extra.close().catch(() => undefined);
            }
          }
          if (/toggle-devtools/i.test(id)) {
            await win.keyboard.press("Meta+k");
            await win.waitForTimeout(500);
            const again = win.locator("[cmdk-item]", { hasText: label }).first();
            if (await again.count()) await again.click();
            await win.waitForTimeout(600);
          }
          if (/open-settings/i.test(id)) {
            await win.getByRole("banner").getByRole("link", { name: /^AllTheRepos$/i }).click().catch(() => undefined);
            await win.waitForTimeout(600);
          }
        });
      }

      // ------------------------------------------------------------- teardown
      await step("teardown.home", "Return to the catalog and settle", async () => {
        await win.getByRole("banner").getByRole("link", { name: /^AllTheRepos$/i }).click().catch(() => undefined);
        await win.waitForTimeout(1200);
        await shot(win, "final-catalog");
      });
    } finally {
      // Persist the report before closing so a mid-run failure still writes it.
      const summary = {
        ranAt: new Date().toISOString(),
        totals: {
          steps: steps.length,
          ok: steps.filter((s) => s.status === "ok").length,
          failed: steps.filter((s) => s.status === "failed").length,
          skipped: steps.filter((s) => s.status === "skipped").length,
          consoleErrors: consoleErrors.length,
          pageErrors: issues.filter((i) => i.kind === "pageerror").length,
        },
        screenshots: shots.length,
        steps,
        issues,
        inventories,
        stubBinCalls: (() => {
          const log = join(STUB_BIN, "calls.log");
          if (!existsSync(log)) return [];
          try {
            return readFileSync(log, "utf8").split("\n").filter(Boolean);
          } catch {
            return [];
          }
        })(),
        seams: await app
          .evaluate(() => {
            const g = globalThis as unknown as { __atrWalkthrough?: Record<string, unknown[]> };
            return g.__atrWalkthrough ?? {};
          })
          .catch(() => ({})),
      };
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(join(OUT_DIR, "report.json"), `${JSON.stringify(summary, null, 2)}\n`);

      const md: string[] = [];
      md.push("# Alpha walkthrough — Electron desktop pass");
      md.push("");
      md.push(`Ran ${summary.ranAt}. Deferred: graph, Claude panel, mobile.`);
      md.push("");
      md.push(
        `**${summary.totals.ok} ok · ${summary.totals.failed} failed · ${summary.totals.skipped} skipped · ${summary.totals.consoleErrors} console errors · ${summary.screenshots} screenshots**`,
      );
      md.push("");
      md.push("| # | step | result | detail |");
      md.push("|---|------|--------|--------|");
      for (const s of steps) {
        md.push(
          `| ${s.index} | ${s.label} | ${s.status === "ok" ? "✅" : s.status === "skipped" ? "⏭️" : "❌"} | ${(s.detail ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")} |`,
        );
      }
      if (issues.length) {
        md.push("");
        md.push("## Console / page errors");
        md.push("");
        for (const i of issues) md.push(`- **${i.step}** (${i.kind}): ${i.text}`);
      }
      md.push("");
      md.push("## Seam activity (what OS launches were \u2014 deliberately \u2014 intercepted)");
      md.push("");
      md.push("```json");
      md.push(JSON.stringify(summary.seams, null, 2));
      md.push("```");
      writeFileSync(join(OUT_DIR, "report.md"), `${md.join("\n")}\n`);

      await close();
    }
  });
});
