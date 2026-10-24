/**
 * Unit tests for turning the "New saved filter" dialog into a `SmartFilter`.
 *
 * The dialog is layout; this is the part that decides what gets stored. Three
 * failure modes are worth naming, because each produces a group that looks
 * correct in the rail and matches the wrong repos:
 *
 *   - a blank select saved as `language: ""`, which matches no repo at all;
 *   - the day count saved as a string, which `SmartFilterSchema` drops, turning
 *     "last 30 days" into "any time";
 *   - an empty draft saved as `{}`, a group that means the whole catalog.
 */

import { describe, expect, it } from "vitest";

import {
  buildSmartFilter,
  draftFromSmartFilter,
  EMPTY_SAVED_FILTER_DRAFT,
  parseSavedFilterTags,
  savedFilterDaysError,
  type SavedFilterDraft,
} from "@renderer/lib/saved-filter";

function draft(over: Partial<SavedFilterDraft> = {}): SavedFilterDraft {
  return { ...EMPTY_SAVED_FILTER_DRAFT, ...over };
}

describe("parseSavedFilterTags", () => {
  it("splits on commas and trims", () => {
    expect(parseSavedFilterTags(" cli , rust ")).toEqual(["cli", "rust"]);
  });

  it("drops blanks and duplicates, keeping first-seen order", () => {
    expect(parseSavedFilterTags("cli,,rust, cli ,")).toEqual(["cli", "rust"]);
  });

  it("returns nothing for a blank field", () => {
    expect(parseSavedFilterTags("   ")).toEqual([]);
  });

  it("does not fold case — tags are compared exactly", () => {
    expect(parseSavedFilterTags("CLI,cli")).toEqual(["CLI", "cli"]);
  });
});

describe("savedFilterDaysError", () => {
  it("accepts a blank field as 'any time'", () => {
    expect(savedFilterDaysError(draft())).toBeNull();
  });

  it("accepts whole days of 1 or more", () => {
    expect(savedFilterDaysError(draft({ sinceDays: "1" }))).toBeNull();
    expect(savedFilterDaysError(draft({ sinceDays: " 30 " }))).toBeNull();
  });

  it("refuses zero, negatives, fractions and text", () => {
    for (const value of ["0", "-3", "1.5", "abc", "3 days"]) {
      expect(savedFilterDaysError(draft({ sinceDays: value }))).not.toBeNull();
    }
  });
});

describe("draftFromSmartFilter", () => {
  it("seeds a blank draft from no filter", () => {
    expect(draftFromSmartFilter(null)).toEqual(EMPTY_SAVED_FILTER_DRAFT);
    expect(draftFromSmartFilter(undefined)).toEqual(EMPTY_SAVED_FILTER_DRAFT);
  });

  it("shows a stored filter in the form's own vocabulary", () => {
    expect(
      draftFromSmartFilter({
        language: "Rust",
        tagsInclude: ["cli", "rust"],
        sinceDays: 30,
        dirtyOnly: true,
        favoritesOnly: true,
        includeArchived: true,
      }),
    ).toEqual({
      language: "Rust",
      tags: "cli, rust",
      sinceDays: "30",
      dirtyOnly: true,
      favoritesOnly: true,
      includeArchived: true,
    });
  });

  it("leaves the boxes unticked for a filter that never set them", () => {
    // A stored filter from before these conditions existed has no keys for
    // them. The boxes have to read as off, not as the string "undefined".
    expect(draftFromSmartFilter({ language: "Go" })).toEqual({
      ...EMPTY_SAVED_FILTER_DRAFT,
      language: "Go",
    });
  });

  it("round-trips through buildSmartFilter unchanged", () => {
    const stored = {
      language: "Go",
      tagsInclude: ["a"],
      sinceDays: 7,
      favoritesOnly: true,
      includeArchived: true,
    };
    expect(buildSmartFilter(draftFromSmartFilter(stored))).toEqual(stored);
  });
});

describe("buildSmartFilter", () => {
  it("returns null when there is nothing to save", () => {
    expect(buildSmartFilter(draft())).toBeNull();
  });

  it("writes only the conditions that were set", () => {
    // Absent keys rather than `undefined` values: the stored JSON is read by
    // people, and `{"language":""}` reads as a condition that exists.
    expect(buildSmartFilter(draft({ language: "TypeScript" }))).toEqual({
      language: "TypeScript",
    });
    expect(buildSmartFilter(draft({ tags: "cli, rust" }))).toEqual({
      tagsInclude: ["cli", "rust"],
    });
    expect(buildSmartFilter(draft({ dirtyOnly: true }))).toEqual({
      dirtyOnly: true,
    });
    expect(buildSmartFilter(draft({ favoritesOnly: true }))).toEqual({
      favoritesOnly: true,
    });
    expect(buildSmartFilter(draft({ includeArchived: true }))).toEqual({
      includeArchived: true,
    });
  });

  it("saves the day count as a number", () => {
    // A string here would be dropped by the schema, silently widening the
    // filter to every repo.
    expect(buildSmartFilter(draft({ sinceDays: "30" }))).toEqual({ sinceDays: 30 });
  });

  it("combines every condition into one filter", () => {
    expect(
      buildSmartFilter(
        draft({
          language: "Rust",
          tags: "cli",
          sinceDays: "90",
          dirtyOnly: true,
          favoritesOnly: true,
          includeArchived: true,
        }),
      ),
    ).toEqual({
      language: "Rust",
      tagsInclude: ["cli"],
      sinceDays: 90,
      dirtyOnly: true,
      favoritesOnly: true,
      includeArchived: true,
    });
  });

  it("refuses an invalid day count instead of saving a wider filter", () => {
    expect(buildSmartFilter(draft({ sinceDays: "0" }))).toBeNull();
    expect(
      buildSmartFilter(draft({ language: "Rust", sinceDays: "abc" })),
    ).toBeNull();
  });

  it("does not treat an unchecked box as a condition", () => {
    expect(buildSmartFilter(draft({ dirtyOnly: false }))).toBeNull();
    expect(buildSmartFilter(draft({ favoritesOnly: false }))).toBeNull();
    expect(buildSmartFilter(draft({ includeArchived: false }))).toBeNull();
  });

  it("clears a box the form unticked when editing", () => {
    // The form is the whole truth for the conditions it draws: a stored
    // `favoritesOnly` whose box is now unticked is a condition the user removed.
    expect(
      buildSmartFilter(draft({ dirtyOnly: true }), {
        favoritesOnly: true,
        includeArchived: true,
      }),
    ).toEqual({ dirtyOnly: true });
  });

  // --- editing an existing filter -----------------------------------------

  it("replaces the conditions the form owns", () => {
    expect(
      buildSmartFilter(
        draft({ tags: "focus" }),
        { tagsInclude: ["typo"], sinceDays: 30 },
      ),
    ).toEqual({ tagsInclude: ["focus"] });
  });

  it("keeps conditions the form cannot draw", () => {
    // The dialog has no field for `tagsExclude` or `hasRemote`. Rebuilding from
    // its fields alone would silently widen the rule the first time somebody
    // fixed a tag.
    expect(
      buildSmartFilter(draft({ tags: "focus" }), {
        tagsExclude: ["archive"],
        hasRemote: false,
      }),
    ).toEqual({ tagsExclude: ["archive"], hasRemote: false, tagsInclude: ["focus"] });
  });

  it("still refuses to save an emptied filter over a filterless group", () => {
    expect(buildSmartFilter(draft(), null)).toBeNull();
  });

  it("keeps a preserved condition even when every field is cleared", () => {
    // Nothing to see in the form, but the group still has a rule — saving must
    // not turn it into "everything".
    expect(buildSmartFilter(draft(), { hasRemote: true })).toEqual({
      hasRemote: true,
    });
  });
});
