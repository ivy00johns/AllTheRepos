/**
 * Nav accessible names and repo-card focus order.
 *
 * Two P1 findings from the [2026-10-07 UI/UX review](../../docs/audits/2026-10-07-ui-ux-review.md),
 * both of which are properties of the rendered accessibility tree rather than of
 * the markup, so this spec drives the app and asks it:
 *
 *   - **ATR-059** — the top bar rendered each destination's label with
 *     `hidden lg:inline`, and `hidden` is `display: none`, which removes the text
 *     from the accessible-name computation. The icon beside it is `aria-hidden`,
 *     so below the `lg` breakpoint all five destinations were icon-only links
 *     with no name at all — reachable by dragging the window to its 800px
 *     minimum. The spec resizes the real window and asserts each one resolves by
 *     name, and that the label span is not `display: none` (the mechanism, so a
 *     future edit that swaps the class back fails here rather than silently).
 *
 *   - **ATR-060** — the repo card was `role="button"` on the `<article>` with a
 *     port chip, a favourite star and five launcher buttons inside it.
 *     Interactive descendants of a button role are invalid: assistive tech
 *     flattens or skips them, so the nested controls became unreachable or
 *     ambiguous. The spec asserts the card is not a control and not a tab stop,
 *     that nothing focusable on the catalog contains another control, and then
 *     walks the keyboard through the card one stop at a time.
 *
 * The port chip only exists while a process is listening, so the spec spawns one
 * inside a seeded repo and forces a sweep through the `/processes` Refresh
 * action — the same route `process-flow.spec.ts` uses, and for the same reason:
 * `ATR_E2E` deliberately shows the window inactive, so the poller is on its
 * blurred interval and a wait would be a 15-second guess.
 *
 * Owner: qe-agent (2026-10-07 UI/UX pass).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

import { TEMPLATE_PROFILE_ENV, launchApp } from "./_launch-app";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

/**
 * One of `SEEDED_REPOS` in `_global-setup.ts`. The catalog slugs a repo as
 * `<kebab-name>-<hash>`, so the card is found by prefix.
 */
const SEEDED_REPO = "demo-cli";

/** The window's own minimum, from `main-window.ts`. */
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

/**
 * Every destination in `NAV_ITEMS`. Matched on the label only, not the whole
 * accessible name: the Running link also carries the process count as an
 * `sr-only` suffix, which is deliberate and not this finding.
 */
const NAV_LABELS = ["Running", "Map", "Claude", "Settings", "Debug"] as const;

/** The five launcher buttons, in the order `launcher-buttons.tsx` renders them. */
const LAUNCHER_LABELS = [
  "Open in editor",
  "Open in terminal",
  "Reveal in Finder",
  "Open remote (origin)",
  "Copy path",
] as const;

/** Where `_global-setup.ts` put the seeded repos. */
function seededRepoDir(name: string): string {
  const template = process.env[TEMPLATE_PROFILE_ENV];
  if (!template) {
    throw new Error(
      `[nav-card-a11y] ${TEMPLATE_PROFILE_ENV} is unset — run this spec through Playwright so _global-setup.ts can build the seeded profile.`,
    );
  }
  const dir = join(dirname(template), "repos", name);
  if (!existsSync(dir)) {
    throw new Error(
      `[nav-card-a11y] no seeded repo at ${dir} — is "${name}" still in SEEDED_REPOS (tests/e2e/_global-setup.ts)?`,
    );
  }
  return dir;
}

/** Resize the real BrowserWindow, then wait for the renderer to agree. */
async function resizeWindow(
  app: ElectronApplication,
  win: Page,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height);
  }, { width, height });

  await expect
    .poll(() => win.evaluate(() => window.innerWidth), {
      message: `the window never reached ${width}px`,
      timeout: 5_000,
    })
    .toBe(width);
}

/** What the keyboard is sitting on, as the accessibility tree would describe it. */
function focused(win: Page): Promise<Record<string, unknown>> {
  return win.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      tag: el?.tagName.toLowerCase() ?? null,
      label: el?.getAttribute("aria-label") ?? null,
      isCard: !!el?.matches("[data-repo-slug]"),
    };
  });
}

test.describe("nav names and repo-card focus order", () => {
  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test.setTimeout(180_000);

  test("every destination is named at the 800px minimum, and the card's controls are separate stops", async () => {
    const repoDir = seededRepoDir(SEEDED_REPO);
    let child: ChildProcess | null = null;
    const { app, close } = await launchApp();

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      const appTitle = win.getByRole("link", { name: /^AllTheRepos$/i });
      await expect(appTitle).toBeVisible({ timeout: 15_000 });
      const topBar = win.getByRole("banner");

      // ----- ATR-059: named at the window's minimum width. -----
      // First prove the destinations are named at the default width, so a
      // failure below is about the breakpoint and not about the nav entirely.
      for (const label of NAV_LABELS) {
        await expect(
          topBar.getByRole("link", { name: new RegExp(`^${label}\\b`, "i") }),
          `${label} has no accessible name at 1280px`,
        ).toBeVisible();
      }

      await resizeWindow(app, win, MIN_WIDTH, MIN_HEIGHT);

      for (const label of NAV_LABELS) {
        await expect(
          topBar.getByRole("link", { name: new RegExp(`^${label}\\b`, "i") }),
          `${label} is an icon-only link with no accessible name at ${MIN_WIDTH}px`,
        ).toBeVisible();

        // The mechanism, not just the symptom: a `display: none` label is what
        // removed the name, so the class must not be back.
        const display = await win.evaluate((text) => {
          const span = Array.from(
            document.querySelectorAll("header nav a span"),
          ).find((s) => s.textContent?.trim() === text);
          return span ? getComputedStyle(span).display : null;
        }, label);
        expect(display, `no label span for ${label}`).not.toBe(null);
        expect(display, `${label}'s label span is display:none`).not.toBe("none");
      }

      // ----- Spawn a listener so the card carries a port chip. -----
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
          () => rejectPort(new Error("the http server never printed PORT")),
          3_000,
        );
        child!.stdout?.on("data", (buf: Buffer) => {
          const match = buf.toString("utf8").match(/PORT=(\d+)/);
          if (match?.[1]) {
            clearTimeout(timer);
            resolvePort(parseInt(match[1], 10));
          }
        });
        child!.once("error", (err) => {
          clearTimeout(timer);
          rejectPort(err);
        });
        child!.once("exit", (code) => {
          clearTimeout(timer);
          rejectPort(new Error(`the http server exited early (code ${code})`));
        });
      });
      expect(port).toBeGreaterThan(1024);

      // Force a sweep rather than waiting out the blurred poll interval.
      await topBar.getByRole("link", { name: /^Running\b/i }).click();
      const refresh = win.getByRole("button", { name: /^refresh$/i });
      await expect(refresh).toBeEnabled({ timeout: 10_000 });
      await refresh.click();
      await expect(
        win.locator("tbody tr").filter({ has: win.locator(`span:text-is("${port}")`) }),
        `the spawned listener on port ${port} never reached the process table`,
      ).toBeVisible({ timeout: 20_000 });
      await appTitle.click();

      const card = win.locator(`article[data-repo-slug^="${SEEDED_REPO}"]`);
      await expect(card).toBeVisible({ timeout: 15_000 });

      // ----- ATR-060: the card is a container, not a control. -----
      expect(await card.getAttribute("role"), "the card is a control again").toBeNull();
      expect(
        await card.getAttribute("tabindex"),
        "the card is a tab stop again",
      ).toBeNull();

      const nameButton = card.locator("h3 button");
      await expect(nameButton).toBeVisible();
      expect(
        await nameButton.getAttribute("aria-label"),
        "the name button has no accessible name",
      ).toBeTruthy();

      // The general invariant, over every card on the page: nothing focusable
      // may contain anything else focusable. This is what the port chip, the
      // star and the launchers all sit inside, so it covers each of them in the
      // state they actually render in rather than one at a time.
      const nested = await win.evaluate(() => {
        const INTERACTIVE = new Set([
          "button",
          "link",
          "checkbox",
          "radio",
          "switch",
          "tab",
          "menuitem",
          "textbox",
          "combobox",
          "searchbox",
          "slider",
          "spinbutton",
        ]);
        const roleOf = (el: Element): string | null => {
          const explicit = el.getAttribute("role");
          if (explicit && INTERACTIVE.has(explicit)) return explicit;
          const tag = el.tagName.toLowerCase();
          if (tag === "button") return "button";
          if (tag === "a" && el.hasAttribute("href")) return "link";
          if (tag === "input" || tag === "select" || tag === "textarea") return tag;
          return null;
        };
        const offenders: string[] = [];
        document.querySelectorAll("[data-repo-slug]").forEach((cardEl) => {
          const outer = roleOf(cardEl);
          if (!outer) return;
          cardEl.querySelectorAll("*").forEach((inner) => {
            const innerRole = roleOf(inner);
            if (innerRole) {
              offenders.push(
                `${outer} contains ${innerRole} <${inner.tagName.toLowerCase()}>`,
              );
            }
          });
        });
        return offenders;
      });
      expect(
        nested,
        "a control on the catalog contains another control",
      ).toEqual([]);

      // ----- The keyboard walk: one stop per control, and never the card. -----
      const chip = card.locator('button[aria-label^="Port "]').first();
      await expect(chip, "the card never rendered a port chip").toBeVisible({
        timeout: 20_000,
      });
      const star = card
        .locator('button[aria-label^="Pin "], button[aria-label^="Unpin "]')
        .first();

      const expected = [
        await chip.getAttribute("aria-label"),
        await star.getAttribute("aria-label"),
        ...LAUNCHER_LABELS,
      ];
      expect(expected[0], "the port chip has no accessible name").toBeTruthy();
      expect(expected[1], "the favourite star has no accessible name").toBeTruthy();

      await nameButton.focus();
      await expect(nameButton).toBeFocused();

      const stops: Array<string | null> = [];
      for (let press = 0; press < expected.length; press += 1) {
        await win.keyboard.press("Tab");
        const at = await focused(win);
        expect(
          at.isCard,
          `Tab stop ${press + 1} landed on the card element itself`,
        ).toBe(false);
        stops.push(at.label as string | null);
      }

      expect(
        stops,
        "the card's controls are not each their own tab stop, in order",
      ).toEqual(expected);
    } finally {
      child?.kill();
      await close();
    }
  });
});
