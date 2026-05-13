/**
 * Curated file-extension → language mapping with GitHub linguist colors.
 * Direct port of `lib/languages.ts`.
 */

export interface LanguageInfo {
  name: string;
  color: string;
}

export const LANGUAGES: Record<string, LanguageInfo> = {
  TypeScript: { name: "TypeScript", color: "#3178c6" },
  JavaScript: { name: "JavaScript", color: "#f1e05a" },
  TSX: { name: "TSX", color: "#2b7489" },
  JSX: { name: "JSX", color: "#f1e05a" },
  Python: { name: "Python", color: "#3572A5" },
  Ruby: { name: "Ruby", color: "#701516" },
  Go: { name: "Go", color: "#00ADD8" },
  Rust: { name: "Rust", color: "#dea584" },
  Java: { name: "Java", color: "#b07219" },
  Kotlin: { name: "Kotlin", color: "#A97BFF" },
  Swift: { name: "Swift", color: "#F05138" },
  "C++": { name: "C++", color: "#f34b7d" },
  C: { name: "C", color: "#555555" },
  "C#": { name: "C#", color: "#178600" },
  "Objective-C": { name: "Objective-C", color: "#438eff" },
  PHP: { name: "PHP", color: "#4F5D95" },
  Perl: { name: "Perl", color: "#0298c3" },
  Shell: { name: "Shell", color: "#89e051" },
  Lua: { name: "Lua", color: "#000080" },
  Dart: { name: "Dart", color: "#00B4AB" },
  Elixir: { name: "Elixir", color: "#6e4a7e" },
  Erlang: { name: "Erlang", color: "#B83998" },
  Haskell: { name: "Haskell", color: "#5e5086" },
  Clojure: { name: "Clojure", color: "#db5855" },
  Scala: { name: "Scala", color: "#c22d40" },
  R: { name: "R", color: "#198CE7" },
  Julia: { name: "Julia", color: "#a270ba" },
  HTML: { name: "HTML", color: "#e34c26" },
  CSS: { name: "CSS", color: "#563d7c" },
  SCSS: { name: "SCSS", color: "#c6538c" },
  Vue: { name: "Vue", color: "#41b883" },
  Svelte: { name: "Svelte", color: "#ff3e00" },
  Markdown: { name: "Markdown", color: "#083fa1" },
  YAML: { name: "YAML", color: "#cb171e" },
  JSON: { name: "JSON", color: "#292929" },
  TOML: { name: "TOML", color: "#9c4221" },
  Dockerfile: { name: "Dockerfile", color: "#384d54" },
  SQL: { name: "SQL", color: "#e38c00" },
  Zig: { name: "Zig", color: "#ec915c" },
  Nix: { name: "Nix", color: "#7e7eff" },
  Solidity: { name: "Solidity", color: "#AA6746" },
};

const EXT_TO_LANG: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TSX",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  jsx: "JSX",
  py: "Python",
  pyi: "Python",
  rb: "Ruby",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  swift: "Swift",
  cpp: "C++",
  cc: "C++",
  cxx: "C++",
  hpp: "C++",
  hh: "C++",
  c: "C",
  h: "C",
  cs: "C#",
  m: "Objective-C",
  mm: "Objective-C",
  php: "PHP",
  pl: "Perl",
  pm: "Perl",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  fish: "Shell",
  lua: "Lua",
  dart: "Dart",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  hrl: "Erlang",
  hs: "Haskell",
  clj: "Clojure",
  cljs: "Clojure",
  scala: "Scala",
  sc: "Scala",
  r: "R",
  jl: "Julia",
  html: "HTML",
  htm: "HTML",
  css: "CSS",
  scss: "SCSS",
  sass: "SCSS",
  vue: "Vue",
  svelte: "Svelte",
  md: "Markdown",
  mdx: "Markdown",
  yml: "YAML",
  yaml: "YAML",
  json: "JSON",
  toml: "TOML",
  sql: "SQL",
  zig: "Zig",
  nix: "Nix",
  sol: "Solidity",
};

const FILENAME_TO_LANG: Record<string, string> = {
  Dockerfile: "Dockerfile",
  "Dockerfile.dev": "Dockerfile",
  "Dockerfile.prod": "Dockerfile",
};

export function languageForPath(filename: string): LanguageInfo | null {
  const base = filename.split("/").pop() ?? filename;
  const byName = FILENAME_TO_LANG[base];
  if (byName) return LANGUAGES[byName] ?? null;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  const lang = EXT_TO_LANG[ext];
  return lang ? (LANGUAGES[lang] ?? null) : null;
}

export function colorForLanguage(name: string): string {
  return LANGUAGES[name]?.color ?? "#8b8b8b";
}
