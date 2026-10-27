import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Canonical Tailwind class merger.
 *
 * Mirrors `lib/utils.ts` in the legacy Next.js app but lives under
 * `@renderer/lib/cn` so renderer code does not reach across the
 * Phase 0 module boundary into the Next.js codebase.
 *
 * The handoff's type tier is made of `text-*` tokens (`text-body`,
 * `text-label`, `text-display`, …). `tailwind-merge` cannot tell a custom
 * font-size from a text colour, so it treated `text-label` as a colour and
 * dropped the `text-background` that makes an ink primary readable — the
 * Scan now button rendered as a white rectangle with no label. Teaching it
 * which `text-*` names are sizes keeps colour and size independent, which is
 * also what lets a button take a type tier without losing its foreground.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "title",
            "name",
            "name-lg",
            "body",
            "label",
            "meta",
            "micro",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
