/**
 * The type scale is a decision, and this file is where it stops being re-litigated.
 *
 * The 2026-10-07 UI/UX review measured **127** sub-12px usages across 20+ files and
 * found one role written three ways: 9px, 10px and 11px were each used for uppercase
 * section labels and control captions *as well as* for metadata. `claude.tsx`'s
 * control label, `graph.tsx`'s section heading and the detail panel's tabs all sat
 * below the body text they described. That is not a style preference, it is
 * unreadable type on a dense catalog at the window's 800px minimum.
 *
 * ATR-072 asked for the tier to be decided once. It was: `globals.css` names every
 * one of them, and this test is what keeps a fifth from appearing —
 *
 *   - `.atr-label` — every label, caption and section heading: 12px, the floor.
 *   - `.atr-micro` — the one sanctioned sub-12px tier: a number or unit read as
 *     data (a badge count, a PID, a percentage), never a label or a sentence.
 *   - `.atr-meta`  — the metadata tier that already existed: 11px mono muted
 *     timestamps, paths and counts sitting inside running text.
 *   - `text-body`  — the 13px dense-content step, for the text a row is *about*:
 *     a rail row's own label, the repo name in the table, a legend glyph standing
 *     beside its `.atr-meta` caption. A theme token (`--text-body`) rather than a
 *     `@layer components` class, because `.atr-rail-row` is itself such a class and
 *     one of the four sizes below lived inside it — Tailwind 4 cannot `@apply` a
 *     component class, so the step has to be a real utility for the row and the
 *     components to name the same one.
 *
 * The rule is **no raw pixel font size in a component, at any value**, anywhere
 * under `src/renderer`. It began as a floor — below 12px, the band the finding
 * measured — and the four `text-[13px]` runs were carved out as above it. That
 * carve-out was the last hole in a rule whose whole value is that it has no edge to
 * argue about: the same escape hatch, written one pixel higher, would have been
 * invisible. The four now name `text-body` and the walk reports any size it finds,
 * `13px` included, along with the `rem`/`em` spellings of the same defect.
 *
 * A font size can also be written as a number rather than a class — cytoscape,
 * which paints the map's labels into a canvas, takes one and knows nothing about
 * classes — so the walk reports that form too. There are exactly two places a size
 * is allowed to be stated: the CSS tiers in `globals.css`, and `CANVAS_TYPE` in
 * `graph-canvas.tsx`, which names the map's steps for the same reason the tiers
 * exist.
 *
 * `globals.css` is the only file exempt from the class-list rule, because it is
 * the file that defines the tiers, so a size written there is the decision rather
 * than a violation of it. A rule written as "prefer the tokens" is one nobody can
 * enforce; this one is a line the walk below either finds or does not.
 *
 * The second test pins each tier to the one place it is defined and to the size it
 * claims, so a tier cannot be quietly deleted or re-sized while the walk stays
 * green. The third is a positive control: a walk that silently stopped finding
 * anything — a typo'd regex, a directory that moved — would turn this file green
 * and stay green, so both detectors are run over strings in memory first.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const RENDERER = path.join(ROOT, "src", "renderer");
const GLOBALS = path.join(RENDERER, "styles", "globals.css");

/**
 * A raw font size in a class list: `text-[13px]`, `md:text-[1.25rem]`.
 *
 * Deliberately not anchored to the start of a class: the sizes that were actually
 * wrong in this codebase are the responsive and variant forms (`md:text-[10px]`),
 * so a pattern that only saw `"text-[10px]` would have passed this repository
 * while the finding was open. The pixel size is captured without whatever
 * character preceded it, so a failure message quotes the class.
 *
 * The unit is part of the pattern because `rem` and `em` are the same defect
 * spelled differently: an arbitrary size no reviewer can weigh, in a file where a
 * named step already exists. Nothing under `src/renderer` used either when this
 * was widened, so the rule arrived with the escape hatch still closed.
 */
const RAW_SIZE = /(?:^|[\s"':])(text-\[([0-9.]+)(px|rem|em)\])/g;

/**
 * A font size given as a number: `"font-size": 10`, `fontSize: 12`.
 *
 * The canvas form of the same defect. The pattern deliberately reaches the
 * `min-zoomed-font-size` spelling too (a label's rendered size floor is a font
 * size in cytoscape's model), and reads a quoted value (`"font-size": "10px"`)
 * so the defect cannot hide behind a unit. A resolved value — `var(--text-body)`,
 * `CANVAS_TYPE.node` — has no digits and is left alone.
 */
const RAW_NUMERIC_SIZE = /[-\w]*font-?size["']?\s*:\s*["']?([0-9.]+(?:px|rem|em)?)/gi;

interface Offender {
  file: string;
  line: number;
  match: string;
  context: string;
}

/** Every lintable source file under a directory, sorted so a failure reads the same twice. */
function sourcesUnder(dir: string, skip?: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (skip !== undefined && full === skip) continue;
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Numeric font sizes in one file's text, with the line a person would open it at.
 *
 * `match` is normalised to `key: value` — the quoting and spacing a style object
 * happens to use is not what a failure message should send somebody looking for.
 */
function numericSizesIn(file: string, source: string): Offender[] {
  const out: Offender[] = [];
  const lines = source.split("\n");
  lines.forEach((text, index) => {
    for (const match of text.matchAll(RAW_NUMERIC_SIZE)) {
      // `parseFloat`, not `Number`: the group may carry a unit, and a size the
      // detector quietly dropped would be a finding nobody sees.
      const value = Number.parseFloat(match[1]);
      if (!Number.isFinite(value) || value <= 0) continue;
      out.push({
        file,
        line: index + 1,
        match: match[0].replace(/["']?\s*:\s*["']?/, ": "),
        context: text.trim().slice(0, 120),
      });
    }
  });
  return out;
}

/** Raw class-list font sizes in one file's text, with the line a person would open it at. */
function rawSizesIn(file: string, source: string): Offender[] {
  const out: Offender[] = [];
  const lines = source.split("\n");
  lines.forEach((text, index) => {
    for (const match of text.matchAll(RAW_SIZE)) {
      const value = Number(match[2]);
      if (!Number.isFinite(value) || value <= 0) continue;
      out.push({
        file,
        line: index + 1,
        match: match[1],
        context: text.trim().slice(0, 120),
      });
    }
  });
  return out;
}

describe("renderer type scale", () => {
  test("no component names its own font size", () => {
    const files = sourcesUnder(RENDERER, GLOBALS);
    // A walk that found nothing would pass the assertion below on an empty list.
    expect(files.length).toBeGreaterThan(20);
    // The exemption is by path, so prove the path it skips is the real one.
    expect(fs.existsSync(GLOBALS)).toBe(true);

    const sources = files.map((file) => ({
      file: path.relative(ROOT, file),
      source: fs.readFileSync(file, "utf8"),
    }));
    const found = sources.flatMap((s) => rawSizesIn(s.file, s.source));
    const numeric = sources.flatMap((s) => numericSizesIn(s.file, s.source));

    expect(
      found.map((o) => `${o.file}:${o.line} ${o.match} — ${o.context}`),
      "use a named step: .atr-label (12px, every label/caption/heading), .atr-micro (10px, a number or unit read as data), .atr-meta (11px metadata), text-body (13px, the text a row is about), or Tailwind's own text-xs/text-sm; see the tier contract in src/renderer/styles/globals.css",
    ).toEqual([]);

    // The canvas form: cytoscape takes a number, so a component that styles a
    // canvas has to name its steps instead. `CANVAS_TYPE` in the map is the one
    // place that is allowed, and this is what keeps it the one place.
    expect(
      numeric.map((o) => `${o.file}:${o.line} ${o.match} — ${o.context}`),
      "name the step instead of writing the number: the map's canvas type is CANVAS_TYPE in src/renderer/components/graph/graph-canvas.tsx, and everything else is a CSS tier",
    ).toEqual([]);
  });

  test("every tier is defined in one place, at the size it claims", () => {
    const css = fs.readFileSync(GLOBALS, "utf8");

    const tier = (name: string): string => {
      const block = new RegExp(`\\.${name} \\{([^}]*)\\}`).exec(css)?.[1];
      expect(block, `.${name} is not defined in globals.css`).toBeTruthy();
      return block ?? "";
    };

    // The floor the review asked for, and the one sanctioned exception.
    expect(tier("atr-label")).toContain("text-xs");
    expect(tier("atr-micro")).toContain("text-[10px]");
    // Unchanged on purpose: 11px is this tier's decision too, and it sets its own
    // colour and family, which is why nothing else may use it as a size.
    expect(tier("atr-meta")).toContain("text-[11px]");

    // The dense-content step: one token, and the class whose size cannot be
    // `@apply`'d from another component class has to reach it through the token.
    const body = /--text-body:\s*([^;]+);/.exec(css)?.[1]?.trim();
    expect(body, "--text-body is not declared in @theme").toBeTruthy();
    // 13px, whatever the unit spelling: the sweep that produced it moved 13px
    // type onto this step, so a token that drifted would move real text.
    const px = Number.parseFloat((body ?? "").replace(/rem$/, "")) * 16;
    expect(px, `--text-body is ${body}, which is not the 13px step`).toBe(13);
    expect(tier("atr-rail-row")).toContain("text-body");
  });

  test("the detector reports the forms that were actually wrong", () => {
    const fixture = [
      '<span className="text-[10px]">x</span>',
      '<span className="lg:not-sr-only text-[11px]">y</span>',
      // The band that used to be carved out. It is a raw size like any other:
      // nothing above the old floor is a name, so 13px is reported now too.
      '<span className="text-[13px]">w</span>',
      // The same defect in a different unit — an arbitrary size either way.
      '<span className="md:text-[1.25rem]">v</span>',
      // Named steps, left alone: the tiers are the fix, not a finding.
      '<span className="font-mono atr-micro">z</span>',
      '<span className="text-sm">q</span>',
      '<span className="text-body">r</span>',
    ].join("\n");

    const found = rawSizesIn("fixture.tsx", fixture);
    // Quoted without the character that preceded them, so a failure names the
    // class somebody would search for.
    expect(found.map((o) => o.match)).toEqual([
      "text-[10px]",
      "text-[11px]",
      "text-[13px]",
      "text-[1.25rem]",
    ]);
    // The line numbers are the ones a failure message would send somebody to.
    expect(found.map((o) => o.line)).toEqual([1, 2, 3, 4]);
    // A named tier is what a fix looks like, in any of the spellings it can take.
    expect(found.some((o) => o.match.includes("atr-"))).toBe(false);
    expect(found.some((o) => o.match === "text-body")).toBe(false);

    // The canvas form, including the two spellings the class pattern cannot see:
    // a quoted size, and the `min-zoomed-font-size` a label is dropped below.
    const numbers = [
      '"font-size": 10,',
      '"min-zoomed-font-size": 7,',
      'style={{ fontSize: "12px" }}',
      '"font-size": CANVAS_TYPE.node,',
      'style={{ "font-size": "var(--text-body)" }}',
    ].join("\n");

    const numeric = numericSizesIn("fixture.tsx", numbers);
    expect(numeric.map((o) => o.match)).toEqual([
      "font-size: 10",
      "min-zoomed-font-size: 7",
      "fontSize: 12px",
    ]);
    expect(numeric.map((o) => o.line)).toEqual([1, 2, 3]);
    // A named step has no digits in it, whichever name it is.
    expect(numeric.some((o) => o.match.includes("CANVAS_TYPE"))).toBe(false);
  });
});
