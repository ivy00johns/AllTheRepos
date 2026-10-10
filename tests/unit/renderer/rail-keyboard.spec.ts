/**
 * Unit tests for the map rail's keyboard.
 *
 * The rail is the keyboard's only way onto the map — cytoscape paints the
 * nodes into a canvas, so a dot cannot be focused — which makes the two things
 * here load-bearing rather than cosmetic:
 *
 *   - `railTarget`: which key lands on which option. A wrong answer is a
 *     control that skips rows, or one that swallows Home and End.
 *   - `focusRailOption`: whether the cursor actually arrives. The history
 *     behind this test is the reason the function exists — the cursor was
 *     deferred a frame, the option ended up selected but not focused, and
 *     `workstream-b`'s ATR-069 spec caught it on the built app while every
 *     unit test stayed green. Both branches are pinned here so the next change
 *     to the policy fails at the desk rather than in CI.
 *
 * The policy is driven through its port rather than through a rendered list
 * because this suite runs in Node with no DOM (`vitest.config.ts`: one config,
 * `environment: "node"`), and adding a browser environment for two branches
 * would be a larger change than the code under test.
 */

import { describe, expect, it } from "vitest";

import {
  focusRailOption,
  railStop,
  railTarget,
  type RailFocusPort,
} from "@renderer/lib/rail-keyboard";

/** The keys the rail owns, and where each lands from the middle of five. */
describe("railTarget", () => {
  it("moves down and right by one", () => {
    expect(railTarget("ArrowDown", 1, 4)).toBe(2);
    expect(railTarget("ArrowRight", 1, 4)).toBe(2);
  });

  it("moves up and left by one, which are the same move here", () => {
    // The rail is a column, so the two axes name one move rather than two.
    expect(railTarget("ArrowUp", 3, 4)).toBe(2);
    expect(railTarget("ArrowLeft", 3, 4)).toBe(2);
  });

  it("wraps at both ends, because the list is closed", () => {
    expect(railTarget("ArrowDown", 4, 4)).toBe(0);
    expect(railTarget("ArrowUp", 0, 4)).toBe(4);
  });

  it("sends Home and End to the ends", () => {
    expect(railTarget("Home", 3, 4)).toBe(0);
    expect(railTarget("End", 1, 4)).toBe(4);
  });

  it("claims nothing else — a key it does not own is not a move", () => {
    // `null` rather than the current index: the caller preventDefaults on a
    // move, and swallowing Enter or a Tab would be a real bug, not a tidy-up.
    for (const key of ["Enter", " ", "Tab", "Escape", "a", "PageDown"]) {
      expect(railTarget(key, 2, 4)).toBeNull();
    }
  });

  it("has nowhere to move in an empty list", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
      expect(railTarget(key, 0, -1)).toBeNull();
    }
  });
});

describe("railStop", () => {
  it("clamps to the last option when the list shrank under the cursor", () => {
    // Opening a group replaces the repo list with the group list; an index
    // past the end would leave the rail with no tabbable option at all.
    expect(railStop(5, 3)).toBe(2);
    expect(railStop(2, 3)).toBe(2);
  });

  it("never returns a negative index for a list that has options", () => {
    expect(railStop(-1, 3)).toBe(0);
  });

  it("says an empty list has no stop", () => {
    expect(railStop(0, 0)).toBe(-1);
    expect(railStop(7, -1)).toBe(-1);
  });
});

/**
 * A stand-in for the page: it records what was focused, and lets a test place
 * the frame the policy deferred instead of waiting for a real one.
 *
 * `remount` is the shape the deferred attempt was written for — opening a
 * group builds new option elements and the focused one leaves the document,
 * which is what drops focus to the body in a real window.
 */
function makePage(count: number) {
  const focusedIndexes: number[] = [];
  const focusedElements: HTMLElement[] = [];
  const body = { name: "body" } as unknown as Element;
  const elsewhere = { name: "search field" } as unknown as Element;

  let options: HTMLElement[] = [];
  let active: Element = body;
  let pending: (() => void) | null = null;

  const build = (): void => {
    options = Array.from({ length: count }, (_, index) => {
      const element = {
        focus: () => {
          focusedIndexes.push(index);
          focusedElements.push(element);
          active = element;
        },
      } as unknown as HTMLElement;
      return element;
    });
  };

  build();

  const port: RailFocusPort = {
    optionAt: (index) => options[index] ?? null,
    activeElement: () => active,
    fallback: () => body,
    afterFrame: (again) => {
      pending = again;
    },
  };

  return {
    port,
    focusedIndexes,
    focusedElements,
    /** The list was rebuilt — new elements, and the old focus is gone. */
    remount: (): void => {
      build();
      active = body;
    },
    /** Focus left for another control without the list changing. */
    clickElsewhere: (): void => {
      active = elsewhere;
    },
    /** Run the frame the policy asked for, if it asked for one. */
    frame: (): void => {
      const again = pending;
      pending = null;
      again?.();
    },
  };
}

describe("focusRailOption", () => {
  it("puts the cursor on the option in the frame that asked for it", () => {
    // The regression: this used to happen a frame late, and the ATR-069 spec
    // read `document.activeElement` in between.
    const page = makePage(3);

    focusRailOption(1, page.port);

    expect(page.focusedIndexes).toEqual([1]);
  });

  it("puts it back — on the new element — when a group open rebuilt the list", () => {
    const page = makePage(3);

    focusRailOption(1, page.port);
    const before = page.focusedElements[0];

    page.remount();
    page.frame();

    expect(page.focusedIndexes).toEqual([1, 1]);
    // The second call has to be the element that is *there* now: focusing the
    // detached one again is the bug this branch exists to avoid.
    expect(page.focusedElements[1]).not.toBe(before);
  });

  it("does not take the cursor back from where a person put it", () => {
    // A click into the search field between the key and the frame is a real
    // sequence, and stealing focus back would be worse than losing it.
    const page = makePage(3);

    focusRailOption(1, page.port);
    page.clickElsewhere();
    page.frame();

    expect(page.focusedIndexes).toEqual([1]);
  });

  it("leaves focus alone after the commit when the option survived", () => {
    // The common path: moving through the repo list keeps the option on
    // screen, so the only focus call is the one in this frame.
    const page = makePage(3);

    focusRailOption(2, page.port);
    page.frame();

    expect(page.focusedIndexes).toEqual([2]);
  });

  it("survives an index the list no longer has", () => {
    // `railStop` keeps the tab stop in range, but a frame can still land after
    // the list has been replaced by a shorter one.
    const page = makePage(2);

    expect(() => {
      focusRailOption(4, page.port);
      page.frame();
    }).not.toThrow();
    expect(page.focusedIndexes).toEqual([]);
  });
});
