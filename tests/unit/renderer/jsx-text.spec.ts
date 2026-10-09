/**
 * No renderer module may write a comment where JSX renders text.
 *
 * In JSX, children are text: a comment is only a comment when it sits inside
 * braces (`{/* … *\/}`) or outside the returned element. Written bare between
 * two children it is content, and content is what a person sees — a paragraph of
 * code-looking prose sitting above the page. That is the whole failure: nothing
 * in typecheck, lint or this suite notices it, because the file is valid, the
 * build is clean, and the only thing wrong is on screen.
 *
 * Two forms, and only one of them is a comment to every parser involved:
 *
 *   - `// …` is JSX text to TypeScript's parser *and* a rendered string to the
 *     bundler, so it reaches the DOM on any toolchain.
 *   - `/* … *\/` is trivia to TypeScript and a comment to esbuild — which is what
 *     this repository's renderer is transformed with, so it does not render
 *     here. It is still forbidden: the parsers disagree about it, it is a text
 *     node the moment the toolchain changes, and a rule with an exception in it
 *     is one somebody re-derives wrong later.
 *
 * A text child is not merely cosmetic either. The shell's column is a flex
 * container, so a stray text node becomes an anonymous flex item with
 * `min-height: auto`: it cannot shrink, and it takes its own height out of the
 * main region — which is how a comment managed to cost `main` real pixels while
 * every height assertion in the E2E still passed.
 *
 * The second test is a positive control. A detector that silently stopped
 * finding anything would turn this file green and stay green, so both forms are
 * parsed from strings in memory and asserted to be reported.
 */

import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const RENDERER = path.join(ROOT, "src", "renderer");

interface Offender {
  file: string;
  line: number;
  /** Which shape it is — the two differ in how they render, not in whether they may exist. */
  form: "line" | "block";
  text: string;
}

/** Every `.tsx` under a directory, sorted so a failure reads the same twice. */
function tsxFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx")) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Comments sitting where JSX renders text.
 *
 * The TypeScript parser is used rather than a regex because the two forms land
 * in different places: `//` becomes a `JsxText` node, while `/* … *\/` is
 * consumed as trivia attached to the child that follows it. So the text nodes
 * are checked directly, and the gaps between children — opening tag to first
 * child, child to child, last child to closing tag — are checked as raw source.
 * A comment inside braces lives inside a child's own range and is never in a
 * gap, which is what keeps `{/* … *\/}` legal here.
 */
function offendersIn(file: string, source: string): Offender[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const out: Offender[] = [];

  /**
   * Report at the comment itself rather than at the node that contains it.
   * `offset` is where the offending run starts inside `text`, so a failure names
   * the line somebody would open the file at — not the line the *element* does.
   */
  const report = (
    form: Offender["form"],
    pos: number,
    offset: number,
    text: string,
  ): void => {
    out.push({
      file,
      line: sf.getLineAndCharacterOfPosition(pos + offset).line + 1,
      form,
      text: text.trim().slice(0, 120),
    });
  };

  const checkGap = (from: number, to: number): void => {
    if (to <= from) return;
    const gap = source.slice(from, to);
    const at = gap.indexOf("/*");
    if (at !== -1) report("block", from, at, gap);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const start = node.getStart(sf);
      const raw = node.getText(sf);
      // `//` — the form that renders on every toolchain.
      const line = raw.split("\n").find((l) => l.trimStart().startsWith("//"));
      if (line !== undefined) report("line", start, raw.indexOf(line), line);
      // `/*` — kept inside a text node by parsers that treat children verbatim.
      const block = raw.indexOf("/*");
      if (block !== -1) report("block", start, block, raw);
    }

    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const children = node.children as readonly ts.Node[];
      if (children.length > 0) {
        const openEnd = ts.isJsxElement(node)
          ? node.openingElement.end
          : node.openingFragment.end;
        const closeStart = ts.isJsxElement(node)
          ? node.closingElement.getStart(sf)
          : node.closingFragment.getStart(sf);

        checkGap(openEnd, children[0].getStart(sf));
        for (let i = 1; i < children.length; i += 1) {
          checkGap(children[i - 1].end, children[i].getStart(sf));
        }
        checkGap(children[children.length - 1].end, closeStart);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return out;
}

/** The same element written both wrong ways and once the way that is allowed. */
const LINE_FORM = [
  "const a = (",
  "  <div>",
  "    // a line comment",
  "    <span>hi</span>",
  "  </div>",
  ");",
].join("\n");

const BLOCK_FORM = [
  "const a = (",
  "  <div>",
  "    /*",
  "     * a block comment",
  "     */",
  "    <span>hi</span>",
  "  </div>",
  ");",
].join("\n");

const BRACED_FORM = [
  "const a = (",
  "  <div>",
  "    {/* a comment where it belongs */}",
  "    <span>hi</span>",
  "  </div>",
  ");",
].join("\n");

describe("comments in JSX child position", () => {
  test("no renderer module writes one", () => {
    const files = tsxFilesUnder(RENDERER);
    // A walk that found nothing would pass every assertion below.
    expect(files.length).toBeGreaterThan(0);

    const found = files.flatMap((file) =>
      offendersIn(path.relative(ROOT, file), fs.readFileSync(file, "utf8")),
    );

    expect(
      found.map((o) => `${o.file}:${o.line} [${o.form}] ${o.text}`),
      "a comment in JSX child position is rendered text — move it above the return, or wrap it in braces",
    ).toEqual([]);
  });

  test("the detector reports both forms, and leaves the braced one alone", () => {
    const line = offendersIn("fixture.tsx", LINE_FORM);
    expect(line.map((o) => o.form)).toEqual(["line"]);
    expect(line[0]?.text).toContain("// a line comment");

    const block = offendersIn("fixture.tsx", BLOCK_FORM);
    expect(block.map((o) => o.form)).toEqual(["block"]);
    expect(block[0]?.text).toContain("a block comment");

    // Both fixtures put their comment on line 3, so the reported line is the
    // one a person would open the file at.
    expect(line[0]?.line).toBe(3);
    expect(block[0]?.line).toBe(3);

    // `{/* … */}` is the form the rule asks for, so it must not be reported.
    expect(offendersIn("fixture.tsx", BRACED_FORM)).toEqual([]);
  });
});
