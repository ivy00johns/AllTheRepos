/**
 * The label tier is a decision, and this file is where it stops being re-litigated.
 *
 * The 2026-10-07 UI/UX review measured **127** sub-12px usages across 20+ files and
 * found one role written three ways: 9px, 10px and 11px were each used for uppercase
 * section labels and control captions *as well as* for metadata. `claude.tsx`'s
 * control label, `graph.tsx`'s section heading and the detail panel's tabs all sat
 * below the body text they described. That is not a style preference, it is
 * unreadable type on a dense catalog at the window's 800px minimum.
 *
 * ATR-072 asked for the tier to be decided once. It was: `globals.css` now names
 * exactly two of them, and this test is what keeps a third from appearing —
 *
 *   - `.atr-label` — every label, caption and section heading: 12px, the floor.
 *   - `.atr-micro` — the one sanctioned sub-12px tier: a number or unit read as
 *     data (a badge count, a PID, a percentage), never a label or a sentence.
 *   - `.atr-meta`  — the metadata tier that already existed: 11px mono muted
 *     timestamps, paths and counts sitting inside running text.
 *
 * The rule is **no raw pixel font size below 12px in a component**, anywhere
 * under `src/renderer` — the band the finding measured and the band the two
 * tiers exist for. `globals.css` is the only file exempt, because it is the file
 * that defines the tiers, so its own `@apply text-[10px]` is the decision rather
 * than a violation of it. A rule written as "prefer the tokens" is one nobody can
 * enforce; this one is a line the walk below either finds or does not.
 *
 * Deliberately not "no raw pixel size at all": the four `text-[13px]` runs in
 * this renderer (the repo name in the table, the two graph labels, and
 * `.atr-rail-row` in the stylesheet) are a different question, and folding them
 * into this rule would move real type on three surfaces to settle a finding
 * about sub-12px labels. The test says where its own edge is rather than leaving
 * it to be re-derived.
 *
 * The second test is a positive control. A walk that silently stopped finding
 * anything — a typo'd regex, a directory that moved — would turn this file green
 * and stay green, so the detector is run over strings in memory first.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const RENDERER = path.join(ROOT, "src", "renderer");
const GLOBALS = path.join(RENDERER, "styles", "globals.css");

/**
 * A raw pixel font size in a class list: `text-[10px]`, `sm:text-[11px]`.
 *
 * Deliberately not anchored to the start of a class: the sizes that were actually
 * wrong in this codebase are the responsive and variant forms (`md:text-[10px]`),
 * so a pattern that only saw `"text-[10px]` would have passed this repository
 * while the finding was open. The pixel size is captured without whatever
 * character preceded it, so a failure message quotes the class.
 */
const RAW_PX_SIZE = /(?:^|[\s"':])(text-\[([0-9.]+)px\])/g;

/** The floor the finding is about: below this, the tier has to be named. */
const FLOOR_PX = 12;

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

/** Sub-floor pixel sizes in one file's text, with the line a person would open it at. */
function rawSizesIn(file: string, source: string): Offender[] {
  const out: Offender[] = [];
  const lines = source.split("\n");
  lines.forEach((text, index) => {
    for (const match of text.matchAll(RAW_PX_SIZE)) {
      const size = Number(match[2]);
      if (!Number.isFinite(size) || size >= FLOOR_PX) continue;
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
  test("no component names its own pixel font size", () => {
    const files = sourcesUnder(RENDERER, GLOBALS);
    // A walk that found nothing would pass the assertion below on an empty list.
    expect(files.length).toBeGreaterThan(20);
    // The exemption is by path, so prove the path it skips is the real one.
    expect(fs.existsSync(GLOBALS)).toBe(true);

    const found = files.flatMap((file) =>
      rawSizesIn(path.relative(ROOT, file), fs.readFileSync(file, "utf8")),
    );

    expect(
      found.map((o) => `${o.file}:${o.line} ${o.match} — ${o.context}`),
      "use .atr-label (12px, every label/caption/heading) or .atr-micro (10px, a number or unit read as data); see the tier contract in src/renderer/styles/globals.css",
    ).toEqual([]);
  });

  test("the two tiers are defined in one place, at the sizes they claim", () => {
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
  });

  test("the detector reports the forms that were actually wrong", () => {
    const fixture = [
      '<span className="text-[10px]">x</span>',
      '<span className="lg:not-sr-only text-[11px]">y</span>',
      // Above the floor: out of scope on purpose, and asserted below so the
      // scope cannot drift into a silent pass.
      '<span className="text-[13px]">w</span>',
      '<span className="font-mono atr-micro">z</span>',
    ].join("\n");

    const found = rawSizesIn("fixture.tsx", fixture);
    // Quoted without the character that preceded them, so a failure names the
    // class somebody would search for.
    expect(found.map((o) => o.match)).toEqual([
      "text-[10px]",
      "text-[11px]",
    ]);
    // The line numbers are the ones a failure message would send somebody to.
    expect(found.map((o) => o.line)).toEqual([1, 2]);
    // The 13px run and the named tier are both left alone — the first by the
    // scope above, the second because a named tier is the fix, not a finding.
    expect(found.some((o) => o.match.includes("13px"))).toBe(false);
    expect(found.some((o) => o.match.includes("atr-"))).toBe(false);
  });
});
