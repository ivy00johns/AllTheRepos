/**
 * Why the catalog is not showing everything, ranked by what is causing it.
 *
 * The toolbar used to read `238 of 273` and stop there: a difference with no
 * explanation and no way out except hunting the rail, the chips and the search
 * box for whichever control was responsible. The number is honest, but a count
 * that cannot say *why* it is smaller than the catalog turns every filter into
 * a puzzle.
 *
 * This module turns a tally of what each filter is keeping out into a ranked
 * list the UI can render — biggest cause first, so the chip that gives back the
 * most repos is the one your eye lands on.
 *
 * The tally is produced by the filtering pass itself (one rejection per repo,
 * attributed to the first filter that rejects it), which is what makes the
 * numbers trustworthy: they are disjoint, they sum exactly to the repos missing
 * from the grid, and each one names a set of repos rather than an estimate. A
 * count computed by re-running each predicate independently would double-count
 * a repo that two filters both exclude, and the chips would not add up to the
 * difference the count states.
 *
 * Deliberately pure — no DOM, no store, no actions — so the shell keeps
 * ownership of *what clearing means* (a route param, a store field) and these
 * labels and their ordering stay unit-testable without rendering anything.
 */

import { OWNERSHIP_LABELS, type Ownership } from "@renderer/lib/ownership";
import { tildify } from "@renderer/lib/repo-tree";

/** The DOM id of the strip that lists these — the count's `aria-controls`. */
export const HIDDEN_REASONS_ID = "catalog-hidden-reasons";

export type HiddenReasonKey =
  | "search"
  | "dirty"
  | "favorites"
  | "archived"
  | "scope"
  | "ownership"
  | "group";

/**
 * The order the catalog applies the filters in. It is the tie-break when two
 * reasons are keeping out the same number of repos, so the ranked list never
 * reshuffles on equal counts.
 */
const PIPELINE_ORDER: readonly HiddenReasonKey[] = [
  "search",
  "dirty",
  "favorites",
  "archived",
  "scope",
  "ownership",
  "group",
];

export interface HiddenReason {
  key: HiddenReasonKey;
  /** Short phrase naming the filter, for a chip. The count is rendered beside it. */
  label: string;
  /** How many repos this filter alone is keeping out of the current view. */
  count: number;
}

export interface HiddenReasonInput {
  /** Repos each filter is keeping out, from the filtering pass. */
  counts: Partial<Record<HiddenReasonKey, number>>;
  /** The trimmed search text; `""` when not searching. */
  query: string;
  selectedDir: string | null;
  selectedDirExact: boolean;
  ownershipFilter: readonly Ownership[];
  /** The active group's name, or `null` when the whole catalog is in scope. */
  groupName: string | null;
  /** Whether the uncommitted-only view is on. */
  dirtyOnly: boolean;
}

export function hiddenReasons(input: HiddenReasonInput): HiddenReason[] {
  const counts = input.counts;
  const reasons: HiddenReason[] = [];

  /** A reason appears only when it is genuinely keeping something out. */
  const add = (key: HiddenReasonKey, count: number | undefined, label: string) => {
    if ((count ?? 0) > 0) reasons.push({ key, label, count: count as number });
  };

  add("search", counts.search, `search “${input.query}”`);
  if (input.dirtyOnly) {
    add("dirty", counts.dirty, "Uncommitted only");
  }
  add("favorites", counts.favorites, "Favourites only");
  add("archived", counts.archived, "Archived");
  if (input.selectedDir) {
    // The label has to match what the scope chip above says, or the two read as
    // different facts about the same filter.
    const where = input.selectedDirExact
      ? `${tildify(input.selectedDir)} (top level)`
      : tildify(input.selectedDir);
    add("scope", counts.scope, `folder ${where}`);
  }
  if (input.ownershipFilter.length > 0) {
    const labels = input.ownershipFilter
      .map((kind) => OWNERSHIP_LABELS[kind])
      .join(", ");
    add("ownership", counts.ownership, `owner ${labels}`);
  }
  if (input.groupName) {
    add("group", counts.group, `group “${input.groupName}”`);
  }

  // Ranked by impact, then by pipeline order so equal counts hold their places.
  return reasons.sort(
    (a, b) =>
      b.count - a.count ||
      PIPELINE_ORDER.indexOf(a.key) - PIPELINE_ORDER.indexOf(b.key),
  );
}

/** The words the grid shows in place of repos, and the filter to blame. */
export interface EmptyStateCopy {
  title: string;
  hint: string;
  /**
   * The filter keeping out the most — the one worth clearing first. `null`
   * when nothing is filtered, i.e. the catalog really is empty.
   */
  culprit: HiddenReason | null;
}

/**
 * Derive the empty grid's copy from the same ranked reasons as the strip.
 *
 * The grid used to work this out for itself with a chain of guesses: if a
 * folder was selected blame the folder, else if any archived repos existed
 * blame the archive, else shrug ("Try a different search, or clear the
 * filters"). That was a second, hand-rolled opinion about which filter is
 * responsible — and a worse one than the real one, because it could name a
 * filter that was hiding nothing (an archived repo can exist while the folder
 * scope is what emptied the grid) or shrug when the answer was known.
 *
 * Taking the first entry of the ranked list instead makes the two surfaces
 * agree by construction: the strip and the empty grid name the same filter,
 * and the moment the culprit is cleared the next-biggest takes its place.
 *
 * `culprit.count` is "repos this filter is keeping out", not "repos clearing
 * it gives back", so the hint reports it against the catalog total and never
 * promises the grid will fill.
 */
export function emptyStateCopy(
  hidden: readonly HiddenReason[],
  opts: { query: string; totalCount: number },
): EmptyStateCopy {
  const culprit = hidden[0] ?? null;
  const total = opts.totalCount;

  if (!culprit) {
    // Nothing is filtered, so there is no filter to blame: the scope really
    // does hold nothing. Saying so beats sending the reader to controls that
    // are already off.
    // `hiddenReasons` comes back empty with a query on it only when the search
    // matched the entire catalog, and with nothing on screen that means the
    // catalog is empty. So the search is not what to explain here — the
    // missing folders are.
    return {
      title: opts.query ? `Nothing matches “${opts.query}”` : "Nothing here",
      hint: "No repos are catalogued in this scope yet. Add a folder to scan.",
      culprit: null,
    };
  }

  // When one filter accounts for the whole empty grid the count *is* the
  // catalog, and "273 of 273" says nothing the title doesn't. Name the filter
  // and stop there. With several filters in play the fraction is the point:
  // it tells you how much of the hole this one is responsible for. A total of
  // 0 means the caller has no catalog size yet, so a fraction would read
  // "2 of 0".
  const hint =
    total > 0 && culprit.count < total
      ? `Hidden by ${culprit.label} — ${culprit.count} of ${total}.`
      : `Hidden by ${culprit.label}.`;

  // The title follows the culprit, not the search box. A query that matched 35
  // repos which the archive then hid must not read "Nothing matches" — clearing
  // the archive is what brings those 35 back, and the title would have sent the
  // reader to rewrite a search that was working.
  const title =
    culprit.key === "search"
      ? `Nothing matches “${opts.query}”`
      : total > 0
        ? `All ${total} repos are hidden`
        : "Nothing here";

  return { title, hint, culprit };
}
