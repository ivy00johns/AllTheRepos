/**
 * Turn the "New saved filter" dialog's fields into a `SmartFilter`.
 *
 * Pure, and separate from the dialog for the same reason
 * `lib/group-membership.ts` is separate from its hooks: the part that can be
 * wrong in a way nobody notices is the arithmetic — a blank field becoming
 * `language: ""`, which matches no repo at all, or a day count saved as the
 * string `"30"` and dropped by the schema. The dialog gets to be about layout.
 *
 * The draft keeps the raw strings the inputs hold. Empty string means "no
 * condition", not "the empty string", because a select that has not been touched
 * and a select set back to "Any language" are the same state to a user.
 */

import type { SmartFilter } from "@shared/types";

export interface SavedFilterDraft {
  /** A primary language name, or `""` for any. */
  language: string;
  /** Comma-separated tag list; every tag listed must be present. */
  tags: string;
  /** Whole days as typed; `""` for any age. */
  sinceDays: string;
  /** Only repos with uncommitted changes. */
  dirtyOnly: boolean;
  /** Only pinned repos. */
  favoritesOnly: boolean;
  /** Show the group's archived folders, which the catalog hides by default. */
  includeArchived: boolean;
}

export const EMPTY_SAVED_FILTER_DRAFT: SavedFilterDraft = {
  language: "",
  tags: "",
  sinceDays: "",
  dirtyOnly: false,
  favoritesOnly: false,
  includeArchived: false,
};

/**
 * Split a comma-separated tag field, trimming and dropping duplicates.
 *
 * Order is kept, and matching is case-sensitive on purpose: tags are the user's
 * own vocabulary, and the catalog's tag filter compares values exactly. Silent
 * case-folding here would save a filter that matches nothing while looking
 * identical to the one the user meant.
 */
export function parseSavedFilterTags(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of raw.split(",")) {
    const tag = part.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

/**
 * Why the day field cannot be saved, or `null` when it is fine.
 *
 * `"0"` is refused rather than treated as "any": a filter saying "touched in the
 * last 0 days" reads as a mistake, and quietly ignoring it would save a group
 * that matches every repo when the user asked for today's.
 */
export function savedFilterDaysError(draft: SavedFilterDraft): string | null {
  const raw = draft.sinceDays.trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    return "Enter a whole number of days, 1 or more.";
  }
  return null;
}

/**
 * Seed the dialog's fields from a stored filter.
 *
 * Missing keys become empty fields, not the string "undefined": a select with no
 * value shows "Any language", and a number input showing `undefined` would be
 * cleared and then saved back as a condition nobody chose.
 */
export function draftFromSmartFilter(
  filter: SmartFilter | null | undefined,
): SavedFilterDraft {
  return {
    language: filter?.language ?? "",
    tags: filter?.tagsInclude?.join(", ") ?? "",
    sinceDays: filter?.sinceDays === undefined ? "" : String(filter.sinceDays),
    dirtyOnly: filter?.dirtyOnly ?? false,
    favoritesOnly: filter?.favoritesOnly ?? false,
    includeArchived: filter?.includeArchived ?? false,
  };
}

/**
 * The filter to persist, or `null` when there is nothing to save.
 *
 * Only conditions that were set are written. An absent key and an `undefined`
 * key mean the same thing to the predicate, but the stored JSON is what somebody
 * reads when they open the database, and `{"language":""}` reads as a condition
 * that exists — the kind of thing that sends the next person looking for a bug.
 *
 * `previous` is supplied when EDITING an existing filter. The dialog owns six
 * conditions; the stored format also carries `tagsExclude` and `hasRemote`, which
 * it does not draw. Rebuilding from the draft alone would drop those the first
 * time somebody opened the dialog to fix a typo — the rule would quietly become
 * wider than it was. So the previous filter is the starting point and the
 * form-owned keys are replaced in place, while conditions the form cannot show
 * survive untouched.
 */
export function buildSmartFilter(
  draft: SavedFilterDraft,
  previous: SmartFilter | null = null,
): SmartFilter | null {
  const filter: SmartFilter = { ...(previous ?? {}) };
  // The form owns these six; whatever it shows is the whole truth for them,
  // including "unset".
  delete filter.language;
  delete filter.tagsInclude;
  delete filter.sinceDays;
  delete filter.dirtyOnly;
  delete filter.favoritesOnly;
  delete filter.includeArchived;

  const language = draft.language.trim();
  if (language) filter.language = language;

  const tags = parseSavedFilterTags(draft.tags);
  if (tags.length > 0) filter.tagsInclude = tags;

  const rawDays = draft.sinceDays.trim();
  if (rawDays) {
    // The dialog refuses to save while `savedFilterDaysError` reports, so this
    // is the second line of defence rather than a user-facing path.
    if (savedFilterDaysError(draft) !== null) return null;
    filter.sinceDays = Number(rawDays);
  }

  if (draft.dirtyOnly) filter.dirtyOnly = true;
  if (draft.favoritesOnly) filter.favoritesOnly = true;
  if (draft.includeArchived) filter.includeArchived = true;

  return Object.keys(filter).length > 0 ? filter : null;
}
