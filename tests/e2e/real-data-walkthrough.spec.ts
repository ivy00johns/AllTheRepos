/**
 * Real-data walkthrough — drives the developer's OWN catalog.
 *
 * Unlike `alpha-walkthrough.spec.ts` (which uses the suite's seeded 3-repo
 * template), this launches against a **copy** of the real application profile,
 * so the catalog is the developer's actual library and nothing in the original
 * profile, its database or its settings can be touched.
 *
 * Two things are deliberately NOT clicked, because the profile copy does not
 * contain them:
 *
 *   - **Kill process** (the /processes rows and the port chip on a repo card):
 *     it signals a real OS process. A copied profile does not make that safe.
 *   - **Scan now** against the real scan paths: read-only on disk, but it walks
 *     the entire library. The spec re-points the (copied) settings at a tiny
 *     fixture directory first, so the button is exercised without the sweep.
 *
 * `Stop scanning` and `Remove from catalog` mutate only the copy's SQLite rows
 * and settings; they are exercised and then left alone.
 *
 * Output: `docs/audits/real-data-walkthrough/`.
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  _electron as electron,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = join(REPO_ROOT, "out", "main", "index.js");
const REAL_PROFILE = join(homedir(), "Library", "Application Support", "alltherepos");

const OUT_DIR = join(REPO_ROOT, "docs", "audits", "real-data-walkthrough");
const SHOTS = join(OUT_DIR, "shots");

/** The slice of the preload bridge this spec reads from the renderer. */
interface AtrLike {
  catalog: {
    list: (input: { limit: number; offset?: number }) => Promise<{
      items: Array<{ name: string; slug: string }>;
      /** The catalog-wide count for the same filters, independent of the page. */
      total: number;
    }>;
  };
}

type Status = "ok" | "skipped" | "failed";
interface Step {
  n: number;
  id: string;
  label: string;
  status: Status;
  detail?: string;
}

const steps: Step[] = [];
const issues: string[] = [];
const dangerNotFired: string[] = [];
const shots: string[] = [];

let current = "boot";
let n = 0;

function push(id: string, label: string, status: Status, detail?: string): void {
  steps.push({ n: ++n, id, label, status, detail });
}

async function step(
  id: string,
  label: string,
  fn: () => Promise<string | void>,
): Promise<void> {
  current = id;
  const before = steps.length;
  try {
    const d = await fn();
    // A step that decided to skip has already recorded itself; don't also
    // record an "ok" for doing nothing.
    const last = steps[steps.length - 1];
    if (steps.length > before && last?.id === id && last.status === "skipped") return;
    push(id, label, "ok", typeof d === "string" ? d : undefined);
  } catch (e) {
    push(id, label, "failed", e instanceof Error ? e.message : String(e));
  }
}

function skip(id: string, label: string, why: string): void {
  push(id, label, "skipped", why);
}

let shotN = 0;
async function shot(win: Page, name: string): Promise<void> {
  const file = `${String(++shotN).padStart(3, "0")}-${name}.png`;
  await win.screenshot({ path: join(SHOTS, file) });
  shots.push(file);
}

/** Copy just the profile files the app needs out of a 163 MB directory. */
function copyRealProfile(): string {
  const dest = mkdtempSync(join(tmpdir(), "atr-real-profile-"));
  // Only the database itself, not its `-wal`/`-shm` sidecars: those are
  // transient, and copying a stale pair into a fresh directory makes the app
  // open a database whose write-ahead log it did not create.
  const wanted = [
    "alltherepos.db",
    "settings.json",
    "MIGRATED",
    "window-memory.json",
  ];
  let copied = 0;
  for (const f of wanted) {
    const from = join(REAL_PROFILE, f);
    if (!existsSync(from)) continue;
    cpSync(from, join(dest, f));
    copied++;
  }
  console.log(`[real] copied ${copied} file(s) of the real profile into ${dest}`);
  return dest;
}

function makeGitRepo(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: dir });
  // Two scripts, because the task runner's Stop needs something that stays up:
  // `dev` prints and exits, `serve` sleeps two minutes so Stop has a target.
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name,
        version: "1.0.0",
        private: true,
        scripts: {
          dev: "node -e \"console.log('walkthrough-ok')\"",
          serve: "node -e \"setTimeout(() => {}, 120000)\"",
        },
      },
      null,
      2,
    )}\n`,
  );
  spawnSync("git", ["add", "-A"], { cwd: dir });
  spawnSync(
    "git",
    ["-c", "user.email=walkthrough@example.com", "-c", "user.name=Walkthrough", "commit", "-q", "-m", "seed"],
    { cwd: dir },
  );
}

async function main(): Promise<void> {
  // Rebuild the shot directory from scratch. Screenshots are numbered by the
  // order the steps run, so a file left behind by an older revision sits beside
  // the current ones under a number that now belongs to a different step.
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  const work = mkdtempSync(join(tmpdir(), "atr-real-"));
  const stubBin = join(work, "bin");
  mkdirSync(stubBin, { recursive: true });
  for (const name of ["open", "osascript", "code", "cursor", "zed", "subl", "xed"]) {
    const f = join(stubBin, name);
    writeFileSync(f, `#!/bin/sh\necho "[stub] ${name} $*" >> "${stubBin}/calls.log"\nexit 0\n`);
    chmodSync(f, 0o755);
  }
  const fixtureRoot = join(work, "fixture-scan-root");
  makeGitRepo(join(fixtureRoot, "Walkthrough Fixture"), "walkthrough-fixture");

  const profile = copyRealProfile();
  const seams: Record<string, unknown[]> = {};

  const app: ElectronApplication = await electron.launch({
    // `-ApplePersistenceIgnoreState YES` is not cosmetic here. Once macOS has
    // recorded a crash for this bundle, AppKit opens a modal "reopen windows?"
    // alert (`NSPersistentUIRestorer promptToIgnorePersistentStateWithCrashHistory`
    // → `NSAlert runModal`) *before* the window exists. It blocks the main
    // thread, so `firstWindow()` never resolves and the launch looks hung —
    // the app is fine, the prompt is. Nothing can dismiss it over the debugger
    // protocol, so switch the whole restore/prompt path off. Verified: with the
    // flag the profile gains `Local Storage`/`Preferences`, without it, nothing.
    args: [
      MAIN_ENTRY,
      `--user-data-dir=${profile}`,
      "-ApplePersistenceIgnoreState",
      "YES",
      "-NSQuitAlwaysKeepsWindows",
      "NO",
    ],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ATR_E2E: "1",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
      PATH: `${stubBin}:${process.env.PATH ?? ""}`,
    },
  });

  // `firstWindow()` defaults to 30 s, and this app's cold start is ~22 s
  // (ATR-055) — too close for comfort even now that the modal alert is gone.
  // Close the app explicitly if no window ever arrives: an orphaned child keeps
  // the Playwright worker alive, so the run hangs forever with no error text.
  let win: Page;
  try {
    win = await app.firstWindow({ timeout: 150_000 });
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
  // Real repos embed README badges and images on hosts the app's CSP blocks
  // (and cover files that are simply absent). Those are reported separately so
  // a genuinely broken script is not buried in badge noise.
  const COSMETIC = /Content Security Policy|ERR_FILE_NOT_FOUND|Failed to load resource/i;
  const cosmetic: string[] = [];
  win.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/React DevTools|Security Warning/i.test(m.text())) return;
    if (COSMETIC.test(m.text())) {
      cosmetic.push(m.text());
      return;
    }
    issues.push(`[${current}] ${m.text()}`);
  });
  win.on("pageerror", (e) => issues.push(`[${current}] pageerror: ${e.message}`));

  try {
    // Neutralise the OS-launch seams and the folder picker.
    await app.evaluate(({ shell, clipboard, dialog }, dir) => {
      const g = globalThis as unknown as { __real?: Record<string, unknown[]> };
      const log = (g.__real ??= { openExternal: [], showItemInFolder: [], clipboard: [] });
      shell.openExternal = (async (u: string) => void log.openExternal.push(u)) as never;
      shell.showItemInFolder = ((p: string) => {
        log.showItemInFolder.push(p);
        return true;
      }) as never;
      clipboard.writeText = ((t: string) => void log.clipboard.push(t)) as never;
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as never;
    }, fixtureRoot);
    const seamsOk = await app.evaluate(({ shell }) =>
      /showItemInFolder|openExternal/.test(String(shell.openExternal)),
    );

    await step("launch", "Boot against the real profile (copied)", async () => {
      await win.waitForLoadState("domcontentloaded");
      await win.getByRole("link", { name: /^AllTheRepos$/i }).waitFor({ timeout: 60_000 });
      // The real profile remembers its last route; force the catalog so this is
      // a catalog pass and not wherever the developer left the window.
      await win.getByRole("banner").getByRole("link", { name: /^AllTheRepos$/i }).click();
      await win.waitForTimeout(4000);
      await shot(win, "real-catalog");
      const hash = await win.evaluate(() => window.location.hash);
      if (hash && !hash.startsWith("#/")) throw new Error(`landed on ${hash}`);
      const debugLink = await win.getByRole("banner").getByRole("link", { name: /debug/i }).count();
      return `seams ${seamsOk ? "ok" : "NOT neutralised"}; Debug affordance: ${debugLink}`;
    });

    await step(
      "catalog.size",
      "Catalog: rail, toolbar and grid agree — nothing lost past one page",
      async () => {
        const stats = await win.evaluate(async () => {
          const atr = (window as unknown as { atr: AtrLike }).atr;
          // `total` is the catalog-wide count; `items` is only one page, which
          // is the whole point — one capped request could never hold them all.
          const first = await atr.catalog.list({ limit: 200 });
          // Page two is exactly the rows a single capped read could not show.
          const page2 =
            first.total > 200
              ? await atr.catalog.list({ limit: 200, offset: 200 })
              : { items: [] as Array<{ slug: string }> };

          const cardEls = Array.from(
            document.querySelectorAll<HTMLElement>("[data-repo-slug]"),
          );
          const cardSlugs = new Set(cardEls.map((el) => el.dataset.repoSlug ?? ""));

          // The rail's "All repos" row, and the number in its badge.
          const railBtn = Array.from(
            document.querySelectorAll<HTMLElement>("button"),
          ).find((el) => /^All repos/.test((el.textContent ?? "").trim()));
          const railCount = Number(
            (railBtn?.textContent ?? "").match(/(\d+)\s*$/)?.[1] ?? "NaN",
          );

          // The toolbar's count: `N repos`, or `X of N` when a filter is on.
          const countEl = Array.from(
            document.querySelectorAll<HTMLElement>("span"),
          ).find((el) => /^(?:\d+ repos|\d+ of \d+)$/.test((el.textContent ?? "").trim()));
          const countText = (countEl?.textContent ?? "").trim();
          const of = countText.match(/^(\d+) of (\d+)$/);
          const only = countText.match(/^(\d+) repos$/);

          return {
            total: first.total,
            cards: cardEls.length,
            page2Total: page2.items.length,
            page2Rendered: page2.items.filter((i) => cardSlugs.has(i.slug)).length,
            railCount,
            countText,
            toolbarShown: of ? Number(of[1]) : only ? Number(only[1]) : NaN,
            toolbarTotal: of ? Number(of[2]) : only ? Number(only[1]) : NaN,
            sample: first.items.slice(0, 8).map((i: { name: string }) => i.name),
          };
        });
        console.log(
          `[real] catalog: ${JSON.stringify(stats.sample)} (db ${stats.total}, cards ${stats.cards}, rail ${stats.railCount}, toolbar "${stats.countText}", page2 ${stats.page2Rendered}/${stats.page2Total})`,
        );
        if (stats.total === 0) throw new Error("the real catalog is empty");
        if (!Number.isFinite(stats.railCount)) {
          throw new Error("the rail has no count badge for All repos");
        }
        if (!Number.isFinite(stats.toolbarTotal)) {
          throw new Error(`no repo count found in the toolbar ("${stats.countText}")`);
        }
        // The bug: three surfaces, three different numbers. They must agree.
        if (stats.railCount !== stats.total) {
          throw new Error(
            `rail says ${stats.railCount} but the catalog holds ${stats.total}`,
          );
        }
        if (stats.toolbarTotal !== stats.total) {
          throw new Error(
            `toolbar total is ${stats.toolbarTotal} but the catalog holds ${stats.total}`,
          );
        }
        if (stats.cards !== stats.toolbarShown) {
          throw new Error(
            `grid renders ${stats.cards} cards but the toolbar claims ${stats.toolbarShown} shown`,
          );
        }
        // The reachability half: rows past the 200-row page must be on screen.
        if (stats.page2Total > 0 && stats.page2Rendered === 0) {
          throw new Error(
            `none of the ${stats.page2Total} repos past row 200 are rendered — the list is capped at one page`,
          );
        }

        // And the difference must have a door. Whatever the grid does not show,
        // the Archived toggle has to account for exactly, and be able to
        // reveal — otherwise "238 of 273" is a number with 35 repos behind a
        // wall.
        const archivedBtn = win.getByRole("button", { name: /^Archived/ }).first();
        let archivedCount = 0;
        let archivedRevealed = stats.cards;
        if ((await archivedBtn.count()) > 0) {
          archivedCount = Number(
            (await archivedBtn.innerText()).match(/\((\d+)\)/)?.[1] ?? "0",
          );
          if (stats.cards + archivedCount !== stats.total) {
            throw new Error(
              `grid ${stats.cards} + Archived ${archivedCount} ≠ catalog ${stats.total} — ` +
                `${stats.total - stats.cards - archivedCount} repo(s) have no door`,
            );
          }
          await archivedBtn.click();
          await win.waitForTimeout(900);
          archivedRevealed = await win.locator("[data-repo-slug]").count();
          await archivedBtn.click();
          await win.waitForTimeout(700);
          if (archivedRevealed !== stats.total) {
            throw new Error(
              `Archived revealed ${archivedRevealed} cards but the catalog holds ${stats.total}`,
            );
          }
        } else if (stats.cards !== stats.total) {
          throw new Error(
            `the grid shows ${stats.cards} of ${stats.total} and there is no Archived toggle to reveal the rest`,
          );
        }

        await win.evaluate(() => {
          (window as unknown as { __names?: string[] }).__names = undefined;
        });
        return `${stats.total} repos · rail ${stats.railCount} · toolbar "${stats.countText}" · page 2 on screen ${stats.page2Rendered}/${stats.page2Total} · archived ${archivedCount} revealed ${archivedRevealed}`;
      },
    );

    await step(
      "catalog.explain",
      "The count explains the difference and can clear it",
      async () => {
        // The count is a control now: it names the filters hiding repos and
        // offers to clear them, rather than leaving `238 of 273` to be
        // reverse-engineered from the rail, the chips and the search box.
        const countBtn = win.getByRole("button", {
          name: /\d+ of \d+ repos shown/i,
        });
        if ((await countBtn.count()) === 0) {
          throw new Error(
            "the count that differs from the catalog is not an explanatory control",
          );
        }
        // A second, independent filter, so the ranking and the arithmetic are
        // exercised on real numbers rather than on a list of one.
        const mine = win
          .getByRole("navigation", { name: /catalog filters and folders/i })
          .getByRole("button", { name: /^Mine/i });
        if ((await mine.count()) === 0) {
          throw new Error("the rail has no Mine view to filter by");
        }
        await mine.first().click();
        await win.waitForTimeout(1200);

        await countBtn.first().click();
        await win.waitForTimeout(600);
        const strip = win.locator("#catalog-hidden-reasons");
        await strip.waitFor({ timeout: 5_000 });
        const stripText = (await strip.innerText()).replace(/\s+/g, " ").trim();
        await shot(win, "real-hidden-reasons");
        // Archived is what is keeping repos out of the default view.
        if (!/Archived/.test(stripText)) {
          throw new Error(
            `the strip does not name the archived filter: "${stripText}"`,
          );
        }

        const shown = await win.locator("[data-repo-slug]").count();
        const total = await win.evaluate(async () => {
          const atr = (window as unknown as { atr: AtrLike }).atr;
          return (await atr.catalog.list({ limit: 1 })).total;
        });

        // Every chip carries its own count, those counts are ranked by impact,
        // and together they must account for the whole difference — that is the
        // claim the count is making, so it is the claim to check.
        const hiddenCounts = await win
          .locator("#catalog-hidden-reasons [data-hidden-count]")
          .evaluateAll((els) =>
            els.map((el) => Number(el.getAttribute("data-hidden-count") ?? "0")),
          );
        if (hiddenCounts.length < 2) {
          throw new Error(
            `expected both the archive and the owner view to be hiding repos, ` +
              `but the strip listed ${hiddenCounts.length} reason(s): "${stripText}"`,
          );
        }
        if (hiddenCounts.some((n) => !Number.isFinite(n) || n <= 0)) {
          throw new Error(`a chip carries a useless count: ${hiddenCounts.join(", ")}`);
        }
        if (hiddenCounts.some((n, i) => i > 0 && hiddenCounts[i - 1] < n)) {
          throw new Error(
            `the chips are not ranked by impact: ${hiddenCounts.join(" then ")}`,
          );
        }
        const accounted = hiddenCounts.reduce((sum, n) => sum + n, 0);
        if (accounted !== total - shown) {
          throw new Error(
            `the chips account for ${accounted} hidden repos but the grid is missing ${total - shown}`,
          );
        }

        // “Show all N” has to actually show all N.
        await win
          .getByRole("button", { name: /^Show all \d+$/i })
          .first()
          .click();
        await win.waitForTimeout(1500);
        const cards = await win.locator("[data-repo-slug]").count();
        await shot(win, "real-show-all");
        if (cards !== total) {
          throw new Error(
            `Show all left ${cards} cards on screen but the catalog holds ${total}`,
          );
        }
        // Put the default view back, so the steps after this one see the
        // catalog as it was.
        await win.getByRole("button", { name: /^Archived/ }).first().click();
        await win.waitForTimeout(800);
        const restored = await win.locator("[data-repo-slug]").count();
        return `strip "${stripText}" · counts ${hiddenCounts.join("+")} = ${accounted} of ${total - shown} missing · Show all → ${cards} cards · filters off again, ${restored} cards`;
      },
    );

    await step("search.real", "Search a real repo name", async () => {
      const name = await win.evaluate(async () => {
        const atr = (window as unknown as { atr: AtrLike }).atr;
        const list = await atr.catalog.list({ limit: 200 });
        return list.items[0]?.name as string;
      });
      const token = String(name).split(/[\s\-_.]/)[0];
      const box = win.getByRole("searchbox", { name: /search repos/i }).first();
      await box.click();
      await box.fill(token);
      await win.waitForTimeout(1800);
      await shot(win, "real-search");
      const cards = await win.locator("[data-repo-slug]").count();
      if (cards === 0) throw new Error(`no results for "${token}"`);
      await box.fill("");
      await win.waitForTimeout(1200);
      return `"${token}" → ${cards} result(s)`;
    });

    await step(
      "search.empty",
      "An empty grid names the filter that emptied it, and offers the nearest repos",
      async () => {
        // A blank grid used to say "Try a different search, or clear the
        // filters" — a shrug. It now names the filter responsible, from the
        // same ranked reasons the count's strip ranks first, offers to clear
        // that one filter, and — when the search is what emptied it — offers
        // the repos closest to what was typed.
        const box = win.getByRole("searchbox", { name: /search repos/i }).first();
        await box.click();
        await box.fill("zzz-no-such-repo");
        await win.waitForTimeout(1800);
        await shot(win, "real-empty-culprit");

        const cards = await win.locator("[data-repo-slug]").count();
        if (cards !== 0) {
          throw new Error(`a nonsense search still showed ${cards} repos`);
        }

        const culprit = win.locator("[data-empty-culprit]");
        if ((await culprit.count()) !== 1) {
          throw new Error(
            "the empty grid does not name one filter as responsible for it",
          );
        }
        const key = await culprit.getAttribute("data-empty-culprit");
        if (key !== "search") {
          throw new Error(
            `the empty grid blames "${key}" when the search is what emptied it`,
          );
        }
        // The words have to name it too — a data attribute nobody reads is
        // not an explanation. Read them from the empty state itself: the
        // count's strip says "Hidden by …" as well, and asserting on that
        // would test the wrong surface.
        const emptyBox = win.locator("[data-empty-state]");
        await emptyBox.waitFor({ timeout: 5_000 });
        const text = (await emptyBox.innerText()).replace(/\s+/g, " ").trim();
        if (!/Hidden by search “zzz-no-such-repo”/.test(text)) {
          throw new Error(`the empty grid does not name the search: "${text}"`);
        }

        // And the button has to work: clearing the named filter brings the
        // grid back without hunting the toolbar for whatever it was.
        await culprit.click();
        await win.waitForTimeout(1_500);
        const restored = await win.locator("[data-repo-slug]").count();
        await shot(win, "real-empty-cleared");
        if (restored === 0) {
          throw new Error("clearing the named filter left the grid empty");
        }

        // The other half of the same screen. A query one letter out from a real
        // repo's name has an answer — the repo — and the grid offers it, so the
        // reader can take it instead of rewriting the query. The mistype lands
        // in the middle of the word, which is the one place the backend's
        // prefix search cannot reach.
        const pick = await win.evaluate(async () => {
          const atr = (window as unknown as { atr: AtrLike }).atr;
          const list = await atr.catalog.list({ limit: 200 });
          return list.items[0] ?? null;
        });
        if (!pick) throw new Error("the catalog listed no repo to mistype");
        const word = (String(pick.name).match(/[A-Za-z0-9]{6,}/g) ?? [])[0];
        if (!word) {
          throw new Error(`no word long enough to mistype in "${pick.name}"`);
        }
        const swap = word[2] === "z" ? "q" : "z";
        const typo = `${word.slice(0, 2)}${swap}${word.slice(3)}`;
        await box.click();
        await box.fill(typo);
        await win.waitForTimeout(1_800);
        const mistyped = await win.locator("[data-repo-slug]").count();
        if (mistyped > 0) {
          // A fuzzy backend answered the typo anyway, so the grid is not empty
          // and there is no empty state to explain. Say so instead of asserting
          // on a screen this run never reached.
          await box.fill("");
          await win.waitForTimeout(1_200);
          return `${text} · clear → ${restored} cards back · "${typo}" still matched ${mistyped} repo(s), so no near-miss list was reached`;
        }
        await shot(win, "real-empty-near-miss");
        const offered = await win.locator(`[data-near-miss="${pick.slug}"]`).count();
        if (offered !== 1) {
          const names = await win.locator("[data-near-miss]").allTextContents();
          throw new Error(
            `mistyping "${word}" as "${typo}" did not offer "${pick.name}" — offered: ${names.join(", ") || "nothing"}`,
          );
        }
        // And taking it has to put the repo back on screen, not just name it.
        await win.locator(`[data-near-miss="${pick.slug}"]`).click();
        await win.waitForTimeout(1_800);
        const backOnScreen = await win
          .locator(`[data-repo-slug="${pick.slug}"]`)
          .count();
        if (backOnScreen !== 1) {
          throw new Error(
            "picking the suggestion did not put the repo back on screen",
          );
        }
        await shot(win, "real-near-miss-picked");
        await box.fill("");
        await win.waitForTimeout(1_200);
        return `${text} · clear → ${restored} cards back · mistyped "${word}" → offered ${pick.name}`;
      },
    );

    await step("views", "Index / Posters / Table", async () => {
      const group = win.getByRole("group", { name: "View mode" });
      for (const label of ["Index", "Posters", "Table"]) {
        await group.getByRole("button", { name: new RegExp(`^${label}$`, "i") }).click();
        await win.waitForTimeout(700);
        await shot(win, `real-view-${label.toLowerCase()}`);
      }
      await group.getByRole("button", { name: /^Index$/i }).click();
      await win.waitForTimeout(500);
      return "clicked Index, Posters and Table";
    });

    await step("group.sort", "Every Group and Sort option", async () => {
      const group = win.getByLabel(/^group$/i);
      for (const v of ["folder", "ownership", "activity", "language", "none", "folder"]) {
        await group.selectOption(v);
        await win.waitForTimeout(400);
      }
      const sort = win.getByLabel(/^sort$/i);
      for (const v of ["name", "size", "language", "folder", "owner", "touched"]) {
        await sort.selectOption(v);
        await win.waitForTimeout(350);
      }
      const rev = win.getByRole("button", { name: /click to reverse/i });
      await rev.click();
      await win.waitForTimeout(300);
      await rev.click();
      await win.waitForTimeout(300);
      return "6 group modes, 6 sort keys, reverse toggled twice";
    });

    await step("rail", "Rail: views + a real folder", async () => {
      const rail = win.getByRole("navigation", { name: /catalog filters and folders/i });
      const views: string[] = [];
      for (const [name, label] of [
        [/^All repos/i, "All repos"],
        [/^Favourites/i, "Favourites"],
        [/^Mine/i, "Mine"],
        [/^Local only/i, "Local only"],
        [/^Cloned/i, "Cloned"],
        [/^Uncommitted/i, "Uncommitted"],
      ] as Array<[RegExp, string]>) {
        const b = rail.getByRole("button", { name });
        if (!(await b.count())) continue;
        await b.first().click();
        await win.waitForTimeout(400);
        views.push(label);
      }
      // A silent skip here would let a renamed rail button read as a pass.
      if (views.length < 5) {
        throw new Error(`only ${views.length} rail views matched: ${views.join(", ")}`);
      }
      await shot(win, "real-rail");
      // Expand the first real scan-root folder and click it.
      let folder = "none found";
      const root = rail.getByRole("button", { name: /^(collapse|expand) /i }).first();
      if (await root.count()) {
        const label = (await root.getAttribute("aria-label")) ?? "folder";
        await root.click();
        await win.waitForTimeout(500);
        await root.click();
        await win.waitForTimeout(500);
        folder = label.replace(/^(collapse|expand)\s+/i, "");
      }
      await rail.getByRole("button", { name: /^All repos/i }).first().click();
      await win.waitForTimeout(500);
      return `views: ${views.join(", ")} | toggled folder: ${folder}`;
    });

    await step("select.real-repos", "Select 4 different real repos; panel must match each", async () => {
      const cards = win.locator("[data-repo-slug]");
      const total = await cards.count();
      const indices = [0, 3, 7, 11].filter((i) => i < total);
      const checked: string[] = [];
      for (const i of indices) {
        const card = cards.nth(i);
        await card.scrollIntoViewIfNeeded();
        await card.click();
        await win.waitForTimeout(900);
        const cardName = (await card.getAttribute("data-repo-slug")) ?? "";
        const heading = win.locator('aside[aria-label="Repo detail"] h2').first();
        const panelName = ((await heading.count()) ? await heading.innerText() : "").trim();
        const path = await win
          .locator('aside[aria-label="Repo detail"] p.font-mono')
          .first()
          .innerText()
          .catch(() => "");
        checked.push(`${panelName}`);
        if (/Repo not found/i.test(await win.locator("body").innerText())) {
          throw new Error(`card ${cardName} opened a not-found panel`);
        }
        if (cardName && !panelName) throw new Error(`card ${cardName} opened an empty panel`);
        console.log(`[real] card[${i}] ${cardName} → panel "${panelName}" @ ${path.trim().slice(0, 60)}`);
      }
      await shot(win, "real-detail-panel");
      return `opened ${checked.length}: ${checked.join(", ")}`;
    });

    await step("favorite", "Favourite star on a real repo, then back off", async () => {
      const star = win.locator("[data-repo-slug]").first().getByRole("button", { name: /^(pin|unpin) /i });
      const before = await star.getAttribute("aria-label");
      await star.click();
      await win.waitForTimeout(1500);
      const after = await star.getAttribute("aria-label");
      // The captured set for this build is known (see alpha walkthrough): the list
      // refreshes on remount, not in place. Re-read after a palette refresh.
      await win.keyboard.press("Meta+k");
      await win.waitForTimeout(600);
      const refresh = win.locator("[cmdk-item]", { hasText: "Refresh Catalog" }).first();
      if (await refresh.count()) {
        await refresh.click();
        await win.waitForTimeout(2500);
      }
      const starred = await win
        .locator("[data-repo-slug]")
        .first()
        .getByRole("button", { name: /^(pin|unpin) /i })
        .getAttribute("aria-label");
      await shot(win, "real-favorite");
      // revert
      await win
        .locator("[data-repo-slug]")
        .first()
        .getByRole("button", { name: /^(pin|unpin) /i })
        .click();
      await win.waitForTimeout(1200);
      return `${before} → ${after} → (after refresh) ${starred}; reverted`;
    });

    await step("launcher", "Launcher icons on a real repo (OS launches stubbed)", async () => {
      if (!seamsOk) throw new Error("seams not neutralised");
      const card = win.locator("[data-repo-slug]").first();
      const out: string[] = [];
      for (const [re, label] of [
        [/^open in editor$/i, "editor"],
        [/^open in terminal$/i, "terminal"],
        [/^reveal in finder$/i, "finder"],
        [/^open remote/i, "remote"],
        [/^copy path$/i, "copy"],
      ] as Array<[RegExp, string]>) {
        const b = card.getByRole("button", { name: re });
        if (!(await b.count())) {
          out.push(`${label}:absent`);
          continue;
        }
        await b.first().click();
        await win.waitForTimeout(700);
        out.push(label);
      }
      const editorLabel = await win
        .locator('aside[aria-label="Repo detail"] button[aria-label*="default editor"]')
        .first()
        .getAttribute("aria-label")
        .catch(() => null);
      await shot(win, "real-launcher");
      return `${out.join(", ")}${editorLabel ? ` | footer: ${editorLabel}` : ""}`;
    });

    await step("multi-select", "Cmd-click multi-select + Clear selection", async () => {
      const cards = win.locator("[data-repo-slug]");
      if ((await cards.count()) < 3) throw new Error("need 3 cards");
      await cards.nth(1).click({ modifiers: ["Meta"] });
      await win.waitForTimeout(400);
      await cards.nth(2).click({ modifiers: ["Meta"] });
      await win.waitForTimeout(600);
      await shot(win, "real-multi-select");
      const clear = win.getByRole("button", { name: /clear selection/i });
      if (!(await clear.count())) throw new Error("Clear selection did not appear");
      await clear.first().click();
      await win.waitForTimeout(400);
      return "cmd-clicked 2 more cards, then Clear selection";
    });

    await step("table", "Table view: sort columns, open a row", async () => {
      await win.getByRole("group", { name: "View mode" }).getByRole("button", { name: /^Table$/i }).click();
      await win.waitForTimeout(700);
      const sorted: string[] = [];
      for (const [col, label] of [
        [/^Name$/i, "Name"],
        [/^Language$/i, "Language"],
        [/^Last touched$/i, "Last touched"],
        [/^Size$/i, "Size"],
      ] as Array<[RegExp, string]>) {
        const h = win.getByRole("button", { name: col });
        if (!(await h.count())) continue;
        await h.first().click();
        await win.waitForTimeout(350);
        sorted.push(label);
      }
      if (sorted.length < 4) {
        throw new Error(`only ${sorted.length} sortable columns matched: ${sorted.join(", ")}`);
      }
      await win.locator("table tbody tr button").first().click();
      await win.waitForTimeout(800);
      await shot(win, "real-table");
      await win.getByRole("group", { name: "View mode" }).getByRole("button", { name: /^Index$/i }).click();
      await win.waitForTimeout(500);
      return `sorted by ${sorted.join(", ")}; opened a row`;
    });

    await step("tags", "Detail panel: add a tag then remove it", async () => {
      await win.locator("[data-repo-slug]").first().click();
      await win.waitForTimeout(900);
      // The tag composer is behind the Tags header's "Add" now.
      const detail = win.getByRole("complementary", { name: /repo detail/i });
      const reveal = detail.getByRole("button", { name: "Add", exact: true });
      if (await reveal.count()) await reveal.first().click();
      const input = win.getByRole("textbox", { name: /new tag/i });
      if (!(await input.count())) throw new Error("no New tag input");
      await input.first().fill("zz-walkthrough");
      await win.getByRole("button", { name: /^Add tag$/i }).first().click();
      await win.waitForTimeout(1500);
      const rm = win.getByRole("button", { name: /remove tag zz-walkthrough/i });
      if (!(await rm.count())) throw new Error("tag did not appear");
      await shot(win, "real-tag-added");
      await rm.first().click();
      await win.waitForTimeout(1500);
      if (await win.getByRole("button", { name: /remove tag zz-walkthrough/i }).count()) {
        throw new Error("tag still present after Remove");
      }
      return 'added then removed the tag "zz-walkthrough"';
    });

    await step("related", "Detail panel: assert a curated link, then remove it", async () => {
      const add = win.getByRole("button", { name: /assert a relationship/i });
      if (!(await add.count())) throw new Error("no Related Add button");
      // Resolve the target BEFORE opening the modal, so a lookup failure can
      // never leave a dialog blocking every later step.
      const target = await win.evaluate(async () => {
        const atr = (window as unknown as { atr: AtrLike }).atr;
        const list = await atr.catalog.list({ limit: 200 });
        return { name: list.items[1]?.name ?? "" };
      });
      try {
        await add.first().click({ timeout: 15_000 });
        await win.waitForTimeout(900);
        const search = win.getByRole("textbox", { name: /which repository/i });
        await search.fill(target.name.split(/[\s\-_.]/)[0], { timeout: 15_000 });
        await win.waitForTimeout(1800);
        await shot(win, "real-curate-dialog");
        const hit = win.locator("[role=dialog] button", { hasText: target.name }).first();
        if (!(await hit.count())) {
          throw new Error(`no candidate in the dialog matched "${target.name}"`);
        }
        await hit.click({ timeout: 15_000 });
        await win.waitForTimeout(400);
        await win.getByRole("textbox", { name: /^why$/i }).fill("walkthrough check", { timeout: 15_000 });
        await win.waitForTimeout(300);
        await win.getByRole("button", { name: /assert link/i }).click({ timeout: 15_000 });
        await win.waitForTimeout(2000);
        await shot(win, "real-related");

        // Verify and undo HERE, inside the try. The `finally` Escape closes the
        // whole detail panel, so a check placed after it inspects an empty page
        // — which is how an earlier revision reported "nothing asserted" for a
        // link that had in fact been asserted.
        const rm = win.getByRole("button", { name: /^Remove link/i });
        if (!(await rm.count())) {
          throw new Error("link asserted, but no Remove control appeared");
        }
        await rm.first().click({ timeout: 15_000 });
        await win.waitForTimeout(1800);
        if (await win.getByRole("button", { name: /^Remove link/i }).count()) {
          throw new Error("link still listed after Remove");
        }
        return `asserted "${target.name}" then removed it`;
      } finally {
        // Guarantee no modal survives this step.
        await win.keyboard.press("Escape");
        await win.waitForTimeout(500);
      }
    });

    await step("footer", "Detail panel footer: Open in editor + full detail page", async () => {
      // Re-open a repo so the panel is definitely up (an earlier step may have closed it).
      await win.keyboard.press("Escape");
      await win.waitForTimeout(300);
      const card = win.locator("[data-repo-slug]").first();
      await card.scrollIntoViewIfNeeded();
      await card.click({ timeout: 15_000 });
      await win.waitForTimeout(1200);
      const open = win.getByRole("button", { name: /with the default editor/i });
      if (!(await open.count())) {
        throw new Error('no "Open with the default editor" button in the footer');
      }
      await open.first().click();
      await win.waitForTimeout(900);
      const full = win.getByRole("link", { name: /open full detail page/i });
      if (!(await full.count())) throw new Error("no full-detail link");
      await full.first().click({ timeout: 15_000 });
      await win.waitForTimeout(1800);
      await shot(win, "real-repo-page");
      const back = win.getByRole("link", { name: /back to catalog/i });
      await back.first().click({ timeout: 15_000 });
      await win.waitForTimeout(1200);
      return "opened in the editor, opened the full detail page, came back";
    });

    await step("processes", "Processes: refresh (Kill deliberately not fired)", async () => {
      await win.keyboard.press("Escape");
      await win.waitForTimeout(300);
      await win.getByRole("banner").getByRole("link", { name: /^running/i }).click({ timeout: 15_000 });
      await win.getByRole("heading", { name: /^Running$/i }).waitFor({ timeout: 20_000 });
      await win.waitForTimeout(2500);
      const refresh = win.getByRole("button", { name: /^Refresh$/i });
      if (!(await refresh.count())) throw new Error("no Refresh button on /processes");
      await refresh.first().click();
      await win.waitForTimeout(3500);
      await shot(win, "real-processes");
      const rows = await win.locator("table tbody tr").count();
      const kills = await win.getByRole("button", { name: /^Kill PID/i }).count();
      if (kills > 0) {
        dangerNotFired.push(`/processes exposes ${kills} live "Kill PID" button(s) (${rows} rows listed)`);
      }
      return `${rows} rows, ${kills} kill buttons — not fired`;
    });

    await step("settings", "Settings: selects, identity, scan paths, Scan now (bounded)", async () => {
      await win.keyboard.press("Escape");
      await win.waitForTimeout(300);
      await win.getByRole("banner").getByRole("link", { name: /^settings$/i }).click({ timeout: 15_000 });
      await win.getByRole("heading", { name: /^Settings$/i }).waitFor({ timeout: 20_000 });
      await win.waitForTimeout(1500);
      await shot(win, "real-settings");

      const editor = win.getByLabel(/default editor/i);
      const editorOpts = await editor.locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
      await editor.selectOption(editorOpts.find((v) => v !== "none") ?? "none");
      await win.waitForTimeout(1000);
      const terminal = win.getByLabel(/default terminal/i);
      const termOpts = await terminal.locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
      await terminal.selectOption(termOpts.find((v) => v !== "") ?? "");
      await win.waitForTimeout(1000);

      // identity add/remove on the copy
      const idInput = win.getByRole("textbox", { name: /add a git handle/i });
      await idInput.fill("zz-walkthrough-handle");
      await win.getByRole("button", { name: /^Add$/i }).first().click();
      await win.waitForTimeout(1200);
      const idRm = win.getByRole("button", { name: /remove identity zz-walkthrough-handle/i });
      if (await idRm.count()) {
        await idRm.first().click();
        await win.waitForTimeout(1000);
      }

      // Point the COPY at a tiny fixture so "Scan now" is bounded, then scan.
      const removes = win.getByRole("button", { name: /^Remove scan path /i });
      let removed = 0;
      for (let i = 0; i < 40 && (await removes.count()) > 0; i++) {
        await removes.first().click();
        await win.waitForTimeout(700);
        removed++;
      }
      const newPath = win.getByRole("textbox", { name: /new scan path/i });
      await newPath.fill(fixtureRoot);
      await win.getByRole("button", { name: /^Add path$/i }).click();
      await win.waitForTimeout(1500);
      await win.getByRole("button", { name: /save settings/i }).click();
      await win.waitForTimeout(1500);
      const scan = win.getByRole("button", { name: /^Scan now$/i });
      if (await scan.isDisabled()) throw new Error("Scan now stayed disabled");
      await scan.click();
      await win.waitForTimeout(9000);
      await shot(win, "real-scan-now");
      // Read the numbers, not the labels: matching /Errors/i against the body
      // text returned the stat's own caption ("ERRORS") and reported that as the
      // outcome, which said nothing about what the scan actually did.
      const lines = (await win.locator("body").innerText())
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const stat = (name: string): string => {
        const i = lines.findIndex((l) => l.toUpperCase() === name.toUpperCase());
        return i >= 0 ? (lines[i + 1] ?? "?") : "n/a";
      };
      return `removed ${removed} real scan path(s) on the copy; scan found ${stat("Found")}, indexed ${stat("Indexed")}, errors ${stat("Errors")}`;
    });

    await step("tasks", "Task runner: expand, run, stop, clear (on the indexed fixture)", async () => {
      // Deliberately NOT a real repo. Real repos declare real tasks (VibeOS: 15)
      // and Run executes that script in the developer's own working tree — a
      // `dev` that holds a port, a `build` that writes into the repo. So this
      // runs against the temp fixture the previous step's scan just indexed,
      // whose only scripts are `console.log` and a two-minute sleep.
      await win.getByRole("banner").getByRole("link", { name: /^AllTheRepos$/i }).click({ timeout: 15_000 });
      await win.waitForTimeout(1200);
      const box = win.getByRole("searchbox", { name: /search repos/i }).first();
      await box.click();
      await box.fill("Walkthrough");
      await win.waitForTimeout(1800);
      const card = win.locator("[data-repo-slug]").first();
      if (!(await card.count())) throw new Error("the fixture repo is not in the catalog");
      await card.click({ timeout: 15_000 });
      await win.waitForTimeout(1200);

      const toggle = win.getByRole("button", { name: /^Tasks/i });
      if (!(await toggle.count())) throw new Error("no Tasks section on the fixture repo");
      await toggle.first().click();
      await win.waitForTimeout(900);
      await shot(win, "real-tasks-open");

      const serve = win.getByRole("button", { name: /^Run serve$/i });
      if (!(await serve.count())) throw new Error("the fixture's `serve` task is not listed");
      await serve.first().click();
      await win.waitForTimeout(2500);
      const stop = win.getByRole("button", { name: /^Stop serve$/i });
      if (!(await stop.count())) throw new Error("Run never put the task into a running state");
      await shot(win, "real-task-running");
      await stop.first().click();
      // Stopping escalates SIGTERM → SIGKILL after a 4s grace period
      // (`KILL_GRACE_MS`), so a run that only dies to the second signal clears
      // around the 4s mark. Sampling once at 2s called a slow-but-correct stop
      // a failure under load — this machine was running 414 processes in the
      // run that failed. Poll past the grace window instead, and keep the
      // assertion: the run must end, the question is only how long it takes.
      let stillRunning = true;
      for (let i = 0; i < 24 && stillRunning; i++) {
        await win.waitForTimeout(500);
        stillRunning =
          (await win.getByRole("button", { name: /^Stop serve$/i }).count()) > 0;
      }
      if (stillRunning) {
        throw new Error("Stop did not end the run within 12s");
      }

      const clear = win.getByRole("button", { name: /clear output/i });
      const hadOutput = (await clear.count()) > 0;
      if (hadOutput) {
        await clear.first().click();
        await win.waitForTimeout(800);
        if (await win.getByRole("button", { name: /clear output/i }).count()) {
          throw new Error("Clear output did not drop the run's pane");
        }
      }
      await shot(win, "real-tasks-cleared");
      return `ran and stopped the fixture's serve task; output pane ${hadOutput ? "cleared" : "absent"}`;
    });

    await step("debug", "/debug: ping round-trip", async () => {
      const debug = win.getByRole("banner").getByRole("link", { name: /debug/i });
      if (!(await debug.count())) {
        skip("debug", "Debug page", "no Debug affordance in this build");
        return;
      }
      await debug.first().click();
      await win.getByRole("heading", { name: /^Debug$/i }).waitFor({ timeout: 20_000 });
      await win.getByText("system.ping", { exact: true }).first().waitFor({ timeout: 20_000 });
      await win.waitForTimeout(1200);
      await win.getByRole("button", { name: /ping again/i }).click();
      await win.waitForTimeout(1200);
      if (!/pong/i.test(await win.locator("body").innerText())) throw new Error("no pong");
      await shot(win, "real-debug");
      return "ping → pong over IPC";
    });

    await step("palette", "Command palette: open and list actions", async () => {
      await win.keyboard.press("Escape");
      await win.waitForTimeout(300);
      await win.getByRole("banner").getByRole("link", { name: /^AllTheRepos$/i }).click({ timeout: 15_000 });
      await win.waitForTimeout(1200);
      await win.keyboard.press("Meta+k");
      await win.waitForTimeout(900);
      const dialog = win.getByRole("dialog", { name: /command palette/i });
      if (!(await dialog.count())) throw new Error("palette did not open");
      await shot(win, "real-palette");
      const items = await win.locator("[cmdk-item]").count();
      await win.keyboard.press("Escape");
      await win.waitForTimeout(500);
      return `${items} actions offered`;
    });

    await step("danger.inventory", "Inventory the destructive controls that still exist (none fired)", async () => {
      const found: string[] = [];
      // rail menu → Stop scanning
      const rail = win.getByRole("navigation", { name: /catalog filters and folders/i });
      const menu = rail.getByRole("button", { name: /actions for scan folder/i }).first();
      if (await menu.count()) {
        await menu.click();
        await win.waitForTimeout(400);
        const stop = win.getByRole("menuitem", { name: /stop scanning/i });
        if (await stop.count()) found.push("rail menu → Stop scanning…");
        await win.keyboard.press("Escape");
        await win.waitForTimeout(400);
      }
      // port chip kill on a card (only rendered for repos with a live listener)
      const chipKill = await win.locator('button[title="Kill process"]').count();
      if (chipKill > 0) found.push(`${chipKill} port-chip "Kill process" control(s) on cards`);
      // remove-from-catalog is only rendered for a missing folder
      const removeCatalog = await win.getByRole("button", { name: /remove from catalog/i }).count();
      if (removeCatalog > 0) found.push("detail panel → Remove from catalog…");
      dangerNotFired.push(...found);
      return found.length ? found.join(" | ") : "none reachable on this screen";
    });

    await step("final", "Return to the catalog", async () => {
      await win.getByRole("banner").getByRole("link", { name: /^AllTheRepos$/i }).click({ timeout: 15_000 });
      await win.waitForTimeout(1500);
      const cards = await win.locator("[data-repo-slug]").count();
      if (cards === 0) throw new Error("the catalog rendered no repos");
      await shot(win, "real-final-catalog");
      return `catalog back with ${cards} cards`;
    });
  } catch (fatal) {
    push("fatal", "Unhandled harness error (outside a step)", "failed", fatal instanceof Error ? fatal.message : String(fatal));
  } finally {
    // Every teardown call is bounded: a wedged app must not stop the report
    // from being written or the run from ending.
    const bounded = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
    seams.openExternal = await bounded(
      app.evaluate(() => (globalThis as unknown as { __real?: Record<string, unknown[]> }).__real ?? {}),
      5_000,
      {},
    ) as unknown as unknown[];

    const totals = {
      steps: steps.length,
      ok: steps.filter((s) => s.status === "ok").length,
      failed: steps.filter((s) => s.status === "failed").length,
      skipped: steps.filter((s) => s.status === "skipped").length,
      consoleErrors: issues.length,
      cosmeticConsoleErrors: cosmetic.length,
    };
    const report = {
      ranAt: new Date().toISOString(),
      profile: `${REAL_PROFILE} (copied)`,
      totals,
      steps,
      issues,
      dangerNotFired,
      seamActivity: seams.openExternal,
      screenshots: shots,
      cosmeticSample: [...new Set(cosmetic)].slice(0, 6),
    };
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    const md: string[] = [
      "# Real-data walkthrough",
      "",
      `Ran ${report.ranAt} against a copy of \`${REAL_PROFILE}\`.`,
      "",
      `**${totals.ok} ok · ${totals.failed} failed · ${totals.skipped} skipped · ${totals.consoleErrors} script errors · ${totals.cosmeticConsoleErrors} CSP/asset refusals**`,
      "",
      "| # | step | result | detail |",
      "|---|------|--------|--------|",
      ...steps.map(
        (s) => `| ${s.n} | ${s.label} | ${s.status === "ok" ? "✅" : s.status === "skipped" ? "⏭️" : "❌"} | ${(s.detail ?? "").replace(/\|/g, "\\|")} |`,
      ),
    ];
    if (dangerNotFired.length) {
      md.push("", "## Destructive controls present but NOT fired", "", ...dangerNotFired.map((d) => `- ${d}`));
    }
    if (issues.length) {
      md.push("", "## Console errors", "", ...issues.map((i) => `- ${i}`));
    }
    writeFileSync(join(OUT_DIR, "report.md"), `${md.join("\n")}\n`);
    console.log(`[real] ${JSON.stringify(totals)}`);
    await bounded(app.close(), 15_000, undefined as void);
  }
}

test("real-data walkthrough", async () => {
  await main();
});
