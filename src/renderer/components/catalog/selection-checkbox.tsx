/**
 * The catalog's selection checkbox.
 *
 * Bulk operations — add to a group, fetch, pull — have always existed behind
 * ⌘-click, and ⌘-click is a gesture nothing on screen advertises. The toolbar's
 * "N selected" block only appeared for someone who already knew the trick, so
 * the features behind it were, in practice, unreachable. A checkbox is the
 * affordance that says "this row takes part in a selection" without a diagram.
 *
 * A native `<input type="checkbox">`, not a styled div: the browser supplies the
 * role, the Space key, the focus ring and the checked announcement, and there is
 * one of these per row — a custom control would cost more than it returns.
 * `accent-accent` paints it in the app's own green rather than the platform
 * blue, which is the one visual thing worth taking over.
 *
 * Both click handlers stop propagation on purpose. The card and the table row
 * have their own click handlers that open a repo, and ticking three checkboxes
 * should not open three detail panels.
 */

import { cn } from "@renderer/lib/cn";

export interface SelectionCheckboxProps {
  /** The repo this box selects — carried into the accessible name. */
  name: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

export function SelectionCheckbox({
  name,
  checked,
  onCheckedChange,
  className,
}: SelectionCheckboxProps) {
  return (
    <input
      type="checkbox"
      aria-label={`Select ${name}`}
      checked={checked}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        event.stopPropagation();
        onCheckedChange(event.currentTarget.checked);
      }}
      /*
       * A real 14px box, sized like the chips beside it so the title keeps its
       * line height, with a small negative left margin that pulls it back into
       * the row's `gap-2` — without it the title would shift further right than
       * the box needs.
       */
      className={cn(
        "-ml-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer rounded-sm accent-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        className,
      )}
    />
  );
}
