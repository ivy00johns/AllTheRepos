/**
 * Shared markdown rendering helpers for the renderer.
 *
 * Owns the sanitize schema reused by both the README rendering in
 * `repo-detail-content.tsx` and the CLAUDE.md preview in
 * `components/claude/claude-tab.tsx`. Keeping it in one place avoids
 * the schema drifting between consumers — both rely on
 * rehype-raw + rehype-sanitize so embedded HTML (centered headers,
 * badges, images) survives without opening an XSS hole.
 */

import { defaultSchema } from "rehype-sanitize";

/**
 * Sanitize schema for user-authored markdown that may contain a
 * pragmatic amount of inline HTML (alignment, classes, images,
 * styled anchors). Extends rehype-sanitize's safe-by-default
 * allowlist — additions are limited to common README/CLAUDE.md
 * idioms (no script/iframe/etc).
 */
export const README_SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className", "style"],
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      "href",
      "target",
      "rel",
      "title",
    ],
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      "src",
      "alt",
      "title",
      "width",
      "height",
      "align",
    ],
    p: [...(defaultSchema.attributes?.p ?? []), "align"],
    div: [...(defaultSchema.attributes?.div ?? []), "align"],
    h1: [...(defaultSchema.attributes?.h1 ?? []), "align"],
    h2: [...(defaultSchema.attributes?.h2 ?? []), "align"],
    h3: [...(defaultSchema.attributes?.h3 ?? []), "align"],
  },
};
