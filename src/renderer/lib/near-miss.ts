/**
 * The repos closest to a search that matched nothing.
 *
 * A search with no hits leaves a blank grid and one piece of advice — retype
 * the query — which is the least useful thing to say to somebody who has just
 * mistyped one word in eight. The repo they meant is almost always still in the
 * catalog; the query is what missed it.
 *
 * This module answers the other question: *which* repos are closest to what was
 * typed, and on the strength of which of their own words. It reads the catalog
 * the renderer already holds, so it costs no IPC and works while the backend is
 * unreachable — the same reason the rail's tree is derived here rather than
 * asked for.
 *
 * Deliberately pure — no DOM, no store, no search call — so the ranking rules
 * stay unit-testable and the shell keeps owning what picking a suggestion means.
 *
 * The rules, in the order they matter:
 *
 *   1. A word that is the whole of what was typed — spelled right, or a letter
 *      or two out — is the strongest evidence there is.
 *   2. A word that only overlaps the query is weaker, and no amount of overlap
 *      lets it overtake a mistyped whole word: "Liber" is not closer to
 *      "liberary" than "Library" is, it is just shorter.
 *   3. Where the words come from is weighted — the repo's name counts for more
 *      than a word in its description, because the name is what you were
 *      reaching for.
 *   4. A repo has to account for most of the query to be offered at all. Half a
 *      query matching is not a near miss, it is every repo in the catalog.
 */

import type { Repo } from "@shared/types";

/** Where a suggestion's evidence came from, most telling first. */
export type NearMissField = "name" | "folder" | "language" | "description";

export interface NearMiss {
  repo: Repo;
  /**
   * 0..1 — how much of the query this repo's own words account for, weighted by
   * where those words live. Not a search score and not comparable to one: this
   * is a similarity to a query that matched *nothing*.
   */
  score: number;
  /** Which of the repo's fields the best evidence came from. */
  field: NearMissField;
  /** The repo's word that came closest to the query. */
  matchedOn: string;
}

export interface NearMissOptions {
  /** How many to offer. Three fills a line without becoming a result list. */
  limit?: number;
  /** Below this share of the query, a repo is noise rather than a near miss. */
  minScore?: number;
}

/**
 * A repo's own words, weighted by how much they say about what you meant.
 *
 * The folder is below the name and above the language: two repos can share a
 * name in different folders, and the folder is the half that tells them apart.
 */
const FIELD_WEIGHTS: Record<NearMissField, number> = {
  name: 1,
  folder: 0.9,
  language: 0.8,
  description: 0.7,
};

/** Below this, a word is too short to be evidence of anything. */
const MIN_WORD = 3;

/** Two words further apart than this are different words, not a typo. */
const MIN_EDIT_RATIO = 0.8;

/**
 * The bands a match lands in, and why there are two of them.
 *
 * A word that is the whole of what was typed is a different kind of evidence
 * from a word that merely overlaps it, and the kind has to outrank the degree:
 * a five-letter prefix of the query is not nearer to it than the query's own
 * word misspelled by a letter. Graded on one scale, the two disagree — a prefix
 * of any length scored the same 0.9, above every typo weaker than 0.9 — which
 * is what put a repo called "Liber" above the "Library" that was meant.
 *
 * So the kinds get disjoint bands. A typo scores in [0.8, 0.99] and a partial
 * overlap in [0.45, 0.79], the partial ceiling sitting below the typo floor. The
 * ordering is then a property of the kinds rather than of whichever words two
 * repos happen to contain.
 *
 * The two cannot meet: for a word contained in the query (or the query in it),
 * the edit distance *is* the length gap, so a partial overlap of 0.8 or more of
 * the longer word is already inside `MIN_EDIT_RATIO` and is graded — correctly —
 * as a typo. What reaches the partial band is always a word accounting for less
 * than four fifths of the longer one.
 */
const TYPO_FLOOR = MIN_EDIT_RATIO;
const TYPO_CEIL = 0.99;
const PARTIAL_FLOOR = 0.45;
const PARTIAL_CEIL = MIN_EDIT_RATIO - 0.01;

/**
 * Split text into comparable words: lowercase, on anything that is not a letter
 * or a digit. `andrej-karpathy-skills` and `VibeOS` are three words and one.
 */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/** The directory a repo sits in, as its own word. */
function folderWord(fullPath: string): string {
  const cut = fullPath.lastIndexOf("/");
  return cut === -1 ? "" : fullPath.slice(cut + 1);
}

/**
 * How close one typed word is to one of a repo's words.
 *
 * Read top to bottom: the strongest kind of match wins outright, and only a
 * word that fails it falls through to the weaker kind. See the bands above.
 *
 * A word the query starts with — the repo's word is a prefix of what was typed —
 * is deliberately not given a band of its own. It looks like the strongest
 * possible partial, and it is the one that caused the mis-ordering, but it can
 * be graded on the same coverage scale as everything else: five letters of
 * eight is not a near miss of eight letters.
 */
function similarity(query: string, word: string): number {
  if (query === word) return 1;
  // Checked before the length floor so a short word still matches itself: a
  // query of "ai" against a repo called AI is exact, not too short to judge.
  if (query.length < MIN_WORD || word.length < MIN_WORD) return 0;

  const longest = Math.max(query.length, word.length);
  const shortest = Math.min(query.length, word.length);

  // A typo: the whole word, spelled near enough. The length gate comes first
  // because a distance can never be smaller than the gap between the two
  // lengths — so a pair more than a fifth apart cannot clear the ratio and the
  // table is never built for it. That is what keeps this in a render path.
  if (longest - shortest <= longest * (1 - MIN_EDIT_RATIO)) {
    const ratio = 1 - editDistance(query, word) / longest;
    if (ratio >= MIN_EDIT_RATIO) {
      const climbed = (ratio - MIN_EDIT_RATIO) / (1 - MIN_EDIT_RATIO);
      return TYPO_FLOOR + (TYPO_CEIL - TYPO_FLOOR) * climbed;
    }
  }

  // Otherwise the two words only overlap, and how good that is is how much of
  // the longer one the shorter accounts for. "Liber" against "liberary" is five
  // letters of eight; "lib" against "library" is three of seven, and shares too
  // little to be worth offering.
  if (word.startsWith(query) || query.startsWith(word) || word.includes(query)) {
    const covered = shortest / longest;
    return PARTIAL_FLOOR + (PARTIAL_CEIL - PARTIAL_FLOOR) * covered;
  }

  return 0;
}

/**
 * Levenshtein distance, two rows at a time.
 *
 * Both arguments are single words, so the table is small; and the length gate
 * in {@link similarity} means it is only built for pairs already the same size
 * to within a letter or two — which is why it can sit in a render path without
 * being a problem.
 */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = Array.from({ length: b.length + 1 }, () => 0);
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitute = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitute);
    }
    previous = current;
  }
  return previous[b.length];
}

/** Every word of a repo, tagged with where it came from. */
function candidatesOf(repo: Repo): Array<{ field: NearMissField; word: string }> {
  const out: Array<{ field: NearMissField; word: string }> = [];
  const push = (field: NearMissField, text: string) => {
    for (const word of words(text)) out.push({ field, word });
  };
  push("name", repo.name);
  push("folder", folderWord(repo.fullPath));
  push("language", repo.primaryLanguage ?? "");
  push("description", repo.description ?? "");
  return out;
}

/**
 * Rank the catalog by how close each repo is to a query that found no hits.
 *
 * Returns `[]` for a query with no words in it, and for a catalog none of whose
 * repos clear `minScore` — a suggestion list is an answer, and "here are three
 * arbitrary repos" is not one.
 */
export function nearMisses(
  query: string,
  repos: readonly Repo[],
  opts: NearMissOptions = {},
): NearMiss[] {
  const limit = opts.limit ?? 3;
  const minScore = opts.minScore ?? 0.6;
  const terms = words(query);
  if (terms.length === 0 || limit <= 0) return [];
  const squashed = terms.join("");

  const scored: NearMiss[] = [];

  for (const repo of repos) {
    const candidates = candidatesOf(repo);
    if (candidates.length === 0) continue;

    let sum = 0;
    let squashedValue = 0;
    let bestValue = 0;
    let bestField: NearMissField | null = null;
    let bestWord = "";

    const consider = (value: number, field: NearMissField, word: string) => {
      if (value > bestValue) {
        bestValue = value;
        bestField = field;
        bestWord = word;
      }
    };

    for (const term of terms) {
      let termBest = 0;
      for (const candidate of candidates) {
        const value = similarity(term, candidate.word) * FIELD_WEIGHTS[candidate.field];
        if (value > termBest) termBest = value;
        if (value > 0) consider(value, candidate.field, candidate.word);
      }
      sum += termBest;
    }

    // The other shape of near miss: a query typed as one word against a name
    // that is two. "vibe os" for VibeOS is one term away in each direction, and
    // judged word by word it looks like half a match.
    //
    // Only a word about as long as the whole query can be the whole query typed
    // as one word. Without the length stop, a squashed "demolibrar" would
    // prefix-match "demo" and hand every demo repo a near-perfect score off one
    // word of the query.
    if (terms.length > 1) {
      for (const candidate of candidates) {
        if (Math.abs(candidate.word.length - squashed.length) > 2) continue;
        const value =
          similarity(squashed, candidate.word) * FIELD_WEIGHTS[candidate.field];
        if (value > squashedValue) squashedValue = value;
        if (value > 0) consider(value, candidate.field, candidate.word);
      }
    }

    const score = Math.max(sum / terms.length, squashedValue);
    if (score < minScore || bestValue <= 0) continue;
    scored.push({
      repo,
      score,
      field: bestField ?? "name",
      matchedOn: bestWord,
    });
  }

  // Ties break on the name so the list holds still between renders.
  return scored
    .sort(
      (a, b) => b.score - a.score || a.repo.name.localeCompare(b.repo.name),
    )
    .slice(0, limit);
}
