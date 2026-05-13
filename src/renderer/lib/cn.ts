import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Canonical Tailwind class merger.
 *
 * Mirrors `lib/utils.ts` in the legacy Next.js app but lives under
 * `@renderer/lib/cn` so renderer code does not reach across the
 * Phase 0 module boundary into the Next.js codebase.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
