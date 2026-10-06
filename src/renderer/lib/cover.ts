/**
 * Generated project covers.
 *
 * The hardest problem in a 100+ repo catalog is recall: you remember a
 * project as "the voxel world thing", not as `mc-gen-2`. Text alone
 * can't carry that — a wall of monospace names is uniform by
 * construction, so nothing sticks.
 *
 * Every repo therefore gets a cover. When the project ships a real image
 * (a README hero, a logo, an icon on disk) that image IS the cover. When
 * it doesn't, this module synthesises one that is *deterministic* and
 * *distinct*: the same repo always renders the same artwork, and two
 * neighbouring repos essentially never collide, because hue, motif,
 * rotation and density are drawn from independent slices of the hash.
 *
 * The result is a stable visual fingerprint you learn without effort —
 * which is the entire point.
 *
 * PURE module: no DOM, no Node, no IPC.
 */

/** Motifs are visually distinct at thumbnail size, not just different. */
export type CoverMotif =
  | "grid"
  | "rings"
  | "waves"
  | "diagonals"
  | "dots"
  | "blocks"
  | "arcs"
  | "triangles";

const MOTIFS: readonly CoverMotif[] = [
  "grid",
  "rings",
  "waves",
  "diagonals",
  "dots",
  "blocks",
  "arcs",
  "triangles",
];

export interface GeneratedCover {
  /** Base hue, 0–359. */
  hue: number;
  /** Secondary hue for the gradient's far stop. */
  hueB: number;
  motif: CoverMotif;
  /** Motif rotation in degrees. */
  rotation: number;
  /** Motif density multiplier, roughly 0.7–1.4. */
  density: number;
  /** 1–2 uppercase characters drawn over the artwork. */
  initials: string;
  /** Stable numeric seed, exposed for SVG element ids. */
  seed: number;
}

/**
 * FNV-1a. Chosen over a naive `charCodeAt` sum because adjacent slugs
 * (`app-v1` / `app-v2`) must land far apart in hue space, and a sum puts
 * them next to each other.
 */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Pull an independent value out of the hash.
 *
 * This runs a full murmur3 finalizer rather than a single multiply. One
 * multiply leaves neighbouring seeds correlated after the modulo, which
 * showed up as `app-v1` and `app-v2` landing 8° apart in hue — visually
 * identical, which defeats the point of the cover. The finalizer's
 * avalanche spreads them across the whole range.
 */
function slice(seed: number, index: number, modulo: number): number {
  // Every step re-applies `>>> 0`: JavaScript's `^` yields a SIGNED
  // int32, so without it the final xor can go negative — which produced
  // negative hues and an out-of-range (undefined) motif for roughly half
  // of all inputs.
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h % modulo;
}

/**
 * Initials from a repo name.
 *
 * Splits on the separators real repo names use (`-`, `_`, `.`, spaces,
 * camelCase boundaries) so `the-hive-ecosystem` → `TH` and `QuantDinger`
 * → `QD`, which are far more memorable than the first two letters.
 */
export function initialsFor(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "?";
  if (words.length === 1) {
    const word = words[0];
    return word.length === 1
      ? word.toUpperCase()
      : `${word[0]}${word[1]}`.toUpperCase();
  }
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

/**
 * Hues to avoid so generated art never impersonates a status colour.
 * The catalog uses green for "active/clean", amber for "dirty" and red
 * for "missing"; a cover in those hues would read as a state badge.
 */
function avoidStatusHues(hue: number): number {
  // Green 100–160, amber/red 0–50 are reserved.
  if (hue >= 100 && hue <= 160) return hue + 80;
  if (hue <= 50) return hue + 200;
  return hue;
}

/**
 * Derive a cover from a repo's stable identity.
 *
 * Keyed on `slug` (unique per repo) rather than `name`, so two repos that
 * share a name in different folders still get different artwork — which
 * matters on a machine that has both `Repos/x/api` and `Repos/y/api`.
 */
export function generatedCover(slug: string, name: string): GeneratedCover {
  const seed = hash(slug);
  const hue = avoidStatusHues(slice(seed, 1, 360));
  return {
    hue,
    hueB: (hue + 40 + slice(seed, 2, 90)) % 360,
    motif: MOTIFS[slice(seed, 3, MOTIFS.length)],
    rotation: slice(seed, 4, 4) * 45,
    density: 0.7 + slice(seed, 5, 8) / 10,
    initials: initialsFor(name),
    seed,
  };
}

/**
 * Candidate on-disk locations for a project's own artwork, in preference
 * order. Consumed by the main-process cover resolver — kept here so the
 * list lives next to the fallback it replaces.
 */
export const COVER_FILE_CANDIDATES: readonly string[] = [
  "docs/screenshot.png",
  "docs/screenshot.jpg",
  "docs/preview.png",
  "docs/hero.png",
  "docs/assets/header.png",
  "assets/screenshot.png",
  "assets/preview.png",
  "assets/logo.png",
  "assets/banner.png",
  ".github/banner.png",
  ".github/hero.png",
  "screenshot.png",
  "screenshot.jpg",
  "preview.png",
  "banner.png",
  "logo.png",
  "logo.svg",
  "icon.png",
  "public/og-image.png",
  "public/logo.png",
  "public/favicon.svg",
  "static/logo.png",
];
