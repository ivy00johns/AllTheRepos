import type { Config } from "tailwindcss";

/**
 * Tailwind 4 is configuration-light: theme tokens live in
 * `@theme` blocks inside `globals.css` and content scanning is
 * auto-discovered. This file is intentionally minimal — it exists
 * only as a content-glob safety net pinned to the renderer tree,
 * so a refactor that introduces a missed import path can't silently
 * tree-shake away utility classes.
 *
 * If you find yourself reaching for `theme.extend` here, push the
 * change into `globals.css`'s `@theme` block instead.
 */
const config: Config = {
  content: [
    "./index.html",
    "./**/*.{ts,tsx}",
  ],
};

export default config;
