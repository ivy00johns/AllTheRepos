/**
 * Description repair.
 *
 * The scanner stores whatever the first block of the README looked like
 * into `Repo.description`. For a large slice of a real catalog that is
 * raw README chrome — `<p align="center">`, a wall of shields.io badges,
 * or a row of "English | 中文 | 日本語" translation links — none of which
 * tells you what the project IS. That defeats the whole point of the
 * catalog: you should be able to glance at a card and remember
 * "oh right, that's the voxel-world thing".
 *
 * `cleanDescription` takes the stored description (and optionally the
 * full README as a fallback source) and extracts the first line of real
 * human prose, or `null` when the source genuinely has none.
 *
 * This is a PURE function with no DOM or Node dependency so it can run
 * in the renderer, in the main process, and under vitest unchanged.
 */

/** Minimum length for a line to count as a real description. */
const MIN_PROSE_LENGTH = 24;

/** Never let a card description run longer than this. */
const MAX_PROSE_LENGTH = 240;

/**
 * Strip HTML comments and tags. READMEs lean heavily on
 * `<p align="center">`, `<div align="center">`, `<img>`, `<a>`, and
 * `<picture>/<source>` blocks for their hero sections.
 */
function stripHtml(input: string): string {
  return input
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ");
}

/**
 * Strip markdown that carries no prose: fenced code, badge links,
 * bare images, reference definitions, and horizontal rules.
 *
 * Badges are the single biggest offender — `[![Build](img)](href)` —
 * and they must be removed BEFORE plain links are unwrapped, otherwise
 * the alt text ("Build", "License: MIT", "codecov") survives and reads
 * like a description.
 */
function stripNonProseMarkdown(input: string): string {
  return (
    input
      // Fenced code blocks.
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/~~~[\s\S]*?~~~/g, " ")
      // Badge: an image wrapped in a link.
      .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, " ")
      // Bare image.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      // Reference-style badge/image (`[![x]][y]`, `![x][y]`).
      .replace(/\[!\[[^\]]*\]\[[^\]]*\]\]\[[^\]]*\]/g, " ")
      .replace(/!\[[^\]]*\]\[[^\]]*\]/g, " ")
      // Link reference definitions on their own line.
      .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, " ")
      // Horizontal rules.
      .replace(/^\s*([-*_])\s*(\1\s*){2,}$/gm, " ")
      // HTML entities that survive tag stripping.
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

/**
 * Unwrap `[text](url)` to `text` and drop leading markdown decoration
 * (heading hashes, blockquote carets, list bullets, emphasis runs).
 */
function unwrapInlineMarkdown(line: string): string {
  return (
    line
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s{0,3}>\s?/, "")
      .replace(/^\s{0,3}[-*+]\s+/, "")
      .replace(/^\s{0,3}\d+\.\s+/, "")
      .replace(/\*\*|__|`/g, "")
      .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$)/g, "$1$2")
      // A bare URL trailing real prose ("...from my youtube playlist
      // https://…") shouldn't disqualify the line — drop the URL and keep
      // the sentence. Lines that were ONLY links collapse to punctuation
      // and get rejected by `looksLikeProse` on word count instead.
      .replace(/<?https?:\/\/\S+>?/gi, " ")
      .replace(/\s+([.,;:!?])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

/**
 * A translation-switcher row: "English | [中文](./README_zh.md) | ...".
 * After link unwrapping these become short pipe-separated language
 * names, so detect on the pipe density rather than the link syntax.
 */
function isLanguageSwitcher(line: string): boolean {
  const parts = line.split("|").map((p) => p.trim());
  if (parts.length < 3) return false;
  // Every segment short and word-like ⇒ it's a nav row, not a sentence.
  return parts.every((p) => p.length > 0 && p.length <= 24 && !/[.!?]/.test(p));
}

/**
 * A line that is really just a title: the repo name, a slogan in title
 * case with no verb, or a bare heading. These are weak descriptions but
 * still better than nothing, so they're accepted only as a last resort.
 */
function looksLikeProse(line: string): boolean {
  if (line.length < MIN_PROSE_LENGTH) return false;
  // Needs several words.
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  // Needs to be mostly letters, not punctuation/symbol soup.
  const letters = line.replace(/[^\p{L}]/gu, "").length;
  if (letters < line.length * 0.5) return false;
  // Trailing bullet/pipe residue left by a link-only line.
  if (!/\p{L}{3}/u.test(line)) return false;
  if (isLanguageSwitcher(line)) return false;
  return true;
}

/** Trim to a sentence boundary when possible, else hard-truncate. */
function clamp(line: string): string {
  if (line.length <= MAX_PROSE_LENGTH) return line;
  const cut = line.slice(0, MAX_PROSE_LENGTH);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "));
  if (lastStop > MIN_PROSE_LENGTH) return cut.slice(0, lastStop + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : MAX_PROSE_LENGTH)}…`;
}

/** Run one source string through the full pipeline, return first prose line. */
function extractProse(source: string): string | null {
  const cleaned = stripNonProseMarkdown(stripHtml(source));
  const lines = cleaned
    .split(/\r?\n/)
    .map(unwrapInlineMarkdown)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const line of lines) {
    if (looksLikeProse(line)) return clamp(line);
  }
  return null;
}

/**
 * Produce a human-readable one-liner for a repo.
 *
 * Tries the stored `description` first; if that turns out to be README
 * chrome, falls back to mining the README body. Returns `null` when
 * neither source yields real prose — callers should render an explicit
 * empty state rather than an empty string.
 */
export function cleanDescription(
  description: string | null | undefined,
  readme?: string | null,
): string | null {
  if (description) {
    const fromDescription = extractProse(description);
    if (fromDescription) return fromDescription;
  }
  if (readme) {
    const fromReadme = extractProse(readme);
    if (fromReadme) return fromReadme;
  }
  return null;
}

/**
 * True when the stored description is unusable chrome. Used by the UI to
 * decide whether to show a "no description" affordance versus the repaired
 * text, and by the detail panel to explain where its text came from.
 */
export function isChromeDescription(
  description: string | null | undefined,
): boolean {
  if (!description || !description.trim()) return true;
  return extractProse(description) === null;
}
