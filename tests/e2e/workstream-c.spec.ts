/**
 * Workstream C E2E — the five P3 findings (ATR-070…074), on the built app.
 *
 * These are the items the ledger had been holding: each one is a small decision
 * that was never made, and four of the five are only visible in the rendered
 * result — a heading level, the first thing Tab reaches, the computed size of a
 * label, the hue of a status dot, and what is *not* in the navigation. So every
 * assertion here reads the running app rather than the source:
 *
 *   - ATR-070 — `/` and `/graph` start their heading hierarchy at `h1`, and the
 *     routes' first heading is level 1.
 *   - ATR-071 — the first Tab stop is a skip link, it becomes visible when it is
 *     focused, and activating it moves focus into `main` itself.
 *   - ATR-072 — no element in the built renderer names a raw font size, at any
 *     value; the named tiers compute to the sizes they claim (12px, 10px, and
 *     the 13px `text-body` step); and no heading, tab or column header is below
 *     the 12px floor. Audited on three screens — the catalog, its table view and
 *     the map — because the check only sees what is on screen, and the two
 *     screens the 13px sweep touched are not the one the route opens on.
 *   - ATR-073 — the live-status dot is painted with `--color-status-live`, and
 *     paints a different colour from `--color-accent`.
 *   - ATR-074 — the primary navigation holds its four destinations and nothing
 *     called Debug; the page is reached from the command palette's dev-tools
 *     action, in the one build that offers it. This one is tested twice, because
 *     the answer depends on the build: an unpackaged run draws the top bar's dev
 *     affordance and offers the palette entry, and a packaged build draws neither.
 *     The second launch is forced with main's `ATR_FORCE_PACKAGED=1`, which exists
 *     so the branch a release takes is exercised by the suite rather than first
 *     seen by whoever installs the DMG.
 *
 * The listener ATR-073 needs is spawned inside a seeded repo, the same way
 * `nav-card-a11y.spec.ts` does it, and for the same reason: `ATR_E2E` shows the
 * window inactive, so the process poller sits on its blurred interval and the
 * `/processes` Refresh action is what produces a snapshot instead of a wait.
 *
 * Owner: qe-agent (Workstream C).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { TEMPLATE_PROFILE_ENV, launchApp } from "./_launch-app";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

/**
 * One of `SEEDED_REPOS` in `_global-setup.ts`. The catalog slugs a repo as
 * `<kebab-name>-<hash>`, so the card is found by prefix.
 */
const SEEDED_REPO = "demo-cli";

/** The destinations `NAV_ITEMS` carries — and nothing else. */
const NAV_LABELS = ["Running", "Map", "Claude", "Settings"] as const;

/** Where `_global-setup.ts` put the seeded repos. */
function seededRepoDir(name: string): string {
  const template = process.env[TEMPLATE_PROFILE_ENV];
  if (!template) {
    throw new Error(
      `[workstream-c] ${TEMPLATE_PROFILE_ENV} is unset — run this spec through Playwright so _global-setup.ts can build the seeded profile.`,
    );
  }
  const dir = join(dirname(template), "repos", name);
  if (!existsSync(dir)) {
    throw new Error(
      `[workstream-c] no seeded repo at ${dir} — is "${name}" still in SEEDED_REPOS (tests/e2e/_global-setup.ts)?`,
    );
  }
  return dir;
}

/** Every heading's level, in document order — the route's hierarchy, as read. */
function headingLevels(win: Page): Promise<number[]> {
  return win.evaluate(() =>
    Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((el) =>
      Number(el.tagName.slice(1)),
    ),
  );
}

/**
 * One page's type scale, as the built renderer computes it.
 *
 * The rule the unit guard enforces in the source, read back off the running app:
 * every `text-[…]` arbitrary size in any unit (a raw size is the same defect
 * whether it is written in px, rem or em), each named tier's computed size, and
 * the roles the ATR-072 finding was about.
 */
function typeScaleAudit(win: Page): Promise<{
  raw: string[];
  label: Array<{ text: string; size: number }>;
  micro: Array<{ text: string; size: number }>;
  body: Array<{ text: string; size: number }>;
  underFloor: Array<{ tag: string; size: number; text: string }>;
}> {
  return win.evaluate(() => {
    const raw: string[] = [];
    const label: Array<{ text: string; size: number }> = [];
    const micro: Array<{ text: string; size: number }> = [];
    const body: Array<{ text: string; size: number }> = [];
    const underFloor: Array<{ tag: string; size: number; text: string }> = [];

    const FLOOR_SELECTOR =
      'h1,h2,h3,h4,h5,h6,[role="tab"],[role="columnheader"]';

    document.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const cls = typeof el.className === "string" ? el.className : "";
      if (/text-\[[^\]\s]*(?:px|rem|em)\]/.test(cls)) {
        raw.push(`${el.tagName.toLowerCase()}.${cls.slice(0, 80)}`);
      }

      const size = parseFloat(getComputedStyle(el).fontSize);
      const text = (el.textContent ?? "").trim().slice(0, 40);
      if (/(^|\s)atr-label(\s|$)/.test(cls)) label.push({ text, size });
      if (/(^|\s)atr-micro(\s|$)/.test(cls)) micro.push({ text, size });
      if (/(^|\s)text-body(\s|$)/.test(cls)) body.push({ text, size });
      if (text.length > 0 && el.matches(FLOOR_SELECTOR)) {
        underFloor.push({ tag: el.tagName.toLowerCase(), size, text });
      }
    });

    return { raw, label, micro, body, underFloor };
  });
}

/**
 * A colour token resolved to what Chromium actually paints, read off a probe
 * element rather than compared as a hex string from the stylesheet.
 */
function tokenColor(win: Page, name: string): Promise<string> {
  return win.evaluate((cssVar) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${cssVar})`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);
}

test.describe("workstream C — the four small decisions and one door", () => {
  test.beforeAll(() => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm electron:build\` (or \`node scripts/run-electron-e2e.mjs\`) before running this suite.`,
      );
    }
  });

  test.setTimeout(180_000);

  test("ATR-070 — both full-height routes start their hierarchy at h1", async () => {
    const { app, close } = await launchApp();

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });

      // ----- The catalog. -----
      // Its visible type is mono captions, so its own name is deliberately
      // off-screen — but it has to be a real h1 and the first heading in the
      // document, or the section h2s below it still have nothing above them.
      const catalogH1 = win.getByRole("heading", { level: 1 });
      await expect(
        catalogH1,
        "the catalog has no h1",
      ).toBeVisible({ timeout: 15_000 });
      await expect(catalogH1).toHaveText(/^Catalog/);

      const catalogLevels = await headingLevels(win);
      expect(
        catalogLevels[0],
        `the catalog's first heading is h${catalogLevels[0]}`,
      ).toBe(1);
      // The section headings are still h2 — the fix added a level above them
      // rather than promoting them.
      expect(catalogLevels.filter((level) => level === 2).length).toBeGreaterThan(
        0,
      );

      // ----- The map, whose own name used to be a `<span>`. -----
      const topBar = win.getByRole("banner");
      await topBar.getByRole("link", { name: /^Map$/i }).click();
      await expect(
        win.getByRole("heading", { name: /^Relationships$/i, level: 1 }),
        "the map page's own name is not its h1",
      ).toBeVisible({ timeout: 15_000 });

      const mapLevels = await headingLevels(win);
      expect(mapLevels[0], `the map's first heading is h${mapLevels[0]}`).toBe(1);
      expect(mapLevels.filter((level) => level === 2).length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  test("ATR-071 — the first Tab stop is a skip link, and it lands in main", async () => {
    const { app, close } = await launchApp();

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });

      // No click anywhere: a click sets Chromium's sequential-focus starting
      // point at whatever was clicked, which would make the first Tab mean
      // "the next stop after the top bar" rather than "the app's first stop".
      // Clear any first-paint focus instead, so the tab order starts where the
      // document does.
      await win.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur(),
      );

      // The claim as the DOM states it — the first focusable element in the
      // document is the skip link — and then the keyboard agreeing with it.
      const firstFocusable = await win.evaluate(() => {
        const el = document.querySelector<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
        );
        return {
          text: (el?.textContent ?? "").trim(),
          tag: el?.tagName.toLowerCase() ?? null,
        };
      });
      expect(
        firstFocusable.text,
        `the first focusable element in the document is <${firstFocusable.tag}> "${firstFocusable.text}"`,
      ).toBe("Skip to content");

      await win.keyboard.press("Tab");
      const first = await win.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return {
          text: (el?.textContent ?? "").trim(),
          tag: el?.tagName.toLowerCase() ?? null,
          height: el?.getBoundingClientRect().height ?? 0,
        };
      });

      expect(
        first.text,
        `the first Tab stop is <${first.tag}> "${first.text}", not a skip link`,
      ).toBe("Skip to content");
      // A skip link nobody can see while it is focused is the same as no skip
      // link: `sr-only` has to be lifted by the focus variant.
      expect(
        first.height,
        "the skip link is still clipped while focused",
      ).toBeGreaterThan(10);

      await win.keyboard.press("Enter");
      const landed = await win.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return { id: el?.id ?? null, tag: el?.tagName.toLowerCase() ?? null };
      });
      expect(
        landed.id,
        `activating the skip link landed focus on <${landed.tag}> instead of the main region`,
      ).toBe("main-content");
    } finally {
      await close();
    }
  });

  test("ATR-072 — every size comes from a named tier, and labels sit on the floor", async () => {
    const { app, close } = await launchApp();

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });

      /** The rule, read off whatever is on screen — the half that holds everywhere. */
      const auditScreen = async (screen: string) => {
        const audit = await typeScaleAudit(win);
        expect(
          audit.raw,
          `a rendered element on ${screen} still carries a raw font size`,
        ).toEqual([]);
        return audit;
      };

      /**
       * The 13px step is drawn, and it computes to 13.
       *
       * `text-body` is a theme token (`--text-body`), so this is also what says
       * the token produces a real utility rather than a class nothing matches:
       * a misdeclared step would leave these elements inheriting 16px. Asserted
       * only where the step is on screen, since the catalog's gallery view draws
       * no rail row — an empty list there would be a fact about the view, not
       * about the tier.
       */
      const expectStep = (
        audit: Awaited<ReturnType<typeof typeScaleAudit>>,
        screen: string,
      ): void => {
        expect(
          audit.body.length,
          `no text-body element rendered on ${screen}`,
        ).toBeGreaterThan(0);
        expect(
          audit.body.filter((b) => b.size !== 13),
          `a text-body element on ${screen} is not the 13px step`,
        ).toEqual([]);
      };

      // ----- The catalog: the route the tier decision was made on. -----
      const catalog = await auditScreen("/");

      // The tiers are live, and each computes to the number it claims.
      expect(
        catalog.label.length,
        "no .atr-label element rendered",
      ).toBeGreaterThan(0);
      expect(
        catalog.label.filter((l) => l.size !== 12),
        "an .atr-label element is not 12px",
      ).toEqual([]);
      expect(
        catalog.micro.length,
        "no .atr-micro element rendered",
      ).toBeGreaterThan(0);
      expect(
        catalog.micro.filter((m) => m.size !== 10),
        "an .atr-micro element is not 10px",
      ).toEqual([]);

      // And the finding itself: headings, tabs and column headers — the roles
      // that were being written at 9/10/11px — are on the floor now.
      expect(
        catalog.underFloor.filter((el) => el.size < 12),
        "a heading, tab or column header is still below 12px",
      ).toEqual([]);

      // ----- The table view: the repo name is one of the four sizes the sweep
      // moved, and it exists only on this view. -----
      await win
        .getByRole("group", { name: "View mode" })
        .getByRole("button", { name: "Table" })
        .click();
      await expect(win.locator("tbody tr").first()).toBeVisible({
        timeout: 10_000,
      });

      expectStep(await auditScreen("/ — table view"), "/ — table view");

      // ----- The map: where the legend glyphs and the node list are, the other
      // surface the sweep touched. Audited because this check only sees what is
      // on screen, and a size written on a screen the spec never opens is a
      // finding it cannot read. -----
      await win
        .getByRole("banner")
        .getByRole("link", { name: /^Map$/i })
        .click();
      await expect(
        win.getByRole("heading", { name: /^Relationships$/i, level: 1 }),
      ).toBeVisible({ timeout: 15_000 });

      expectStep(await auditScreen("/graph"), "/graph");
    } finally {
      await close();
    }
  });

  test("ATR-073 — the live-status dot is its own token, not the accent", async () => {
    const repoDir = seededRepoDir(SEEDED_REPO);
    let child: ChildProcess | null = null;
    const { app, close } = await launchApp();

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      const appTitle = win.getByRole("link", { name: /^AllTheRepos$/i });
      await expect(appTitle).toBeVisible({ timeout: 15_000 });

      const accent = await tokenColor(win, "--color-accent");
      const live = await tokenColor(win, "--color-status-live");
      expect(
        live,
        "the status token is the accent — ATR-073 is a rename, not a decision",
      ).not.toBe(accent);

      // Spawn a listener so both places the finding names exist: the port
      // column on /processes and the port chip on the repo's card.
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

      const topBar = win.getByRole("banner");
      await topBar.getByRole("link", { name: /^Running\b/i }).click();
      const refresh = win.getByRole("button", { name: /^refresh$/i });
      await expect(refresh).toBeEnabled({ timeout: 10_000 });
      await refresh.click();

      // ---- The port column's dot, in the process table. ----
      const row = win
        .locator("tbody tr")
        .filter({ has: win.locator(`span:text-is("${port}")`) });
      await expect(
        row,
        `the spawned listener on port ${port} never reached the process table`,
      ).toBeVisible({ timeout: 20_000 });

      const tableDot = await win.evaluate((wanted) => {
        const tr = Array.from(document.querySelectorAll("tbody tr")).find((r) =>
          (r.textContent ?? "").includes(String(wanted)),
        );
        const dot = tr
          ? Array.from(tr.querySelectorAll<HTMLElement>("span")).find((s) =>
              /(^|\s)bg-status-live(\s|$)/.test(s.className),
            )
          : undefined;
        if (!dot) return null;
        return {
          background: getComputedStyle(dot).backgroundColor,
          accentClass: /(^|\s)bg-accent(\s|$)/.test(dot.className),
        };
      }, port);

      expect(
        tableDot,
        "the process table's live dot is not using the status token",
      ).not.toBeNull();
      expect(tableDot!.accentClass, "the live dot is on `bg-accent` again").toBe(
        false,
      );
      expect(tableDot!.background).toBe(live);

      // ---- The port chip, on the repo's own card. ----
      await appTitle.click();
      const card = win.locator(`article[data-repo-slug^="${SEEDED_REPO}"]`);
      await expect(card).toBeVisible({ timeout: 15_000 });
      const chip = card.locator('button[aria-label^="Port "]').first();
      await expect(
        chip,
        "the card never rendered a port chip",
      ).toBeVisible({ timeout: 20_000 });

      const chipPaint = await chip.evaluate((el) => {
        const dot = el.querySelector<HTMLElement>("span > span:last-child");
        return {
          chipColor: getComputedStyle(el).color,
          dot: dot ? getComputedStyle(dot).backgroundColor : null,
          accentClass: /(^|\s)bg-accent(\s|$)/.test(dot?.className ?? ""),
        };
      });

      expect(chipPaint.accentClass, "the chip's dot is on `bg-accent` again").toBe(
        false,
      );
      expect(chipPaint.dot).toBe(live);
      expect(chipPaint.chipColor).toBe(live);
      expect(chipPaint.chipColor, "the chip wears the accent hue").not.toBe(
        accent,
      );
    } finally {
      child?.kill();
      await close();
    }
  });

  test("ATR-074 — Debug is not a destination, and an unpackaged run has both doors", async () => {
    const { app, close } = await launchApp();

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });
      const topBar = win.getByRole("banner");

      // ----- The finding: the nav is destinations only. -----
      expect(
        await win.locator("header nav a").count(),
        "the primary navigation is not the four destinations",
      ).toBe(NAV_LABELS.length);
      await expect(
        win
          .locator("header nav")
          .getByRole("link", { name: /^debug/i }),
        "Debug is back in the primary navigation",
      ).toHaveCount(0);

      // ----- The dev affordance, which this run is entitled to. -----
      // `out/` on a disk is not the app that ships, so the door is here — with a
      // name that says what it is, rather than the bare "Debug" the nav button
      // carried — and it sits outside the `<nav>` so the destination row cannot be
      // read as five items again.
      const devDoor = topBar.getByRole("link", {
        name: /^debug \(development build\)$/i,
      });
      await expect(
        devDoor,
        "an unpackaged run offers no door to /debug",
      ).toBeVisible({ timeout: 15_000 });
      expect(
        await win.locator("header nav").getByRole("link", { name: /^debug/i }).count(),
        "the dev door is inside the primary navigation",
      ).toBe(0);

      // ----- The door, which is the command palette's dev-tools action. -----
      await win.keyboard.press("Meta+K");
      const palette = win.getByRole("dialog", { name: /command palette/i });
      await expect(palette).toBeVisible({ timeout: 15_000 });
      await palette.getByPlaceholder(/run a command/i).fill("debug page");
      await expect(
        palette.getByText(/^open debug page$/i).first(),
        "the palette no longer carries the door to /debug — the page is now unreachable",
      ).toBeVisible({ timeout: 5_000 });
      await win.keyboard.press("Enter");

      await expect(palette).toBeHidden({ timeout: 5_000 });
      await expect(
        win.getByRole("heading", { name: /^\/debug — system\.ping$/i }),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await close();
    }
  });

  test("ATR-074 — a packaged build offers no dev-only affordance at all", async () => {
    // The branch a release takes, reached without building a DMG: main's
    // `ATR_FORCE_PACKAGED=1` override states "packaged" to the renderer and
    // changes nothing else about the run. What is under test is the whole chain —
    // main's window options, the preload's read of `process.argv`, the renderer's
    // one signal — because the assertions below can only pass if all three agree.
    const { app, close } = await launchApp({
      env: { ATR_FORCE_PACKAGED: "1" },
    });

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await expect(
        win.getByRole("link", { name: /^AllTheRepos$/i }),
      ).toBeVisible({ timeout: 15_000 });
      const topBar = win.getByRole("banner");

      // The destinations are untouched by the flag.
      expect(
        await win.locator("header nav a").count(),
        "the primary navigation is not the four destinations",
      ).toBe(NAV_LABELS.length);

      // And nothing in the chrome offers the dev page — not the nav, not the
      // affordance beside it, not a stray link anywhere in the header.
      await expect(
        topBar.getByRole("link", { name: /^debug/i }),
        "a Debug affordance is in the chrome of a packaged build",
      ).toHaveCount(0);

      // The palette is the other half, and it is the half the two callers had
      // been disagreeing about: the native menu dropped dev-only actions by build
      // mode while the palette listed them in every build.
      await win.keyboard.press("Meta+K");
      const palette = win.getByRole("dialog", { name: /command palette/i });
      await expect(palette).toBeVisible({ timeout: 15_000 });

      // It still works — an ordinary action is right there — so an empty palette
      // cannot pass this test.
      await palette.getByPlaceholder(/run a command/i).fill("settings");
      await expect(
        palette.getByText(/^open settings$/i).first(),
      ).toBeVisible({ timeout: 5_000 });

      await palette.getByPlaceholder(/run a command/i).fill("debug");
      await expect(
        palette.getByText(/^open debug page$/i),
        "a packaged build still offers Open Debug Page",
      ).toHaveCount(0);

      await palette.getByPlaceholder(/run a command/i).fill("devtools");
      await expect(
        palette.getByText(/^toggle devtools$/i),
        "a packaged build still offers Toggle DevTools",
      ).toHaveCount(0);

      await win.keyboard.press("Escape");
      await expect(palette).toBeHidden({ timeout: 5_000 });
    } finally {
      await close();
    }
  });
});
