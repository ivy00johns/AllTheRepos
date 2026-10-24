/**
 * The predicate behind a smart group — does this repo belong in that saved view?
 *
 * It lives here rather than inline in the catalog's filter pass because two
 * places now need the same answer: the grid (which repos to show when a smart
 * group is the active scope) and the rail (which number to put beside the
 * group's name). Two copies of this logic would drift the first time somebody
 * added a condition, and the failure is quiet — a row that claims 4 repos over
 * a grid holding 3.
 *
 * `null` is not "match nothing": a smart group whose filter is null is
 * unconstrained and matches the whole catalog. That is the documented reading in
 * `tests/unit/renderer/manual-group-filter.spec.ts`, and it is why creating a
 * filter with no conditions is refused by the dialog rather than saved as a
 * group that means "everything".
 */

import type { Repo, SmartFilter } from "@shared/types";

import { activityOf, lastTouched } from "./activity";

/**
 * The languages a saved filter can choose between: the ones in the catalog.
 *
 * Offering the full language list would let somebody save a filter over a stack
 * they have no repos in, which is a group that stays empty however the catalog
 * grows. Shared rather than re-derived per caller for the same reason the
 * predicate is: the rail's dialog and the banner's must offer one list.
 */
export function languagesInCatalog(repos: Repo[]): string[] {
  const present = new Set<string>();
  for (const repo of repos) {
    if (repo.primaryLanguage) present.add(repo.primaryLanguage);
  }
  return [...present].sort((a, b) => a.localeCompare(b));
}

/**
 * Whether a filter asks for archived folders.
 *
 * `includeArchived` is the one condition that is not a rejection, so it has no
 * branch in the predicate below: the catalog hides archived folders before any
 * group is consulted, and a group that wants them lifts that exclusion rather
 * than matching on it. Callers that do the excluding (`catalog-shell.tsx`, the
 * rail's count) ask here, so "the badge counts the rule" stays true.
 */
export function filterIncludesArchived(
  filter: SmartFilter | null | undefined,
): boolean {
  return filter?.includeArchived === true;
}

export function matchesSmartFilter(
  repo: Repo,
  filter: SmartFilter | null | undefined,
): boolean {
  if (!filter) return true;
  if (filter.favoritesOnly && !repo.isFavorite) return false;
  if (filter.language && repo.primaryLanguage !== filter.language) {
    return false;
  }
  if (
    filter.tagsInclude?.some((tag) => !repo.tags.some((t) => t.value === tag))
  ) {
    return false;
  }
  if (
    filter.tagsExclude?.some((tag) => repo.tags.some((t) => t.value === tag))
  ) {
    return false;
  }
  // `days === null` means the repo has never been committed to or opened, which
  // cannot satisfy "touched recently" — the same reading the catalog's sort and
  // activity chips use, so a repo cannot be "unknown" on its card and "recent"
  // inside a filter.
  if (
    filter.sinceDays !== undefined &&
    (activityOf(lastTouched(repo)).days ?? Infinity) > filter.sinceDays
  ) {
    return false;
  }
  if (filter.dirtyOnly && !repo.isDirty) return false;
  if (filter.hasRemote !== undefined && Boolean(repo.remoteUrl) !== filter.hasRemote) {
    return false;
  }
  return true;
}

/**
 * The conditions of a filter as short phrases, in the order they narrow.
 *
 * Used where the rule has to be readable rather than editable — the active-group
 * banner, above a grid whose scope it explains. It reads the stored filter, not
 * the dialog's draft, so it also describes conditions the dialog does not draw
 * (`tagsExclude`, `hasRemote`); a summary built from the draft would leave those
 * out and make a narrowed catalog look like a bug.
 *
 * An empty result means "everything", which is what a null filter means to the
 * predicate — never "no conditions, so nothing".
 */
export function describeSmartFilter(
  filter: SmartFilter | null | undefined,
): string[] {
  if (!filter) return [];
  const parts: string[] = [];
  if (filter.language) parts.push(`written in ${filter.language}`);
  if (filter.tagsInclude?.length) {
    parts.push(`tagged ${filter.tagsInclude.join(", ")}`);
  }
  if (filter.tagsExclude?.length) {
    parts.push(`not tagged ${filter.tagsExclude.join(", ")}`);
  }
  if (filter.sinceDays !== undefined) {
    parts.push(
      `touched in the last ${filter.sinceDays} day${filter.sinceDays === 1 ? "" : "s"}`,
    );
  }
  if (filter.dirtyOnly) parts.push("uncommitted changes");
  if (filter.favoritesOnly) parts.push("pinned repos");
  if (filter.includeArchived) parts.push("archived folders included");
  if (filter.hasRemote === true) parts.push("has a remote");
  if (filter.hasRemote === false) parts.push("no remote");
  return parts;
}
