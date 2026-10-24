/**
 * Unit tests for the manual-group membership arithmetic.
 *
 * `lib/group-membership.ts` is imported directly, not re-implemented: it has no
 * imports of its own, so the spec can hold the real functions to account.
 *
 * Why this is worth its own file: `groups:setMembers` REPLACES a group's whole
 * member set, so every "add" in the UI is a read-modify-write. The union is the
 * step that can lose data — write back a union computed from a set that was
 * read a minute ago and everyone added since then is deleted. The tests below
 * pin the arithmetic (order, duplicates, no-ops) and then the contract that
 * makes it safe: the write is computed from the set read immediately before it.
 */

import { describe, expect, it } from "vitest";

import {
  addGroupMembers,
  removeGroupMembers,
  slugsInGroup,
  slugsNotInGroup,
} from "@renderer/lib/group-membership";

describe("addGroupMembers", () => {
  it("fills an empty group with what was selected", () => {
    expect(addGroupMembers([], ["alpha", "beta"])).toEqual(["alpha", "beta"]);
  });

  it("keeps the members already there and appends the additions", () => {
    // The bug this guards: a "add" that writes only the selection, silently
    // emptying the group of everyone else.
    expect(addGroupMembers(["alpha", "beta"], ["gamma"])).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("does not duplicate a repo that is already a member", () => {
    expect(addGroupMembers(["alpha"], ["alpha", "beta"])).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("is a no-op when everything selected is already in the group", () => {
    expect(addGroupMembers(["alpha", "beta"], ["beta"])).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("collapses repeats in the requested list", () => {
    expect(addGroupMembers([], ["alpha", "alpha", "beta"])).toEqual([
      "alpha",
      "beta",
    ]);
  });
});

describe("removeGroupMembers", () => {
  it("drops exactly what was named and keeps the rest", () => {
    expect(removeGroupMembers(["alpha", "beta", "gamma"], ["beta"])).toEqual([
      "alpha",
      "gamma",
    ]);
  });

  it("removing a repo that is not a member changes nothing", () => {
    expect(removeGroupMembers(["alpha"], ["zeta"])).toEqual(["alpha"]);
  });

  it("empties the group when everything is removed", () => {
    expect(removeGroupMembers(["alpha", "beta"], ["alpha", "beta"])).toEqual(
      [],
    );
  });
});

describe("the deltas the notice quotes", () => {
  it("counts only the requested slugs an add would actually move", () => {
    // \"Add 3 to Frontend\" must not claim three when two were already there.
    expect(slugsNotInGroup(["alpha", "beta"], ["alpha", "gamma", "delta"])).toEqual(
      ["gamma", "delta"],
    );
  });

  it("counts only the requested slugs a removal would actually move", () => {
    expect(slugsInGroup(["alpha", "beta"], ["beta", "zeta"])).toEqual(["beta"]);
  });
});

describe("read-modify-write against a replacing setMembers", () => {
  /** The one behaviour that matters about the IPC channel. */
  const replace = (
    _groupId: number,
    slugs: string[],
    store: Map<number, string[]>,
  ) => {
    store.set(_groupId, [...slugs]);
  };

  it("keeps a member added since any cached read", () => {
    const store = new Map([[1, ["alpha"]]]);
    const cachedRead = ["alpha"];
    // Somebody else's window added `newer` after the cache was filled.
    replace(1, addGroupMembers(["alpha", "newer"], []), store);

    // The safe write: union against a read taken just before it.
    const freshRead = [...(store.get(1) ?? [])];
    replace(1, addGroupMembers(freshRead, ["beta"]), store);

    expect(store.get(1)).toEqual(["alpha", "newer", "beta"]);

    // And the unsafe one, for contrast — same group, same intent, `newer` gone.
    const staleStore = new Map([[1, ["alpha", "newer"]]]);
    replace(1, addGroupMembers(cachedRead, ["beta"]), staleStore);
    expect(staleStore.get(1)).toEqual(["alpha", "beta"]);
  });
});
