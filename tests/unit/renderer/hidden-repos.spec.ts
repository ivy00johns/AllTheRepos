/**
 * Unit tests for the catalog's "what is hidden, and why" derivation.
 *
 * `hiddenReasons` is imported directly rather than re-implemented here: it is
 * pure (no DOM, no store, no IPC), so the spec can hold the real function to
 * account instead of a copy of it that drifts.
 *
 * Two properties matter. A reason appears only when the filter is genuinely
 * keeping something out — a chip naming a filter that hides nothing sends the
 * reader to a control that will not change the number. And the reasons come
 * back ranked by impact, because the whole point of putting a count on each one
 * is that the biggest cause is the one you read first.
 */

import { describe, expect, it } from "vitest";

import {
  emptyStateCopy,
  hiddenReasons,
  type HiddenReasonInput,
} from "@renderer/lib/hidden-repos";

/** The empty view: nothing filtered, so nothing hidden and nothing to name. */
const base: HiddenReasonInput = {
  counts: {},
  query: "",
  selectedDir: null,
  selectedDirExact: false,
  ownershipFilter: [],
  groupName: null,
  dirtyOnly: false,
};

describe("hiddenReasons", () => {
  it("names nothing when the catalog is showing everything", () => {
    expect(hiddenReasons(base)).toEqual([]);
  });

  it("omits a filter that is on but hiding nothing", () => {
    // The search box has text, yet the filtering pass attributed no exclusions
    // to it — so it gets no chip. A chip here would send the reader to a
    // control that cannot change the number.
    const reasons = hiddenReasons({
      ...base,
      counts: { archived: 35 },
      query: "vibe",
    });
    expect(reasons.map((r) => r.key)).toEqual(["archived"]);
  });

  it("carries each filter's own count", () => {
    const reasons = hiddenReasons({
      ...base,
      counts: { search: 41, favorites: 8, archived: 35 },
      query: "vibe",
    });
    expect(reasons).toEqual([
      { key: "search", label: "search “vibe”", count: 41 },
      { key: "archived", label: "Archived", count: 35 },
      { key: "favorites", label: "Favourites only", count: 8 },
    ]);
  });

  it("ranks by impact, not by the order the filters run", () => {
    // Pipeline order is search, favorites, archived, scope, ownership, group.
    // With these counts the order must come out archived, favorites, search.
    const reasons = hiddenReasons({
      ...base,
      counts: { search: 3, favorites: 20, archived: 35 },
      query: "vibe",
    });
    expect(reasons.map((r) => r.key)).toEqual(["archived", "favorites", "search"]);
    expect(reasons.map((r) => r.count)).toEqual([35, 20, 3]);
  });

  it("keeps pipeline order between reasons hiding the same number", () => {
    // Equal counts must not reshuffle, or the chips dance on every render.
    const reasons = hiddenReasons({
      ...base,
      counts: { archived: 12, favorites: 12, scope: 12 },
      selectedDir: "/Users/j/Repos/ai",
    });
    expect(reasons.map((r) => r.key)).toEqual(["favorites", "archived", "scope"]);
  });

  it("labels each reason the way its own control does", () => {
    const reasons = hiddenReasons({
      ...base,
      counts: {
        search: 5,
        dirty: 12,
        archived: 35,
        scope: 9,
        ownership: 4,
        group: 2,
      },
      query: "state machine",
      selectedDir: "/Users/j/Repos/ai",
      ownershipFilter: ["mine", "external"],
      groupName: "Work",
      dirtyOnly: true,
    });
    const byKey = Object.fromEntries(reasons.map((r) => [r.key, r.label]));
    expect(byKey.search).toBe("search “state machine”");
    expect(byKey.scope).toBe("folder ~/Repos/ai");
    expect(byKey.ownership).toBe("owner Mine, Cloned");
    expect(byKey.group).toBe("group “Work”");
    expect(byKey.archived).toBe("Archived");
    expect(byKey.dirty).toBe("Uncommitted only");
  });

  it("names the uncommitted view only while it is on", () => {
    // The count is attributed by the filtering pass whether or not the view is
    // on, so the flag is what decides whether there is a chip — and clearing a
    // chip that is not on screen would be a control with nothing to clear.
    expect(
      hiddenReasons({ ...base, counts: { dirty: 12 } }).map((r) => r.key),
    ).toEqual([]);
    expect(
      hiddenReasons({ ...base, counts: { dirty: 12 }, dirtyOnly: true }),
    ).toEqual([{ key: "dirty", label: "Uncommitted only", count: 12 }]);
  });

  it("distinguishes a folder scoped to its top level", () => {
    const reasons = hiddenReasons({
      ...base,
      counts: { scope: 4 },
      selectedDir: "/Users/j/Repos/ai",
      selectedDirExact: true,
    });
    expect(reasons[0]).toEqual({
      key: "scope",
      label: "folder ~/Repos/ai (top level)",
      count: 4,
    });
  });
});

describe("emptyStateCopy", () => {
  it("blames no filter when nothing is filtered", () => {
    // An empty catalog with every control off has no culprit to name, and
    // sending the reader to filters that are already off would be a lie.
    const copy = emptyStateCopy(hiddenReasons(base), { query: "", totalCount: 0 });
    expect(copy.culprit).toBeNull();
    expect(copy.title).toBe("Nothing here");
    expect(copy.hint).toMatch(/Add a folder to scan/);
  });

  it("names the filter that emptied the grid", () => {
    const hidden = hiddenReasons({
      ...base,
      counts: { archived: 273 },
    });
    const copy = emptyStateCopy(hidden, { query: "", totalCount: 273 });
    expect(copy.title).toBe("All 273 repos are hidden");
    expect(copy.hint).toBe("Hidden by Archived.");
    expect(copy.culprit).toEqual({ key: "archived", label: "Archived", count: 273 });
  });

  it("names the search when the search is why nothing shows", () => {
    const hidden = hiddenReasons({
      ...base,
      counts: { search: 273 },
      query: "zzz-no-such-repo",
    });
    const copy = emptyStateCopy(hidden, { query: "zzz-no-such-repo", totalCount: 273 });
    expect(copy.title).toBe("Nothing matches “zzz-no-such-repo”");
    expect(copy.hint).toBe("Hidden by search “zzz-no-such-repo”.");
  });

  it("blames the biggest of several filters and says how much of the hole it is", () => {
    // Two filters on, nothing shown: the fraction is the point — it is what
    // tells you clearing this one is only part of the way back.
    const hidden = hiddenReasons({
      ...base,
      counts: { ownership: 185, archived: 88 },
      ownershipFilter: ["mine"],
    });
    const copy = emptyStateCopy(hidden, { query: "", totalCount: 273 });
    expect(copy.culprit?.key).toBe("ownership");
    expect(copy.hint).toBe("Hidden by owner Mine — 185 of 273.");
    expect(copy.title).toBe("All 273 repos are hidden");
  });

  it("names the same filter the strip ranks first", () => {
    // The two surfaces read one list, so they cannot disagree about which
    // filter is responsible for the blank screen.
    const hidden = hiddenReasons({
      ...base,
      counts: { search: 3, favorites: 20, archived: 35 },
      query: "vibe",
    });
    const copy = emptyStateCopy(hidden, { query: "vibe", totalCount: 58 });
    expect(copy.culprit).toBe(hidden[0]);
    expect(copy.hint).toContain("Archived");
  });

  it("blames the archive, not the search, when the search is working", () => {
    // The query matched 35 repos and the archive hid all of them. "Nothing
    // matches “vibe”" would send the reader to rewrite a search that worked.
    const hidden = hiddenReasons({
      ...base,
      counts: { search: 238, archived: 35 },
      query: "vibe",
    });
    const copy = emptyStateCopy(hidden, { query: "vibe", totalCount: 273 });
    expect(copy.culprit?.key).toBe("search");
    // The search hid more, so it is what the title speaks for.
    expect(copy.title).toBe("Nothing matches “vibe”");
    expect(copy.hint).toBe("Hidden by search “vibe” — 238 of 273.");

    const archiveHeavy = hiddenReasons({
      ...base,
      counts: { search: 3, archived: 35 },
      query: "vibe",
    });
    const other = emptyStateCopy(archiveHeavy, { query: "vibe", totalCount: 273 });
    expect(other.culprit?.key).toBe("archived");
    expect(other.title).toBe("All 273 repos are hidden");
    expect(other.hint).toBe("Hidden by Archived — 35 of 273.");
  });

  it("drops the fraction when the catalog total is not known yet", () => {
    // A total of 0 means the caller has no catalog size, and "2 of 0" is not
    // a sentence.
    const hidden = hiddenReasons({ ...base, counts: { favorites: 2 } });
    const copy = emptyStateCopy(hidden, { query: "", totalCount: 0 });
    expect(copy.title).toBe("Nothing here");
    expect(copy.hint).toBe("Hidden by Favourites only.");
  });
});
