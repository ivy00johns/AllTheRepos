/**
 * GitHub linguist color palette — top ~40 languages for the language bar.
 * Hex values are intentionally present here because GitHub's linguist palette
 * IS the source of truth (not a design token). These are data, not styling.
 */
export const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Rust: "#dea584",
  Go: "#00ADD8",
  Java: "#b07219",
  Kotlin: "#A97BFF",
  Swift: "#F05138",
  "Objective-C": "#438eff",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Shell: "#89e051",
  Bash: "#89e051",
  PowerShell: "#012456",
  HTML: "#e34c26",
  CSS: "#563d7c",
  SCSS: "#c6538c",
  Sass: "#a53b70",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Elixir: "#6e4a7e",
  Erlang: "#B83998",
  Haskell: "#5e5086",
  Lua: "#000080",
  Dart: "#00B4AB",
  Scala: "#c22d40",
  Clojure: "#db5855",
  OCaml: "#3be133",
  R: "#198CE7",
  Julia: "#a270ba",
  "Jupyter Notebook": "#DA5B0B",
  TeX: "#3D6117",
  Dockerfile: "#384d54",
  YAML: "#cb171e",
  JSON: "#292929",
  Markdown: "#083fa1",
  MDX: "#fcb32c",
  SQL: "#e38c00",
  Nix: "#7e7eff",
  Zig: "#ec915c",
  Solidity: "#AA6746",
};

const FALLBACK_COLOR = "#94a3b8"; // matches --color-muted-foreground

export function colorForLanguage(name: string | null | undefined): string {
  if (!name) return FALLBACK_COLOR;
  return LANGUAGE_COLORS[name] ?? FALLBACK_COLOR;
}
