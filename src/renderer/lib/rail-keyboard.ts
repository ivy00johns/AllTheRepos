/**
 * The map rail's keyboard: which key lands on which option, and where the
 * cursor goes when it does.
 *
 * Both halves used to be written inline in `routes/graph.tsx`, and the cursor
 * half was wrong there. It focused the option on the *next* animation frame,
 * which is what opening a group needs — the list is replaced, so the element
 * at that index does not exist until React has committed — but it is not what
 * moving through the repo list needs: the arrow key selected the next row and
 * left the cursor on the previous one for a frame. Nothing on screen looked
 * wrong, which is why only a test noticed (`workstream-b`'s ATR-069 spec asks
 * `document.activeElement` immediately after the key).
 *
 * So the policy is stated once, here, where it can be driven directly instead
 * of through a 950-line route and a real Electron window: the cursor moves in
 * the same frame, and it is put back after the commit **only** when the
 * element it was on left the document — a case worth naming, because getting
 * it wrong means either a dead tab stop or a page that steals focus.
 */

/**
 * Where a key moves the cursor, or `null` when it is not a key the rail owns.
 *
 * Wrapping at both ends is deliberate: the list is closed, so ArrowDown on the
 * last option is the shortest way back to the first. An empty list has no stop
 * to move to and says so with `null` rather than an index into nothing.
 */
export function railTarget(
  key: string,
  index: number,
  last: number,
): number | null {
  if (last < 0) return null;
  if (key === "ArrowDown" || key === "ArrowRight") {
    return index >= last ? 0 : index + 1;
  }
  if (key === "ArrowUp" || key === "ArrowLeft") {
    return index <= 0 ? last : index - 1;
  }
  if (key === "Home") return 0;
  if (key === "End") return last;
  return null;
}

/**
 * The list's single tab stop, clamped to a list that may have shrunk.
 *
 * Opening a group or switching a signal off replaces the list under the cursor,
 * so the index the roving stop was last set to can be past the end of it by the
 * time the next render happens. Left unclamped the rail would have no tabbable
 * option at all, which reads as the control having disappeared from the
 * keyboard's point of view. `-1` is the honest answer for an empty list.
 */
export function railStop(index: number, length: number): number {
  if (length <= 0) return -1;
  return Math.min(Math.max(index, 0), length - 1);
}

/**
 * What {@link focusRailOption} needs from the page.
 *
 * Injected rather than read off `document` inside the function so the policy
 * can be tested without a DOM: this suite runs in Node with no jsdom, and the
 * alternative — adding a browser environment for two branches — is a bigger
 * change than the code it would be testing.
 */
export interface RailFocusPort {
  /** The option at this index, or `null` if the list no longer has one. */
  optionAt(index: number): HTMLElement | null;
  /** Where focus is now. */
  activeElement(): Element | null;
  /** Where focus lands when the element holding it leaves the document. */
  fallback(): Element | null;
  /** Run `again` after the next frame. */
  afterFrame(again: () => void): void;
}

/**
 * Move the cursor onto the option at `index`, and keep it there across a commit.
 *
 * The same-frame focus is the common path: moving through the repo list keeps
 * the option that was pressed on screen — only which one is *selected*
 * changes — so the cursor belongs on it immediately, and a frame of delay is
 * long enough for a keyboard user to feel the keystroke land nowhere.
 *
 * The deferred attempt is for the case that motivated the original delay:
 * opening a group replaces the list, the element just focused is removed, and
 * focus falls back to the document body. It fires **only** when focus was
 * actually dropped, so it can never take the cursor back from wherever a
 * person has since put it — a click into the search field, say.
 */
export function focusRailOption(index: number, port: RailFocusPort): void {
  port.optionAt(index)?.focus();
  port.afterFrame(() => {
    if (port.activeElement() !== port.fallback()) return;
    port.optionAt(index)?.focus();
  });
}
